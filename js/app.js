/* IKEDC 2026 Realignment Command Dashboard */
(() => {
  const fmt = new Intl.NumberFormat("en-US");
  const pct = (n) => `${Number(n).toFixed(1)}%`;

  const state = {
    data: null,
    bu: "ALL",
    map: null,
    layers: { bu: null, ut: null, dts: null, iss: null, tcn: null },
    charts: {},
  };

  const chartDefaults = () => {
    Chart.defaults.color = "#93a4b8";
    Chart.defaults.borderColor = "rgba(255,255,255,0.08)";
    Chart.defaults.font.family = "'IBM Plex Sans', system-ui, sans-serif";
  };

  const buColor = (name) => {
    const hit = state.data.business_units.find((b) => b.bu_name === name);
    return hit?.fill_hex || "#6b7c90";
  };

  const filteredUTs = () => {
    const uts = state.data.undertakings;
    return state.bu === "ALL" ? uts : uts.filter((u) => u.bu_name === state.bu);
  };

  const filteredBUs = () => {
    const bus = state.data.business_units;
    return state.bu === "ALL" ? bus : bus.filter((b) => b.bu_name === state.bu);
  };

  const filteredFeeders = () => {
    const rows = state.data.feeders;
    return state.bu === "ALL" ? rows : rows.filter((f) => f.new_bu === state.bu);
  };

  function destroyChart(key) {
    if (state.charts[key]) {
      state.charts[key].destroy();
      delete state.charts[key];
    }
  }

  function renderKPIs() {
    const k = state.data.kpis;
    const bus = filteredBUs();
    const dtTotal = state.bu === "ALL" ? k.dt_total : bus.reduce((s, b) => s + b.dt_total, 0);
    const dtPub = state.bu === "ALL" ? k.dt_public : bus.reduce((s, b) => s + b.dt_public, 0);
    const dtPriv = state.bu === "ALL" ? k.dt_private : bus.reduce((s, b) => s + b.dt_private, 0);
    const uts = filteredUTs();
    const meanAgree = uts.length
      ? uts.reduce((s, u) => s + u.agreement_pct, 0) / uts.length
      : 0;
    const feeders = filteredFeeders();

    const items = [
      { label: "Distribution transformers", value: fmt.format(dtTotal), hint: `${fmt.format(dtPub)} public · ${fmt.format(dtPriv)} private` },
      { label: "Business Units", value: state.bu === "ALL" ? k.bu_2026 : 1, hint: state.bu === "ALL" ? `from ${k.bu_existing} previous` : state.bu },
      { label: "Undertakings", value: uts.length, hint: state.bu === "ALL" ? `from ${k.ut_existing} previous` : "in selected BU" },
      { label: "Mean register agreement", value: pct(meanAgree), hint: "DT register vs 2026 UT polygon" },
      { label: "Feeders", value: feeders.length, hint: `${feeders.filter((f) => f.voltage === "11kV").length} × 11 kV · ${feeders.filter((f) => f.voltage === "33kV").length} × 33 kV` },
      { label: "Injection / TCN", value: `${k.iss} / ${k.tcn}`, hint: `${fmt.format(k.loads_33kv)} 33 kV loads in TOC` },
    ];

    document.getElementById("kpi-strip").innerHTML = items
      .map(
        (i) => `<article class="kpi"><div class="label">${i.label}</div><div class="value">${i.value}</div><div class="hint">${i.hint}</div></article>`
      )
      .join("");
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
        (u) => `<tr data-ut="${u.ut_name}" data-bu="${u.bu_name}">
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
        tbody.querySelectorAll("tr").forEach((r) => r.classList.remove("active"));
        tr.classList.add("active");
        focusUT(tr.dataset.ut);
      });
    });
  }

  function renderFeederTable() {
    const tbody = document.querySelector("#feeder-table tbody");
    const rows = filteredFeeders().slice().sort((a, b) => b.dt_count - a.dt_count).slice(0, 40);
    tbody.innerHTML = rows
      .map(
        (f) => `<tr>
        <td title="${f.feeder}">${f.feeder.length > 42 ? f.feeder.slice(0, 42) + "…" : f.feeder}</td>
        <td>${f.voltage.replace("kV", "")}</td>
        <td>${f.new_bu || "—"}</td>
        <td>${f.new_ut || "—"}</td>
        <td>${fmt.format(f.dt_count)}</td>
        <td>${f.len_km.toFixed(1)}</td>
        <td>${pct(f.in_own_bu * 100)}</td>
        <td>${pct(f.in_own_ut * 100)}</td>
      </tr>`
      )
      .join("");
  }

  function barChart(key, canvasId, labels, datasets, opts = {}) {
    destroyChart(key);
    const ctx = document.getElementById(canvasId);
    state.charts[key] = new Chart(ctx, {
      type: opts.type || "bar",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: opts.legend !== false, position: "bottom", labels: { boxWidth: 12 } },
          tooltip: { mode: "index", intersect: false },
        },
        scales: opts.scales || {
          x: { stacked: !!opts.stacked, grid: { display: false } },
          y: { stacked: !!opts.stacked, beginAtZero: true, ticks: { callback: (v) => fmt.format(v) } },
        },
        ...opts.extra,
      },
    });
    ctx.parentElement.style.position = "relative";
    ctx.style.maxHeight = opts.height || "280px";
  }

  function doughnut(key, canvasId, labels, values, colors) {
    destroyChart(key);
    const ctx = document.getElementById(canvasId);
    state.charts[key] = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels,
        datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: "bottom", labels: { boxWidth: 10 } } },
        cutout: "62%",
      },
    });
  }

  function renderOverviewCharts() {
    const bus = filteredBUs();
    barChart(
      "buDt",
      "chart-bu-dt",
      bus.map((b) => b.bu_name),
      [
        {
          label: "Public",
          data: bus.map((b) => b.dt_public),
          backgroundColor: "#1f6fb2",
          borderRadius: 6,
        },
        {
          label: "Private",
          data: bus.map((b) => b.dt_private),
          backgroundColor: "#c8452c",
          borderRadius: 6,
        },
      ],
      { stacked: true, height: "220px" }
    );

    const uts = filteredUTs().slice().sort((a, b) => a.agreement_pct - b.agreement_pct).slice(0, 20);
    barChart(
      "agree",
      "chart-agreement",
      uts.map((u) => u.ut_name),
      [
        {
          label: "Agreement %",
          data: uts.map((u) => u.agreement_pct),
          backgroundColor: uts.map((u) => u.fill_hex || buColor(u.bu_name)),
          borderRadius: 4,
        },
      ],
      {
        legend: false,
        height: "280px",
        scales: {
          x: { ticks: { maxRotation: 60, minRotation: 40, font: { size: 10 } }, grid: { display: false } },
          y: { min: 90, max: 100, ticks: { callback: (v) => `${v}%` } },
        },
      }
    );
  }

  function countsFor(field) {
    if (state.bu === "ALL") {
      return state.data.dt_analytics.counts[field] || [];
    }
    const byBu = state.data.dt_analytics.by_bu[state.bu];
    return byBu?.[field] || [];
  }

  function renderAssetCharts() {
    const palette = ["#c8452c", "#1f6fb2", "#2e8b57", "#d99a1e", "#7a4fb5", "#4aa3a2", "#8b5e3c", "#6b7c90"];

    const metering = countsFor("metering").slice(0, 8);
    doughnut("meter", "chart-metering", metering.map((d) => d.name), metering.map((d) => d.count), palette);

    const connection = countsFor("connection").slice(0, 8);
    doughnut("conn", "chart-connection", connection.map((d) => d.name), connection.map((d) => d.count), palette.slice().reverse());

    const binsOrder = ["≤50", "51–100", "101–200", "201–300", "301–500", ">500", "Unknown"];
    let bins = state.data.dt_analytics.capacity.bins.slice();
    if (state.bu !== "ALL") {
      // capacity bins are global only; ownership/metering still filter by BU
      bins = bins;
    }
    bins.sort((a, b) => binsOrder.indexOf(a.name) - binsOrder.indexOf(b.name));
    barChart(
      "cap",
      "chart-capacity",
      bins.map((b) => b.name),
      [{ label: "DTs", data: bins.map((b) => b.count), backgroundColor: "#d99a1e", borderRadius: 6 }],
      { legend: false, height: "240px" }
    );

    const own = countsFor("ownership").slice(0, 6);
    doughnut("own", "chart-ownership", own.map((d) => d.name), own.map((d) => d.count), ["#1f6fb2", "#c8452c", "#6b7c90"]);

    const acc = countsFor("acc_type").slice(0, 6);
    doughnut("acc", "chart-acc", acc.map((d) => d.name), acc.map((d) => d.count), ["#2e8b57", "#d99a1e", "#6b7c90"]);

    const re = (state.data.dt_analytics.reassignments || []).slice(0, 12);
    barChart(
      "re",
      "chart-reassign",
      re.map((r) => r.name),
      [{ label: "DTs moved", data: re.map((r) => r.count), backgroundColor: "#c8452c", borderRadius: 5 }],
      {
        legend: false,
        height: "260px",
        type: "bar",
        scales: {
          x: { ticks: { maxRotation: 55, minRotation: 35, font: { size: 9 } }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { callback: (v) => fmt.format(v) } },
        },
      }
    );

    const maint = countsFor("maintenance").slice(0, 8);
    barChart(
      "maint",
      "chart-maint",
      maint.map((d) => d.name),
      [{ label: "Maintenance", data: maint.map((d) => d.count), backgroundColor: "#2e8b57", borderRadius: 5 }],
      { legend: false, height: "220px" }
    );

    const disc = countsFor("disconnection").slice(0, 8);
    barChart(
      "disc",
      "chart-disc",
      disc.map((d) => d.name),
      [{ label: "Disconnection", data: disc.map((d) => d.count), backgroundColor: "#1f6fb2", borderRadius: 5 }],
      { legend: false, height: "220px" }
    );
  }

  function renderFeederCharts() {
    const byBu = state.bu === "ALL"
      ? state.data.feeders_by_bu
      : state.data.feeders_by_bu.filter((r) => r.bu_name === state.bu);

    barChart(
      "fbu",
      "chart-feeder-bu",
      byBu.map((r) => r.bu_name),
      [
        { label: "Feeders", data: byBu.map((r) => r.feeder_count), backgroundColor: "#1f6fb2", borderRadius: 6 },
        { label: "Length (km)", data: byBu.map((r) => Math.round(r.len_km)), backgroundColor: "#d99a1e", borderRadius: 6 },
      ],
      { height: "260px" }
    );

    const sample = filteredFeeders().slice(0, 180);
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
        plugins: { legend: { position: "bottom" } },
        scales: {
          x: { title: { display: true, text: "Length (km)" }, beginAtZero: true },
          y: { title: { display: true, text: "DT count" }, beginAtZero: true },
        },
      },
    });

    const fidelity = filteredFeeders();
    const buckets = [
      { name: "≥95% in-own BU", count: fidelity.filter((f) => f.in_own_bu >= 0.95).length },
      { name: "80–95%", count: fidelity.filter((f) => f.in_own_bu >= 0.8 && f.in_own_bu < 0.95).length },
      { name: "50–80%", count: fidelity.filter((f) => f.in_own_bu >= 0.5 && f.in_own_bu < 0.8).length },
      { name: "<50%", count: fidelity.filter((f) => f.in_own_bu < 0.5).length },
    ];
    barChart(
      "fid",
      "chart-fidelity",
      buckets.map((b) => b.name),
      [{ label: "Feeders", data: buckets.map((b) => b.count), backgroundColor: ["#2e8b57", "#d99a1e", "#c8452c", "#6b7c90"], borderRadius: 6 }],
      { legend: false, height: "240px" }
    );

    renderFeederTable();
  }

  function ringsToLatLngs(rings) {
    return rings.map((ring) => ring.map(([lon, lat]) => [lat, lon]));
  }

  function initMap() {
    if (state.map) return;
    state.map = L.map("map", { zoomControl: true, attributionControl: true }).setView([6.6, 3.45], 11);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Tiles &copy; Esri",
      maxZoom: 16,
    }).addTo(state.map);
    redrawMapLayers();
  }

  function clearMapLayers() {
    Object.values(state.layers).forEach((layer) => {
      if (layer) state.map.removeLayer(layer);
    });
    state.layers = { bu: null, ut: null, dts: null, iss: null, tcn: null };
  }

  function redrawMapLayers() {
    if (!state.map) return;
    clearMapLayers();

    const buPolys = state.data.map.bu_polygons.filter((b) => state.bu === "ALL" || b.bu_name === state.bu);
    const utPolys = state.data.map.ut_polygons.filter((u) => state.bu === "ALL" || u.bu_name === state.bu);

    state.layers.bu = L.layerGroup();
    buPolys.forEach((b) => {
      ringsToLatLngs(b.rings).forEach((latlngs) => {
        L.polygon(latlngs, {
          color: b.fill_hex,
          weight: 2,
          fillColor: b.fill_hex,
          fillOpacity: 0.18,
        })
          .bindPopup(`<strong>${b.bu_name}</strong><br>${fmt.format(b.dt_total)} DTs`)
          .addTo(state.layers.bu);
      });
    });
    state.layers.bu.addTo(state.map);

    state.layers.ut = L.layerGroup();
    utPolys.forEach((u) => {
      ringsToLatLngs(u.rings).forEach((latlngs) => {
        L.polygon(latlngs, {
          color: u.fill_hex,
          weight: 1,
          fillOpacity: 0.05,
          dashArray: "4 4",
        })
          .bindPopup(`<strong>${u.ut_name}</strong> (${u.bu_name})<br>${fmt.format(u.dt_total)} DTs · agreement ${pct(u.agreement_pct)}`)
          .addTo(state.layers.ut);
      });
    });
    state.layers.ut.addTo(state.map);

    const dts = (state.data.map.dt_sample || []).filter((p) => state.bu === "ALL" || p.bu === state.bu);
    state.layers.dts = L.layerGroup();
    dts.forEach((p) => {
      L.circleMarker([p.lat, p.lon], {
        radius: 2.2,
        color: p.own === "PRIVATE" ? "#c8452c" : "#4aa3ff",
        weight: 0,
        fillOpacity: 0.55,
      }).addTo(state.layers.dts);
    });
    state.layers.dts.addTo(state.map);

    state.layers.iss = L.layerGroup();
    (state.data.map.iss || []).forEach((p) => {
      L.circleMarker([p.lat, p.lon], {
        radius: 5,
        color: "#e8a317",
        weight: 2,
        fillColor: "#e8a317",
        fillOpacity: 0.85,
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

    const bounds = [];
    buPolys.forEach((b) => b.rings.forEach((ring) => ring.forEach(([lon, lat]) => bounds.push([lat, lon]))));
    if (bounds.length) state.map.fitBounds(bounds, { padding: [20, 20] });

    document.getElementById("map-legend").innerHTML = `
      ${buPolys.map((b) => `<span><i class="legend-swatch" style="background:${b.fill_hex}"></i>${b.bu_name}</span>`).join("")}
      <span><i class="legend-swatch" style="background:#4aa3ff"></i>Public DT (sample)</span>
      <span><i class="legend-swatch" style="background:#c8452c"></i>Private DT (sample)</span>
      <span><i class="legend-swatch" style="background:#e8a317"></i>ISS</span>
      <span><i class="legend-swatch" style="background:#fff;outline:2px solid #c8452c"></i>TCN</span>
    `;
  }

  function focusUT(utName) {
    const ut = state.data.map.ut_polygons.find((u) => u.ut_name === utName);
    if (!ut || !state.map) return;
    const bounds = [];
    ut.rings.forEach((ring) => ring.forEach(([lon, lat]) => bounds.push([lat, lon])));
    if (bounds.length) state.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
  }

  function refreshAll() {
    renderKPIs();
    renderCompare();
    renderUTTable();
    renderOverviewCharts();
    renderAssetCharts();
    renderFeederCharts();
    redrawMapLayers();
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
        if (btn.dataset.tab === "overview" && state.map) {
          setTimeout(() => state.map.invalidateSize(), 50);
        }
      });
    });
  }

  function wireFilter() {
    const sel = document.getElementById("filter-bu");
    state.data.business_units.forEach((b) => {
      const opt = document.createElement("option");
      opt.value = b.bu_name;
      opt.textContent = b.bu_name;
      sel.appendChild(opt);
    });
    sel.addEventListener("change", () => {
      state.bu = sel.value;
      refreshAll();
    });
  }

  async function boot() {
    chartDefaults();
    wireTabs();
    const res = await fetch("data/dashboard.json");
    if (!res.ok) throw new Error("Failed to load dashboard.json");
    state.data = await res.json();
    document.getElementById("footer-meta").textContent =
      `${state.data.meta.title} · exported ${state.data.meta.generated} · ${state.data.meta.source}`;
    wireFilter();
    refreshAll();
    initMap();
  }

  boot().catch((err) => {
    document.getElementById("footer-meta").textContent = `Error: ${err.message}`;
    console.error(err);
  });
})();
