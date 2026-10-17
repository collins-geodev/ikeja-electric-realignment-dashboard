/* IKEDC 2026 Realignment Command Dashboard */
(() => {
  const fmt = new Intl.NumberFormat("en-US");
  const pct = (n) => `${Number(n).toFixed(1)}%`;
  const empty = (arr) => !arr || !arr.length;

  const state = {
    data: null,
    feedersGeo: null,
    labels: null,
    /** Multi-select filters — empty array means ALL */
    bus: [],
    uts: [],
    feeders: [],
    dts: [],
    map: null,
    layers: {
      bu: null, ut: null, dts: null, iss: null, tcn: null,
      feeders11: null, feeders33: null, buLabels: null, utLabels: null, uploads: null, lagos: null,
    },
    uploads: [],
    lagos: null,
    baseTile: null,
    charts: {},
    activeTab: "overview",
    rendered: { overview: false, assets: false, feeders: false },
  };

  const chartTheme = () => {
    const theme = document.documentElement.getAttribute("data-theme") || "dark";
    const light = theme === "light";
    return {
      theme,
      light,
      text: light ? "#142033" : "#e8eef6",
      muted: light ? "#5b6b7c" : "#93a4b8",
      border: light ? "rgba(20,32,51,0.12)" : "rgba(255,255,255,0.08)",
      labelStroke: light ? "rgba(255,255,255,0.92)" : "rgba(12,17,24,0.88)",
      labelFill: light ? "#142033" : "#f4f7fb",
    };
  };

  const chartDefaults = () => {
    const t = chartTheme();
    Chart.defaults.color = t.muted;
    Chart.defaults.borderColor = t.border;
    Chart.defaults.font.family = "'IBM Plex Sans', system-ui, sans-serif";
  };

  function refreshChartTheme() {
    chartDefaults();
    Object.values(state.charts).forEach((c) => {
      try { c.update("none"); } catch (_) { /* ignore */ }
    });
  }

  const buColor = (name) =>
    state.data.business_units.find((b) => b.bu_name === name)?.fill_hex || "#6b7c90";

  const inSet = (arr, value) => empty(arr) || arr.includes(value);

  const filteredBUs = () => {
    const bus = state.data.business_units;
    return empty(state.bus) ? bus : bus.filter((b) => state.bus.includes(b.bu_name));
  };

  const filteredUTs = () => {
    let uts = state.data.undertakings;
    if (!empty(state.bus)) uts = uts.filter((u) => state.bus.includes(u.bu_name));
    if (!empty(state.uts)) uts = uts.filter((u) => state.uts.includes(u.ut_name));
    return uts;
  };

  const feederCatalog = () => {
    const fromNom = state.data.nomenclature?.feeders;
    if (fromNom?.length) {
      return fromNom.map((f) => ({
        name: f.name,
        count: f.count,
        voltage: guessVoltage(f.name),
      }));
    }
    return state.data.feeders.map((f) => ({
      name: f.feeder,
      count: f.dt_count,
      voltage: f.voltage,
      new_bu: f.new_bu,
      new_ut: f.new_ut,
      len_km: f.len_km,
      in_own_bu: f.in_own_bu,
      in_own_ut: f.in_own_ut,
    }));
  };

  const guessVoltage = (name) => {
    if (/^33[- ]/i.test(name) || /33kV/i.test(name)) return "33kV";
    if (/^11[- ]/i.test(name) || /11kV/i.test(name)) return "11kV";
    return "—";
  };

  const matchFeederLine = (lineName, selectedNames) => {
    if (empty(selectedNames)) return true;
    const ln = String(lineName || "").toLowerCase();
    return selectedNames.some((sel) => {
      const s = String(sel).toLowerCase();
      return s === ln || s.includes(ln) || ln.includes(s);
    });
  };

  const filteredFeedersMeta = () => {
    let rows = state.data.feeders.slice();
    if (!empty(state.bus)) rows = rows.filter((f) => state.bus.includes(f.new_bu));
    if (!empty(state.uts)) rows = rows.filter((f) => state.uts.includes(f.new_ut));
    if (!empty(state.feeders)) {
      rows = rows.filter((f) => matchFeederLine(f.feeder, state.feeders));
    }
    return rows;
  };

  const filteredDTs = () => {
    let dts = state.data.map.dt_sample || [];
    if (!empty(state.bus)) dts = dts.filter((d) => state.bus.includes(d.bu));
    if (!empty(state.uts)) dts = dts.filter((d) => state.uts.includes(d.ut));
    if (!empty(state.feeders)) dts = dts.filter((d) => state.feeders.includes(d.feeder));
    if (!empty(state.dts)) dts = dts.filter((d) => state.dts.includes(d.name));
    return dts;
  };

  function destroyChart(key) {
    if (state.charts[key]) {
      state.charts[key].destroy();
      delete state.charts[key];
    }
  }

  function resizeVisibleCharts() {
    requestAnimationFrame(() => {
      Object.values(state.charts).forEach((c) => {
        try { c.resize(); } catch (_) { /* ignore */ }
      });
      if (state.map && state.activeTab === "overview") {
        state.map.invalidateSize();
        updateLabelVisibility();
      }
    });
  }

  const valueLabelsPlugin = {
    id: "valueLabels",
    afterDatasetsDraw(chart) {
      const cfg = chart.options.plugins?.valueLabels;
      if (!cfg?.display) return;
      const type = chart.config.type;
      // Never clutter point charts (e.g. Length vs DT load scatter)
      if (type === "scatter" || type === "bubble" || type === "line") return;
      const { ctx } = chart;
      const suffix = cfg.suffix || "";
      const decimals = cfg.decimals ?? 1;
      const t = chartTheme();
      const isRound = type === "doughnut" || type === "pie";
      const stacked = !!(
        chart.options.scales?.x?.stacked ||
        chart.options.scales?.y?.stacked
      );
      const fontSize = cfg.fontSize || (isRound ? 10 : 11);

      const drawLabel = (text, x, y, baseline = "bottom") => {
        ctx.save();
        ctx.font = `600 ${fontSize}px 'IBM Plex Sans', system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = baseline;
        ctx.lineWidth = 3;
        ctx.strokeStyle = t.labelStroke;
        ctx.fillStyle = t.labelFill;
        ctx.strokeText(text, x, y);
        ctx.fillText(text, x, y);
        ctx.restore();
      };

      const formatVal = (raw) => {
        if (raw == null || raw === "") return null;
        if (typeof raw === "number") {
          if (!Number.isFinite(raw)) return null;
          return Number.isInteger(raw) ? fmt.format(raw) : Number(raw).toFixed(decimals);
        }
        return String(raw);
      };

      chart.data.datasets.forEach((ds, di) => {
        if (ds.hidden) return;
        const meta = chart.getDatasetMeta(di);
        if (meta.hidden) return;
        meta.data.forEach((el, i) => {
          const raw = ds.data[i];
          const formatted = formatVal(typeof raw === "object" && raw != null ? raw.y ?? raw.x : raw);
          if (formatted == null) return;
          const text = `${formatted}${suffix}`;

          if (isRound) {
            const start = el.startAngle;
            const end = el.endAngle;
            if (end - start < 0.12) return;
            const mid = (start + end) / 2;
            const r = (el.innerRadius + el.outerRadius) / 2;
            drawLabel(text, el.x + Math.cos(mid) * r, el.y + Math.sin(mid) * r, "middle");
            return;
          }

          const props = el.getProps(["x", "y", "base", "width", "height"], true);
          const barH = Math.abs((props.base ?? props.y) - props.y);
          if (stacked) {
            if (barH < 14) return;
            const midY = ((props.base ?? props.y) + props.y) / 2;
            drawLabel(text, props.x, midY, "middle");
          } else {
            if (barH < 4 && Number(raw) === 0) return;
            drawLabel(text, props.x, props.y - 3, "bottom");
          }
        });
      });
    },
  };
  if (typeof Chart !== "undefined" && !window.__ikedcValueLabels) {
    Chart.register(valueLabelsPlugin);
    window.__ikedcValueLabels = true;
  }

  function barChart(key, canvasId, labels, datasets, opts = {}) {
    destroyChart(key);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const showLabels = opts.valueLabels !== false;
    state.charts[key] = new Chart(ctx, {
      type: opts.type || "bar",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { top: showLabels && !opts.stacked ? 20 : 8, right: 4, left: 4 } },
        plugins: {
          legend: { display: opts.legend !== false, position: "bottom", labels: { boxWidth: 12 } },
          tooltip: { mode: "index", intersect: false },
          valueLabels: {
            display: showLabels,
            decimals: opts.labelDecimals ?? 1,
            suffix: opts.labelSuffix || "",
            fontSize: opts.labelFontSize || 11,
          },
        },
        scales: opts.scales || {
          x: { stacked: !!opts.stacked, grid: { display: false } },
          y: { stacked: !!opts.stacked, beginAtZero: true, ticks: { callback: (v) => fmt.format(v) } },
        },
      },
    });
  }

  function doughnut(key, canvasId, labels, values, colors) {
    destroyChart(key);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    state.charts[key] = new Chart(ctx, {
      type: "doughnut",
      data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { position: "bottom", labels: { boxWidth: 10 } },
          valueLabels: { display: true, decimals: 0, fontSize: 10 },
        },
        cutout: "58%",
      },
    });
  }

  function renderKPIs() {
    const k = state.data.kpis;
    const bus = filteredBUs();
    const uts = filteredUTs();
    const dts = filteredDTs();
    const feeders = feederCatalog().filter((f) => {
      if (!empty(state.feeders) && !state.feeders.includes(f.name)) return false;
      if (!empty(state.bus) || !empty(state.uts)) {
        const hit = dts.some((d) => d.feeder === f.name);
        if (dts.length && !hit && !empty(state.bus)) {
          /* keep catalog items that appear in filtered DTs */
          return hit;
        }
      }
      return true;
    });
    const feederCount = empty(state.feeders)
      ? (empty(state.bus) && empty(state.uts) ? k.feeders_total : filteredFeedersMeta().length)
      : state.feeders.length;

    const dtTotal = empty(state.dts) && empty(state.feeders) && empty(state.bus) && empty(state.uts)
      ? k.dt_total
      : (empty(state.dts) && empty(state.feeders)
        ? uts.reduce((s, u) => s + u.dt_total, 0)
        : dts.length);
    const dtPub = empty(state.dts) && empty(state.feeders) && empty(state.bus) && empty(state.uts)
      ? k.dt_public
      : (empty(state.dts) && empty(state.feeders)
        ? uts.reduce((s, u) => s + u.dt_public, 0)
        : dts.filter((d) => d.own === "PUBLIC").length);
    const dtPriv = empty(state.dts) && empty(state.feeders) && empty(state.bus) && empty(state.uts)
      ? k.dt_private
      : (empty(state.dts) && empty(state.feeders)
        ? uts.reduce((s, u) => s + u.dt_private, 0)
        : dts.filter((d) => d.own === "PRIVATE").length);
    const meanAgree = uts.length
      ? uts.reduce((s, u) => s + u.agreement_pct, 0) / uts.length
      : 0;

    const items = [
      { label: "Distribution transformers", value: fmt.format(dtTotal), hint: `${fmt.format(dtPub)} public · ${fmt.format(dtPriv)} private`, open: "dt" },
      { label: "Business Units", value: empty(state.bus) ? k.bu_2026 : state.bus.length, hint: empty(state.bus) ? `from ${k.bu_existing} previous` : state.bus.join(", "), open: "bu" },
      { label: "Undertakings", value: empty(state.uts) ? uts.length : state.uts.length, hint: empty(state.uts) ? (empty(state.bus) ? `from ${k.ut_existing} previous` : "in selected BU(s)") : state.uts.join(", "), open: "ut" },
      { label: "Mean register agreement", value: pct(meanAgree), hint: "DT register vs 2026 UT polygon" },
      { label: "Feeders", value: feederCount, hint: `${feeders.filter((f) => f.voltage === "11kV").length || "—"} × 11 kV · ${feeders.filter((f) => f.voltage === "33kV").length || "—"} × 33 kV`, open: "feeder" },
      { label: "Injection substations", value: k.iss, hint: `${fmt.format(k.loads_33kv)} 33 kV loads in TOC` },
      { label: "TCN stations", value: k.tcn, hint: "transmission stations" },
    ];

    document.getElementById("kpi-strip").innerHTML = items
      .map((i) => {
        const tag = i.open ? "button" : "article";
        const cls = i.open ? "kpi interactive" : "kpi";
        const extra = i.open ? ` type="button" data-open-combo="${i.open}"` : "";
        return `<${tag} class="${cls}"${extra}><div class="label">${i.label}</div><div class="value">${i.value}</div><div class="hint">${i.hint}</div></${tag}>`;
      })
      .join("");

    document.querySelectorAll("[data-open-combo]").forEach((btn) => {
      btn.addEventListener("click", () => openCombo(btn.dataset.openCombo));
    });
  }

  function renderCompare() {
    const k = state.data.kpis;
    document.getElementById("compare-block").innerHTML = `
      <div class="side">
        <h3>Existing</h3>
        <div class="metric"><span>Business Units</span><strong>${k.bu_existing}</strong></div>
        <div class="metric"><span>Undertakings</span><strong>${k.ut_existing}</strong></div>
        <div class="metric"><span>DT register</span><strong>${fmt.format(k.dt_total)}</strong></div>
      </div>
      <div class="arrow" aria-hidden="true">→</div>
      <div class="side">
        <h3>2026 Realignment</h3>
        <div class="metric"><span>Business Units</span><strong>${k.bu_2026}</strong></div>
        <div class="metric"><span>Undertakings</span><strong>${k.ut_2026}</strong></div>
        <div class="metric"><span>Mean agreement</span><strong>${pct(k.mean_agreement_pct)}</strong></div>
      </div>`;
  }

  function renderUTTable() {
    const tbody = document.querySelector("#ut-table tbody");
    const rows = filteredUTs().slice().sort((a, b) => b.dt_total - a.dt_total);
    tbody.innerHTML = rows
      .map(
        (u) => `<tr data-ut="${u.ut_name}" data-bu="${u.bu_name}" class="${state.uts.includes(u.ut_name) ? "active" : ""}">
        <td>${u.ut_name}</td>
        <td><span class="legend-swatch" style="background:${u.bu_hex || buColor(u.bu_name)}"></span>${u.bu_name}</td>
        <td>${fmt.format(u.dt_total)}</td>
        <td>${fmt.format(u.dt_public)} / ${fmt.format(u.dt_private)}</td>
        <td>${pct(u.agreement_pct)}</td>
        <td>${u.area_km2.toFixed(1)}</td>
      </tr>`
      )
      .join("");
    tbody.querySelectorAll("tr").forEach((tr) => {
      tr.addEventListener("click", () => {
        state.uts = [tr.dataset.ut];
        state.bus = [tr.dataset.bu];
        state.feeders = [];
        state.dts = [];
        refreshAll({ zoom: true });
      });
    });
  }

  function renderFeederTable() {
    const tbody = document.querySelector("#feeder-table tbody");
    const catalog = feederCatalog();
    const dtRows = filteredDTs();
    const byFeeder = {};
    dtRows.forEach((d) => {
      if (!d.feeder) return;
      if (!byFeeder[d.feeder]) byFeeder[d.feeder] = { name: d.feeder, dts: 0, bus: new Set(), uts: new Set() };
      byFeeder[d.feeder].dts += 1;
      if (d.bu) byFeeder[d.feeder].bus.add(d.bu);
      if (d.ut) byFeeder[d.feeder].uts.add(d.ut);
    });

    let rows = Object.values(byFeeder);
    if (!rows.length) {
      rows = filteredFeedersMeta().map((f) => ({
        name: f.feeder,
        dts: f.dt_count,
        bus: new Set([f.new_bu]),
        uts: new Set([f.new_ut]),
        voltage: f.voltage,
        len_km: f.len_km,
        in_own_bu: f.in_own_bu,
        in_own_ut: f.in_own_ut,
      }));
    }

    rows = rows
      .map((r) => {
        const meta = state.data.feeders.find((f) => matchFeederLine(f.feeder, [r.name]));
        const cat = catalog.find((c) => c.name === r.name);
        return {
          name: r.name,
          voltage: r.voltage || cat?.voltage || meta?.voltage || guessVoltage(r.name),
          bu: [...(r.bus || [])].join(", ") || meta?.new_bu || "—",
          ut: [...(r.uts || [])].join(", ") || meta?.new_ut || "—",
          dts: r.dts || meta?.dt_count || cat?.count || 0,
          len_km: r.len_km ?? meta?.len_km ?? 0,
          in_own_bu: r.in_own_bu ?? meta?.in_own_bu ?? 0,
          in_own_ut: r.in_own_ut ?? meta?.in_own_ut ?? 0,
        };
      })
      .sort((a, b) => b.dts - a.dts)
      .slice(0, 50);

    tbody.innerHTML = rows
      .map(
        (f) => `<tr>
        <td title="${f.name}">${f.name.length > 48 ? f.name.slice(0, 48) + "…" : f.name}</td>
        <td>${String(f.voltage).replace("kV", "")}</td>
        <td>${f.bu}</td>
        <td>${f.ut}</td>
        <td>${fmt.format(f.dts)}</td>
        <td>${Number(f.len_km).toFixed(1)}</td>
        <td>${pct(Number(f.in_own_bu) * (Number(f.in_own_bu) <= 1 ? 100 : 1))}</td>
        <td>${pct(Number(f.in_own_ut) * (Number(f.in_own_ut) <= 1 ? 100 : 1))}</td>
      </tr>`
      )
      .join("");
  }

  function countsFor(field) {
    if (empty(state.bus)) return state.data.dt_analytics.counts[field] || [];
    const merged = {};
    state.bus.forEach((bu) => {
      (state.data.dt_analytics.by_bu[bu]?.[field] || []).forEach((row) => {
        merged[row.name] = (merged[row.name] || 0) + row.count;
      });
    });
    return Object.entries(merged)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  function renderOverviewCharts() {
    const bus = filteredBUs();
    barChart("buDt", "chart-bu-dt", bus.map((b) => b.bu_name), [
      { label: "Public", data: bus.map((b) => b.dt_public), backgroundColor: "#1f6fb2", borderRadius: 6 },
      { label: "Private", data: bus.map((b) => b.dt_private), backgroundColor: "#c8452c", borderRadius: 6 },
    ], { stacked: true, labelDecimals: 0 });

    const uts = filteredUTs().slice().sort((a, b) => a.agreement_pct - b.agreement_pct).slice(0, 20);
    barChart("agree", "chart-agreement", uts.map((u) => u.ut_name), [
      {
        label: "Agreement %",
        data: uts.map((u) => u.agreement_pct),
        backgroundColor: uts.map((u) => u.fill_hex || buColor(u.bu_name)),
        borderRadius: 4,
      },
    ], {
      legend: false,
      labelSuffix: "%",
      labelDecimals: 1,
      scales: {
        x: { ticks: { maxRotation: 55, minRotation: 35, font: { size: 10 } }, grid: { display: false } },
        y: { min: 90, max: 100, ticks: { callback: (v) => `${v}%` } },
      },
    });
    state.rendered.overview = true;
  }

  function renderAssetCharts() {
    const bus = filteredBUs().slice().sort((a, b) => b.area_km2 - a.area_km2);
    barChart("buArea", "chart-bu-area", bus.map((b) => b.bu_name), [
      {
        label: "Area km²",
        data: bus.map((b) => b.area_km2),
        backgroundColor: bus.map((b) => b.fill_hex || buColor(b.bu_name)),
        borderRadius: 6,
      },
    ], { legend: false, valueLabels: true, labelDecimals: 1 });

    const uts = filteredUTs().slice().sort((a, b) => b.area_km2 - a.area_km2).slice(0, 18);
    barChart("utArea", "chart-ut-area", uts.map((u) => u.ut_name), [
      {
        label: "Area km²",
        data: uts.map((u) => u.area_km2),
        backgroundColor: uts.map((u) => u.fill_hex || buColor(u.bu_name)),
        borderRadius: 5,
      },
    ], {
      legend: false,
      valueLabels: true,
      labelDecimals: 1,
      scales: {
        x: { ticks: { maxRotation: 50, minRotation: 30, font: { size: 9 } }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { callback: (v) => fmt.format(v) } },
      },
    });

    const dens = bus.map((b) => ({
      name: b.bu_name,
      value: b.dt_per_km2 ?? (b.area_km2 ? +(b.dt_total / b.area_km2).toFixed(1) : 0),
      fill: b.fill_hex,
    }));
    barChart("dens", "chart-density", dens.map((d) => d.name), [
      { label: "DTs / km²", data: dens.map((d) => d.value), backgroundColor: dens.map((d) => d.fill || buColor(d.name)), borderRadius: 6 },
    ], { legend: false, valueLabels: true, labelDecimals: 1 });

    const own = countsFor("ownership").slice(0, 6);
    doughnut("own", "chart-ownership", own.map((d) => d.name), own.map((d) => d.count), ["#1f6fb2", "#c8452c", "#6b7c90"]);
    const install = countsFor("install_pos").slice(0, 6);
    doughnut("install", "chart-install", install.map((d) => d.name), install.map((d) => d.count), ["#2e8b57", "#d99a1e", "#7a4fb5", "#6b7c90"]);

    let re = state.data.dt_analytics.reassignments || [];
    if (!empty(state.bus)) re = re.filter((r) => state.bus.some((b) => r.name.includes(b)));
    re = re.slice(0, 12);
    barChart("re", "chart-reassign", re.map((r) => r.name), [
      { label: "DTs moved", data: re.map((r) => r.count), backgroundColor: "#c8452c", borderRadius: 5 },
    ], {
      legend: false,
      labelDecimals: 0,
      scales: {
        x: { ticks: { maxRotation: 45, minRotation: 30, font: { size: 9 } }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { callback: (v) => fmt.format(v) } },
      },
    });

    const binsOrder = ["≤50", "51–100", "101–200", "201–300", "301–500", ">500", "Unknown"];
    const bins = (state.data.dt_analytics.capacity.bins || [])
      .slice()
      .sort((a, b) => binsOrder.indexOf(a.name) - binsOrder.indexOf(b.name));
    barChart("cap", "chart-capacity", bins.map((b) => b.name), [
      { label: "DTs", data: bins.map((b) => b.count), backgroundColor: "#d99a1e", borderRadius: 6 },
    ], { legend: false, labelDecimals: 0 });

    state.rendered.assets = true;
  }

  function renderFeederCharts() {
    const byBu = empty(state.bus)
      ? state.data.feeders_by_bu
      : state.data.feeders_by_bu.filter((r) => state.bus.includes(r.bu_name));

    barChart("fbu", "chart-feeder-bu", byBu.map((r) => r.bu_name), [
      { label: "Feeders", data: byBu.map((r) => r.feeder_count), backgroundColor: "#1f6fb2", borderRadius: 6 },
      { label: "Length (km)", data: byBu.map((r) => Math.round(r.len_km)), backgroundColor: "#d99a1e", borderRadius: 6 },
    ], { labelDecimals: 0 });

    const sample = filteredFeedersMeta().slice(0, 180);
    destroyChart("scatter");
    state.charts.scatter = new Chart(document.getElementById("chart-feeder-scatter"), {
      type: "scatter",
      data: {
        datasets: [
          {
            label: "11 kV",
            data: sample.filter((f) => f.voltage === "11kV").map((f) => ({ x: f.len_km, y: f.dt_count })),
            backgroundColor: "rgba(31,111,178,0.75)",
          },
          {
            label: "33 kV",
            data: sample.filter((f) => f.voltage === "33kV").map((f) => ({ x: f.len_km, y: f.dt_count })),
            backgroundColor: "rgba(200,69,44,0.8)",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { position: "bottom" },
          valueLabels: { display: false },
        },
        scales: {
          x: { title: { display: true, text: "Length (km)" }, beginAtZero: true },
          y: { title: { display: true, text: "DT count" }, beginAtZero: true },
        },
      },
    });

    const fidelity = filteredFeedersMeta();
    const buckets = [
      { name: "≥95% in-own BU", count: fidelity.filter((f) => f.in_own_bu >= 0.95).length },
      { name: "80–95%", count: fidelity.filter((f) => f.in_own_bu >= 0.8 && f.in_own_bu < 0.95).length },
      { name: "50–80%", count: fidelity.filter((f) => f.in_own_bu >= 0.5 && f.in_own_bu < 0.8).length },
      { name: "<50%", count: fidelity.filter((f) => f.in_own_bu < 0.5).length },
    ];
    barChart("fid", "chart-fidelity", buckets.map((b) => b.name), [
      { label: "Feeders", data: buckets.map((b) => b.count), backgroundColor: ["#2e8b57", "#d99a1e", "#c8452c", "#6b7c90"], borderRadius: 6 },
    ], { legend: false, labelDecimals: 0 });

    renderFeederTable();
    state.rendered.feeders = true;
  }

  function ringsToLatLngs(rings) {
    return rings.map((ring) => ring.map(([lon, lat]) => [lat, lon]));
  }

  function labelIcon(text, kind, color) {
    return L.divIcon({
      className: "",
      html: `<div style="transform:translate(-50%,-50%);padding:2px 7px;border-radius:999px;font:600 ${kind === "bu" ? "11px" : "10px"} Sora,sans-serif;color:#fff;background:${color || "#334"};border:1px solid rgba(255,255,255,.25);white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.35)">${text}</div>`,
      iconSize: [0, 0],
    });
  }

  function updateLabelVisibility() {
    if (!state.map) return;
    const z = state.map.getZoom();
    if (state.layers.buLabels) {
      if (z >= 10) state.map.addLayer(state.layers.buLabels);
      else state.map.removeLayer(state.layers.buLabels);
    }
    if (state.layers.utLabels) {
      if (z >= 12) state.map.addLayer(state.layers.utLabels);
      else state.map.removeLayer(state.layers.utLabels);
    }
  }

  function clearMapLayers() {
    Object.entries(state.layers).forEach(([key, layer]) => {
      if (layer && state.map) {
        try { state.map.removeLayer(layer); } catch (_) { /* ignore */ }
      }
      state.layers[key] = null;
    });
  }

  function collectFilterBounds() {
    const bounds = [];
    const pushRings = (rings) => {
      rings.forEach((ring) => ring.forEach(([lon, lat]) => bounds.push([lat, lon])));
    };

    if (!empty(state.uts)) {
      state.data.map.ut_polygons
        .filter((u) => state.uts.includes(u.ut_name))
        .forEach((u) => pushRings(u.rings));
    } else if (!empty(state.bus)) {
      state.data.map.bu_polygons
        .filter((b) => state.bus.includes(b.bu_name))
        .forEach((b) => pushRings(b.rings));
    }

    const dts = filteredDTs();
    if ((!empty(state.dts) || !empty(state.feeders)) && dts.length) {
      dts.forEach((d) => bounds.push([d.lat, d.lon]));
    }

    if (state.feedersGeo?.features && !empty(state.feeders)) {
      state.feedersGeo.features.forEach((feat) => {
        const p = feat.properties || {};
        if (!matchFeederLine(p.feeder, state.feeders)) return;
        const coords = [];
        const walk = (c) => {
          if (typeof c[0] === "number") coords.push([c[1], c[0]]);
          else c.forEach(walk);
        };
        walk(feat.geometry?.coordinates || []);
        coords.forEach((ll) => bounds.push(ll));
      });
    }

    return bounds;
  }

  function flyToSelection() {
    if (!state.map) return;
    const bounds = collectFilterBounds();
    if (bounds.length) {
      state.map.flyToBounds(bounds, { padding: [36, 36], maxZoom: 14, duration: 1.1 });
    }
  }

  function setMapTheme(theme) {
    if (!state.map) return;
    if (state.baseTile) state.map.removeLayer(state.baseTile);
    const url = theme === "light"
      ? "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
      : "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
    state.baseTile = L.tileLayer(url, { attribution: "Tiles © Esri", maxZoom: 16 });
    state.baseTile.addTo(state.map);
    state.baseTile.bringToBack();
  }

  function initMap() {
    if (state.map) return;
    state.map = L.map("map", { zoomControl: true }).setView([6.6, 3.45], 11);
    const theme = document.documentElement.getAttribute("data-theme") || "dark";
    setMapTheme(theme);
    state.map.on("zoomend", updateLabelVisibility);
    redrawMapLayers({ zoom: true });
  }

  function redrawMapLayers(opts = {}) {
    if (!state.map) return;
    clearMapLayers();

    if (state.lagos?.features?.length) {
      state.layers.lagos = L.geoJSON(state.lagos, {
        style: { color: "#e8a317", weight: 2.2, fillOpacity: 0.02, dashArray: "7 5" },
        onEachFeature: (f, lyr) => lyr.bindPopup(`<strong>${f.properties?.name || "Lagos State"}</strong>`),
      }).addTo(state.map);
    }

    const buPolys = state.data.map.bu_polygons.filter((b) => inSet(state.bus, b.bu_name));
    const utPolys = state.data.map.ut_polygons.filter((u) => {
      if (!inSet(state.bus, u.bu_name)) return false;
      if (!inSet(state.uts, u.ut_name)) return false;
      return true;
    });

    state.layers.bu = L.layerGroup();
    buPolys.forEach((b) => {
      ringsToLatLngs(b.rings).forEach((latlngs) => {
        L.polygon(latlngs, {
          color: b.fill_hex, weight: 2, fillColor: b.fill_hex, fillOpacity: 0.18,
        })
          .bindPopup(`<strong>${b.bu_name}</strong><br>${fmt.format(b.dt_total)} DTs · ${b.area_km2} km²`)
          .addTo(state.layers.bu);
      });
    });
    state.layers.bu.addTo(state.map);

    state.layers.ut = L.layerGroup();
    utPolys.forEach((u) => {
      ringsToLatLngs(u.rings).forEach((latlngs) => {
        L.polygon(latlngs, {
          color: u.fill_hex, weight: 1, fillOpacity: 0.05, dashArray: "4 4",
        })
          .bindPopup(`<strong>${u.ut_name}</strong> (${u.bu_name})<br>${fmt.format(u.dt_total)} DTs · ${u.area_km2} km²`)
          .addTo(state.layers.ut);
      });
    });
    state.layers.ut.addTo(state.map);

    state.layers.feeders11 = L.layerGroup();
    state.layers.feeders33 = L.layerGroup();
    (state.feedersGeo?.features || []).forEach((feat) => {
      const p = feat.properties || {};
      if (!inSet(state.bus, p.new_bu) && p.new_bu) return;
      if (!inSet(state.uts, p.new_ut) && p.new_ut && !empty(state.uts)) return;
      if (!matchFeederLine(p.feeder, state.feeders)) return;
      const is33 = p.voltage === "33kV";
      const style = {
        color: is33 ? "#f0a020" : "#4db6ff",
        weight: is33 ? 2.2 : 1.6,
        opacity: 0.85,
      };
      L.geoJSON(feat, {
        style,
        onEachFeature: (f, lyr) => {
          const display = state.feeders.find((n) => matchFeederLine(p.feeder, [n])) || p.feeder;
          lyr.bindPopup(
            `<strong>${display}</strong><br>${p.voltage} · ${p.new_bu || "—"} / ${p.new_ut || "—"}<br>` +
            `${fmt.format(p.dt_count || 0)} DTs · ${Number(p.len_km || 0).toFixed(1)} km`
          );
        },
      }).addTo(is33 ? state.layers.feeders33 : state.layers.feeders11);
    });
    state.layers.feeders11.addTo(state.map);
    state.layers.feeders33.addTo(state.map);

    const dts = filteredDTs();
    state.layers.dts = L.layerGroup();
    dts.forEach((p) => {
      L.circleMarker([p.lat, p.lon], {
        radius: empty(state.dts) ? 2.2 : 5,
        color: p.own === "PRIVATE" ? "#c8452c" : "#4aa3ff",
        weight: empty(state.dts) ? 0 : 1,
        fillOpacity: 0.65,
      })
        .bindPopup(
          `<strong>${p.name || "DT"}</strong><br>` +
          `Feeder: ${p.feeder || "—"}<br>${p.bu || "—"} / ${p.ut || "—"} · ${p.own || ""}`
        )
        .addTo(state.layers.dts);
    });
    state.layers.dts.addTo(state.map);

    state.layers.iss = L.layerGroup();
    (state.data.map.iss || []).forEach((p) => {
      L.circleMarker([p.lat, p.lon], {
        radius: 5, color: "#e8a317", weight: 2, fillColor: "#e8a317", fillOpacity: 0.85,
      })
        .bindPopup(`ISS: <strong>${p.name}</strong>`)
        .addTo(state.layers.iss);
    });
    state.layers.iss.addTo(state.map);

    state.layers.tcn = L.layerGroup();
    (state.data.map.tcn || []).forEach((p) => {
      L.marker([p.lat, p.lon], {
        icon: L.divIcon({
          className: "",
          html: `<div style="width:10px;height:10px;background:#fff;border:2px solid #c8452c;transform:rotate(45deg)"></div>`,
          iconSize: [10, 10],
        }),
      })
        .bindPopup(`TCN: <strong>${p.name}</strong>`)
        .addTo(state.layers.tcn);
    });
    state.layers.tcn.addTo(state.map);

    state.layers.buLabels = L.layerGroup();
    ((state.labels && state.labels.bu) || []).forEach((lab) => {
      if (!inSet(state.bus, lab.name)) return;
      L.marker([lab.lat, lab.lon], { icon: labelIcon(lab.name, "bu", lab.fill), interactive: false })
        .addTo(state.layers.buLabels);
    });

    state.layers.utLabels = L.layerGroup();
    ((state.labels && state.labels.ut) || []).forEach((lab) => {
      if (!inSet(state.bus, lab.bu)) return;
      if (!inSet(state.uts, lab.name)) return;
      L.marker([lab.lat, lab.lon], { icon: labelIcon(lab.name, "ut", lab.fill), interactive: false })
        .addTo(state.layers.utLabels);
    });

    if (state.uploads.length) {
      state.layers.uploads = L.layerGroup();
      state.uploads.forEach((fc) => {
        L.geoJSON(fc, {
          style: { color: "#e8a317", weight: 2, fillOpacity: 0.15 },
          pointToLayer: (f, latlng) => L.circleMarker(latlng, {
            radius: 4, color: "#e8a317", fillOpacity: 0.8,
          }),
          onEachFeature: (f, lyr) => {
            const name = f.properties?.name || f.properties?.NAME || "Upload";
            lyr.bindPopup(`<strong>${name}</strong><br><em>Uploaded layer</em>`);
          },
        }).addTo(state.layers.uploads);
      });
      state.layers.uploads.addTo(state.map);
    }

    updateLabelVisibility();

    document.getElementById("map-legend").innerHTML = `
      <span><i class="legend-swatch" style="background:transparent;outline:1px dashed #e8a317"></i>Lagos State</span>
      ${buPolys.map((b) => `<span><i class="legend-swatch" style="background:${b.fill_hex}"></i>${b.bu_name}</span>`).join("")}
      <span><i class="legend-swatch" style="background:#4db6ff"></i>11 kV feeders</span>
      <span><i class="legend-swatch" style="background:#f0a020"></i>33 kV feeders</span>
      <span><i class="legend-swatch" style="background:#4aa3ff"></i>Public DT</span>
      <span><i class="legend-swatch" style="background:#c8452c"></i>Private DT</span>
      <span><i class="legend-swatch" style="background:#e8a317"></i>ISS / uploads</span>
      <span>BU labels ≥ z10 · UT labels ≥ z12</span>
    `;

    if (opts.zoom !== false) flyToSelection();
  }

  function renderActiveTabCharts(force) {
    if (state.activeTab === "overview") {
      if (force || !state.rendered.overview) renderOverviewCharts();
      else resizeVisibleCharts();
    } else if (state.activeTab === "assets") {
      if (force || !state.rendered.assets) renderAssetCharts();
      else resizeVisibleCharts();
    } else if (state.activeTab === "feeders") {
      if (force || !state.rendered.feeders) renderFeederCharts();
      else resizeVisibleCharts();
    }
    setTimeout(resizeVisibleCharts, 60);
  }

  function refreshAll(opts = {}) {
    state.rendered = { overview: false, assets: false, feeders: false };
    renderKPIs();
    renderCompare();
    renderUTTable();
    renderActiveTabCharts(true);
    redrawMapLayers({ zoom: opts.zoom !== false });
    populateCombos();
    syncComboLabels();
  }

  /* ---------- Multi-select comboboxes ---------- */
  const comboStateKey = { bu: "bus", ut: "uts", feeder: "feeders", dt: "dts" };

  function comboRoot(kind) {
    return document.querySelector(`.combo[data-combo="${kind}"]`);
  }

  function selectedArr(kind) {
    return state[comboStateKey[kind]] || [];
  }

  function setSelectedArr(kind, values) {
    state[comboStateKey[kind]] = values;
  }

  function closeAllCombos() {
    document.querySelectorAll(".combo").forEach((c) => {
      c.classList.remove("open");
      const panel = c.querySelector(".combo-panel");
      const trigger = c.querySelector(".combo-trigger");
      if (panel) panel.hidden = true;
      if (trigger) trigger.setAttribute("aria-expanded", "false");
    });
  }

  function openCombo(kind) {
    closeAllCombos();
    const root = comboRoot(kind);
    if (!root) return;
    root.classList.add("open");
    const panel = root.querySelector(".combo-panel");
    const trigger = root.querySelector(".combo-trigger");
    const search = root.querySelector(".combo-search");
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    fillComboList(kind, search.value || "");
    setTimeout(() => search.focus(), 20);
  }

  function comboItems(kind) {
    if (kind === "bu") {
      return state.data.business_units.map((b) => ({ value: b.bu_name, label: b.bu_name }));
    }
    if (kind === "ut") {
      let uts = state.data.undertakings;
      if (!empty(state.bus)) uts = uts.filter((u) => state.bus.includes(u.bu_name));
      return uts.map((u) => ({ value: u.ut_name, label: `${u.ut_name} (${u.bu_name})` }));
    }
    if (kind === "feeder") {
      let feeders = feederCatalog();
      if (!empty(state.bus) || !empty(state.uts)) {
        const allowed = new Set(
          (state.data.map.dt_sample || [])
            .filter((d) => inSet(state.bus, d.bu) && inSet(state.uts, d.ut))
            .map((d) => d.feeder)
            .filter(Boolean)
        );
        if (allowed.size) feeders = feeders.filter((f) => allowed.has(f.name));
      }
      return feeders
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((f) => ({ value: f.name, label: `${f.name}${f.count ? ` · ${f.count}` : ""}` }));
    }
    // DT nomenclature
    let dts = state.data.map.dt_sample || [];
    if (!empty(state.bus)) dts = dts.filter((d) => state.bus.includes(d.bu));
    if (!empty(state.uts)) dts = dts.filter((d) => state.uts.includes(d.ut));
    if (!empty(state.feeders)) dts = dts.filter((d) => state.feeders.includes(d.feeder));
    const seen = new Set();
    const items = [];
    dts.forEach((d) => {
      if (!d.name || seen.has(d.name)) return;
      seen.add(d.name);
      items.push({ value: d.name, label: d.name });
    });
    return items.sort((a, b) => a.label.localeCompare(b.label)).slice(0, 800);
  }

  function fillComboList(kind, query) {
    const root = comboRoot(kind);
    const list = root.querySelector(".combo-list");
    const q = (query || "").trim().toLowerCase();
    let items = comboItems(kind);
    if (q) items = items.filter((i) => i.label.toLowerCase().includes(q) || i.value.toLowerCase().includes(q));
    const selected = new Set(selectedArr(kind));
    if (!items.length) {
      list.innerHTML = `<li class="empty">No matches</li>`;
      return;
    }
    list.innerHTML = items
      .map((i) => {
        const id = `cb-${kind}-${encodeURIComponent(i.value).replace(/%/g, "")}`;
        const checked = selected.has(i.value) ? "checked" : "";
        return `<li><label for="${id}"><input type="checkbox" id="${id}" data-value="${encodeURIComponent(i.value)}" ${checked}/><span>${i.label}</span></label></li>`;
      })
      .join("");
    list.querySelectorAll("input[type=checkbox]").forEach((input) => {
      input.addEventListener("change", () => {
        const value = decodeURIComponent(input.dataset.value);
        const arr = selectedArr(kind).slice();
        const idx = arr.indexOf(value);
        if (input.checked && idx < 0) arr.push(value);
        if (!input.checked && idx >= 0) arr.splice(idx, 1);
        setSelectedArr(kind, arr);
        if (kind === "bu") {
          /* drop UTs/feeders/DTs outside selected BUs */
          if (arr.length) {
            state.uts = state.uts.filter((ut) => {
              const hit = state.data.undertakings.find((u) => u.ut_name === ut);
              return hit && arr.includes(hit.bu_name);
            });
          }
        }
        syncComboLabels();
        refreshAll({ zoom: true });
        /* keep panel open for multi-select */
        fillComboList(kind, root.querySelector(".combo-search").value || "");
      });
    });
  }

  function syncComboLabels() {
    const set = (kind, allLabel, unit) => {
      const el = comboRoot(kind)?.querySelector(".combo-value");
      if (!el) return;
      const arr = selectedArr(kind);
      if (!arr.length) {
        el.textContent = allLabel;
        return;
      }
      if (arr.length === 1) {
        el.textContent = arr[0].length > 26 ? arr[0].slice(0, 26) + "…" : arr[0];
        return;
      }
      el.innerHTML = `<span class="combo-chips"><span class="chip">${arr.length} ${unit}</span></span>`;
    };
    set("bu", "All BUs", "BUs");
    set("ut", "All UTs", "UTs");
    set("feeder", "All feeders", "feeders");
    set("dt", "All DTs", "DTs");
  }

  function populateCombos() {
    ["bu", "ut", "feeder", "dt"].forEach((kind) => {
      const root = comboRoot(kind);
      if (!root || !root.classList.contains("open")) return;
      fillComboList(kind, root.querySelector(".combo-search").value || "");
    });
  }

  function wireCombos() {
    document.querySelectorAll(".combo").forEach((root) => {
      const kind = root.dataset.combo;
      const trigger = root.querySelector(".combo-trigger");
      const search = root.querySelector(".combo-search");
      trigger.addEventListener("click", (e) => {
        e.stopPropagation();
        if (root.classList.contains("open")) closeAllCombos();
        else openCombo(kind);
      });
      search.addEventListener("input", () => fillComboList(kind, search.value));
      search.addEventListener("click", (e) => e.stopPropagation());
      root.querySelectorAll("[data-action]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (btn.dataset.action === "clear") {
            setSelectedArr(kind, []);
          } else if (btn.dataset.action === "select-all") {
            const items = comboItems(kind);
            setSelectedArr(kind, items.map((i) => i.value));
          }
          syncComboLabels();
          refreshAll({ zoom: true });
          fillComboList(kind, search.value || "");
        });
      });
      root.querySelector(".combo-panel")?.addEventListener("click", (e) => e.stopPropagation());
    });
    document.addEventListener("click", () => closeAllCombos());
  }

  function wireTabs() {
    document.querySelectorAll(".tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((b) => {
          b.classList.toggle("active", b === btn);
          b.setAttribute("aria-selected", b === btn ? "true" : "false");
        });
        document.querySelectorAll(".tab-panel").forEach((panel) => {
          const on = panel.id === `panel-${btn.dataset.tab}`;
          panel.classList.toggle("active", on);
          panel.hidden = !on;
        });
        state.activeTab = btn.dataset.tab;
        renderActiveTabCharts(false);
      });
    });
  }

  function setStatus(msg, isError) {
    const el = document.getElementById("io-status");
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = msg;
    el.classList.toggle("error", !!isError);
  }

  async function parseUploadFile(file) {
    const name = file.name.toLowerCase();
    const buf = await file.arrayBuffer();
    if (name.endsWith(".geojson") || name.endsWith(".json")) {
      const text = new TextDecoder().decode(buf);
      const json = JSON.parse(text);
      if (json.type === "FeatureCollection") return json;
      if (json.type === "Feature") return { type: "FeatureCollection", features: [json] };
      throw new Error(`${file.name}: not a Feature/FeatureCollection`);
    }
    if (name.endsWith(".kml")) {
      const text = new TextDecoder().decode(buf);
      const dom = new DOMParser().parseFromString(text, "text/xml");
      return toGeoJSON.kml(dom);
    }
    if (name.endsWith(".kmz") || name.endsWith(".zip")) {
      if (typeof shp !== "undefined" && name.endsWith(".zip")) {
        try {
          const geo = await shp(buf);
          if (Array.isArray(geo)) {
            return {
              type: "FeatureCollection",
              features: geo.flatMap((g) => g.features || []),
            };
          }
          return geo;
        } catch (_) { /* try kmz/kml inside zip */ }
      }
      if (typeof JSZip !== "undefined") {
        const zip = await JSZip.loadAsync(buf);
        const kmlName = Object.keys(zip.files).find((n) => n.toLowerCase().endsWith(".kml"));
        if (kmlName) {
          const text = await zip.files[kmlName].async("text");
          const dom = new DOMParser().parseFromString(text, "text/xml");
          return toGeoJSON.kml(dom);
        }
        if (typeof shp !== "undefined") {
          const geo = await shp(buf);
          if (Array.isArray(geo)) {
            return { type: "FeatureCollection", features: geo.flatMap((g) => g.features || []) };
          }
          return geo;
        }
      }
    }
    if (name.endsWith(".gpkg") || name.endsWith(".gdb")) {
      throw new Error(`${file.name}: GPKG/GDB need conversion to GeoJSON/SHP zip for browser upload`);
    }
    if (name.endsWith(".shp") || name.endsWith(".dbf") || name.endsWith(".prj")) {
      throw new Error("Upload shapefile components as a single .zip");
    }
    throw new Error(`Unsupported file: ${file.name}`);
  }

  function wireUploadExport() {
    const input = document.getElementById("upload-input");
    input.addEventListener("change", async () => {
      const files = [...input.files];
      if (!files.length) return;
      setStatus(`Parsing ${files.length} file(s)…`);
      try {
        let added = 0;
        for (const file of files) {
          const fc = await parseUploadFile(file);
          if (fc?.features?.length) {
            state.uploads.push(fc);
            added += fc.features.length;
          }
        }
        setStatus(`Uploaded ${added} feature(s) onto the map.`);
        redrawMapLayers({ zoom: true });
        if (state.activeTab !== "overview") {
          document.querySelector('.tab[data-tab="overview"]')?.click();
        }
      } catch (err) {
        setStatus(err.message || String(err), true);
      }
      input.value = "";
    });

    const menu = document.getElementById("export-menu");
    document.getElementById("export-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    document.addEventListener("click", () => { menu.hidden = true; });
    menu.addEventListener("click", (e) => e.stopPropagation());

    menu.querySelectorAll("[data-export]").forEach((btn) => {
      btn.addEventListener("click", () => {
        menu.hidden = true;
        runExport(btn.dataset.export);
      });
    });
  }

  function downloadBlob(filename, blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function toCSV(rows) {
    if (!rows.length) return "";
    const keys = Object.keys(rows[0]);
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    return [keys.join(","), ...rows.map((r) => keys.map((k) => esc(r[k])).join(","))].join("\n");
  }

  function runExport(kind) {
    const uts = filteredUTs();
    const bus = filteredBUs();
    const feeders = filteredFeedersMeta();
    const dts = filteredDTs();

    if (kind === "csv-uts") {
      downloadBlob("ikedc_undertakings.csv", new Blob([toCSV(uts)], { type: "text/csv" }));
    } else if (kind === "csv-bus") {
      downloadBlob("ikedc_business_units.csv", new Blob([toCSV(bus)], { type: "text/csv" }));
    } else if (kind === "csv-feeders") {
      downloadBlob("ikedc_feeders.csv", new Blob([toCSV(feeders)], { type: "text/csv" }));
    } else if (kind === "csv-dts") {
      downloadBlob("ikedc_dts.csv", new Blob([toCSV(dts)], { type: "text/csv" }));
    } else if (kind === "xlsx" && typeof XLSX !== "undefined") {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bus), "BusinessUnits");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(uts), "Undertakings");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(feeders), "Feeders");
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dts.slice(0, 20000)), "DTs");
      XLSX.writeFile(wb, "ikedc_realignment_export.xlsx");
    } else if (kind === "geojson") {
      const features = [];
      filteredBUs().forEach((b) => {
        const poly = state.data.map.bu_polygons.find((p) => p.bu_name === b.bu_name);
        if (!poly) return;
        features.push({
          type: "Feature",
          properties: { ...b, layer: "BU" },
          geometry: { type: "MultiPolygon", coordinates: poly.rings.map((r) => [r]) },
        });
      });
      dts.forEach((d) => {
        features.push({
          type: "Feature",
          properties: { name: d.name, feeder: d.feeder, bu: d.bu, ut: d.ut, own: d.own },
          geometry: { type: "Point", coordinates: [d.lon, d.lat] },
        });
      });
      downloadBlob(
        "ikedc_filtered.geojson",
        new Blob([JSON.stringify({ type: "FeatureCollection", features }, null, 2)], { type: "application/geo+json" })
      );
    } else if (kind === "kml") {
      const placemarks = dts.slice(0, 5000).map((d) => `
      <Placemark><name>${escapeXml(d.name || "DT")}</name>
      <description>${escapeXml(d.feeder || "")} · ${escapeXml(d.bu || "")}/${escapeXml(d.ut || "")}</description>
      <Point><coordinates>${d.lon},${d.lat},0</coordinates></Point></Placemark>`).join("");
      const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>IKEDC filtered DTs</name>${placemarks}</Document></kml>`;
      downloadBlob("ikedc_filtered_dts.kml", new Blob([kml], { type: "application/vnd.google-earth.kml+xml" }));
    }
    setStatus(`Export ready: ${kind}`);
  }

  function escapeXml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function resetFilters() {
    state.bus = [];
    state.uts = [];
    state.feeders = [];
    state.dts = [];
    refreshAll({ zoom: true });
  }

  window.IKEDC = {
    getData: () => state.data,
    getFeedersGeo: () => state.feedersGeo,
    setLagos: (fc) => { state.lagos = fc; if (state.map) redrawMapLayers(); },
    setMapTheme,
    refreshChartTheme,
    resetFilters,
    resize: () => {
      if (state.map) state.map.invalidateSize();
      resizeVisibleCharts();
    },
  };

  async function boot() {
    chartDefaults();
    wireTabs();
    wireCombos();
    wireUploadExport();

    const [dashRes, feedRes, labelRes, lagosRes] = await Promise.all([
      fetch("data/dashboard.json"),
      fetch("data/feeders.geojson"),
      fetch("data/map_labels.json"),
      fetch("data/lagos_boundary.geojson"),
    ]);
    if (!dashRes.ok) throw new Error("Failed to load dashboard.json");
    state.data = await dashRes.json();
    state.feedersGeo = feedRes.ok ? await feedRes.json() : { type: "FeatureCollection", features: [] };
    state.labels = labelRes.ok ? await labelRes.json() : { bu: [], ut: [] };
    state.lagos = lagosRes.ok ? await lagosRes.json() : null;

    const meta = document.getElementById("footer-meta");
    if (meta) {
      meta.textContent =
        `${state.data.meta.title} · exported ${state.data.meta.generated} · ${state.data.meta.source}`;
    }

    refreshAll({ zoom: true });
    initMap();
  }

  boot().catch((err) => {
    const meta = document.getElementById("footer-meta");
    if (meta) meta.textContent = `Error: ${err.message}`;
    console.error(err);
  });
})();
