/* IKEDC 2026 Realignment Command Dashboard */
(() => {
  const fmt = new Intl.NumberFormat("en-US");
  const pct = (n) => `${Number(n).toFixed(1)}%`;

  const state = {
    data: null,
    feedersGeo: null,
    labels: null,
    bu: "ALL",
    ut: "ALL",
    feeder: "ALL",
    map: null,
    layers: {
      bu: null,
      ut: null,
      dts: null,
      iss: null,
      tcn: null,
      feeders11: null,
      feeders33: null,
      buLabels: null,
      utLabels: null,
    },
    charts: {},
    activeTab: "overview",
    rendered: { overview: false, assets: false, feeders: false },
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
    let uts = state.data.undertakings;
    if (state.bu !== "ALL") uts = uts.filter((u) => u.bu_name === state.bu);
    if (state.ut !== "ALL") uts = uts.filter((u) => u.ut_name === state.ut);
    return uts;
  };

  const filteredBUs = () => {
    const bus = state.data.business_units;
    return state.bu === "ALL" ? bus : bus.filter((b) => b.bu_name === state.bu);
  };

  const filteredFeeders = () => {
    let rows = state.data.feeders;
    if (state.bu !== "ALL") rows = rows.filter((f) => f.new_bu === state.bu);
    if (state.ut !== "ALL") rows = rows.filter((f) => f.new_ut === state.ut);
    if (state.feeder !== "ALL") rows = rows.filter((f) => f.feeder === state.feeder);
    return rows;
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

  function renderKPIs() {
    const k = state.data.kpis;
    const bus = filteredBUs();
    const uts = filteredUTs();
    const feeders = filteredFeeders();
    const dtTotal = state.bu === "ALL" && state.ut === "ALL"
      ? k.dt_total
      : uts.reduce((s, u) => s + u.dt_total, 0);
    const dtPub = state.bu === "ALL" && state.ut === "ALL"
      ? k.dt_public
      : uts.reduce((s, u) => s + u.dt_public, 0);
    const dtPriv = state.bu === "ALL" && state.ut === "ALL"
      ? k.dt_private
      : uts.reduce((s, u) => s + u.dt_private, 0);
    const meanAgree = uts.length
      ? uts.reduce((s, u) => s + u.agreement_pct, 0) / uts.length
      : 0;

    const items = [
      { label: "Distribution transformers", value: fmt.format(dtTotal), hint: `${fmt.format(dtPub)} public · ${fmt.format(dtPriv)} private` },
      { label: "Business Units", value: state.bu === "ALL" ? k.bu_2026 : 1, hint: state.bu === "ALL" ? `from ${k.bu_existing} previous` : state.bu, open: "bu" },
      { label: "Undertakings", value: state.ut === "ALL" ? uts.length : 1, hint: state.ut === "ALL" ? (state.bu === "ALL" ? `from ${k.ut_existing} previous` : "in selected BU") : state.ut, open: "ut" },
      { label: "Mean register agreement", value: pct(meanAgree), hint: "DT register vs 2026 UT polygon" },
      { label: "Feeders", value: feeders.length, hint: `${feeders.filter((f) => f.voltage === "11kV").length} × 11 kV · ${feeders.filter((f) => f.voltage === "33kV").length} × 33 kV`, open: "feeder" },
      { label: "Injection / TCN", value: `${k.iss} / ${k.tcn}`, hint: `${fmt.format(k.loads_33kv)} 33 kV loads in TOC` },
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
        state.ut = tr.dataset.ut;
        state.bu = tr.dataset.bu;
        syncComboLabels();
        refreshAll();
        focusUT(tr.dataset.ut);
      });
    });
  }

  function renderFeederTable() {
    const tbody = document.querySelector("#feeder-table tbody");
    const rows = filteredFeeders().slice().sort((a, b) => b.dt_count - a.dt_count).slice(0, 40);
    tbody.innerHTML = rows
      .map(
        (f) => `<tr data-feeder="${encodeURIComponent(f.feeder)}">
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

    tbody.querySelectorAll("tr").forEach((tr) => {
      tr.addEventListener("click", () => {
        state.feeder = decodeURIComponent(tr.dataset.feeder);
        syncComboLabels();
        refreshAll();
      });
    });
  }

  function barChart(key, canvasId, labels, datasets, opts = {}) {
    destroyChart(key);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    state.charts[key] = new Chart(ctx, {
      type: opts.type || "bar",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: opts.legend !== false, position: "bottom", labels: { boxWidth: 12 } },
          tooltip: { mode: "index", intersect: false },
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
    if (!labels.length) {
      const box = ctx.closest(".chart-box");
      if (box) {
        box.dataset.empty = "1";
      }
    }
    state.charts[key] = new Chart(ctx, {
      type: "doughnut",
      data: {
        labels: labels.length ? labels : ["No data"],
        datasets: [{ data: labels.length ? values : [1], backgroundColor: labels.length ? colors : ["#334155"], borderWidth: 0 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
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
        { label: "Public", data: bus.map((b) => b.dt_public), backgroundColor: "#1f6fb2", borderRadius: 6 },
        { label: "Private", data: bus.map((b) => b.dt_private), backgroundColor: "#c8452c", borderRadius: 6 },
      ],
      { stacked: true }
    );

    const uts = filteredUTs().slice().sort((a, b) => a.agreement_pct - b.agreement_pct).slice(0, 20);
    barChart(
      "agree",
      "chart-agreement",
      uts.map((u) => u.ut_name),
      [{
        label: "Agreement %",
        data: uts.map((u) => u.agreement_pct),
        backgroundColor: uts.map((u) => u.fill_hex || buColor(u.bu_name)),
        borderRadius: 4,
      }],
      {
        legend: false,
        scales: {
          x: { ticks: { maxRotation: 55, minRotation: 35, font: { size: 10 } }, grid: { display: false } },
          y: { min: 90, max: 100, ticks: { callback: (v) => `${v}%` } },
        },
      }
    );
    state.rendered.overview = true;
  }

  function countsFor(field) {
    if (state.bu === "ALL") return state.data.dt_analytics.counts[field] || [];
    return state.data.dt_analytics.by_bu[state.bu]?.[field] || [];
  }

  function renderAssetCharts() {
    const palette = ["#c8452c", "#1f6fb2", "#2e8b57", "#d99a1e", "#7a4fb5", "#4aa3a2", "#8b5e3c", "#6b7c90"];
    const metering = countsFor("metering").slice(0, 8);
    doughnut("meter", "chart-metering", metering.map((d) => d.name), metering.map((d) => d.count), palette);
    const connection = countsFor("connection").slice(0, 8);
    doughnut("conn", "chart-connection", connection.map((d) => d.name), connection.map((d) => d.count), palette.slice().reverse());

    const binsOrder = ["≤50", "51–100", "101–200", "201–300", "301–500", ">500", "Unknown"];
    const bins = state.data.dt_analytics.capacity.bins.slice()
      .sort((a, b) => binsOrder.indexOf(a.name) - binsOrder.indexOf(b.name));
    barChart("cap", "chart-capacity", bins.map((b) => b.name), [
      { label: "DTs", data: bins.map((b) => b.count), backgroundColor: "#d99a1e", borderRadius: 6 },
    ], { legend: false });

    const own = countsFor("ownership").slice(0, 6);
    doughnut("own", "chart-ownership", own.map((d) => d.name), own.map((d) => d.count), ["#1f6fb2", "#c8452c", "#6b7c90"]);
    const acc = countsFor("acc_type").slice(0, 6);
    doughnut("acc", "chart-acc", acc.map((d) => d.name), acc.map((d) => d.count), ["#2e8b57", "#d99a1e", "#6b7c90"]);

    let re = state.data.dt_analytics.reassignments || [];
    if (state.bu !== "ALL") {
      re = re.filter((r) => r.name.includes(state.bu));
    }
    re = re.slice(0, 12);
    barChart("re", "chart-reassign", re.map((r) => r.name), [
      { label: "DTs moved", data: re.map((r) => r.count), backgroundColor: "#c8452c", borderRadius: 5 },
    ], {
      legend: false,
      scales: {
        x: { ticks: { maxRotation: 45, minRotation: 30, font: { size: 9 } }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { callback: (v) => fmt.format(v) } },
      },
    });

    const maint = countsFor("maintenance").slice(0, 8);
    barChart("maint", "chart-maint", maint.map((d) => d.name), [
      { label: "Maintenance", data: maint.map((d) => d.count), backgroundColor: "#2e8b57", borderRadius: 5 },
    ], { legend: false });

    const disc = countsFor("disconnection").slice(0, 8);
    barChart("disc", "chart-disc", disc.map((d) => d.name), [
      { label: "Disconnection", data: disc.map((d) => d.count), backgroundColor: "#1f6fb2", borderRadius: 5 },
    ], { legend: false });

    state.rendered.assets = true;
  }

  function renderFeederCharts() {
    const byBu = state.bu === "ALL"
      ? state.data.feeders_by_bu
      : state.data.feeders_by_bu.filter((r) => r.bu_name === state.bu);

    barChart("fbu", "chart-feeder-bu", byBu.map((r) => r.bu_name), [
      { label: "Feeders", data: byBu.map((r) => r.feeder_count), backgroundColor: "#1f6fb2", borderRadius: 6 },
      { label: "Length (km)", data: byBu.map((r) => Math.round(r.len_km)), backgroundColor: "#d99a1e", borderRadius: 6 },
    ]);

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
        animation: false,
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
    barChart("fid", "chart-fidelity", buckets.map((b) => b.name), [
      { label: "Feeders", data: buckets.map((b) => b.count), backgroundColor: ["#2e8b57", "#d99a1e", "#c8452c", "#6b7c90"], borderRadius: 6 },
    ], { legend: false });

    renderFeederTable();
    state.rendered.feeders = true;
  }

  function ringsToLatLngs(rings) {
    return rings.map((ring) => ring.map(([lon, lat]) => [lat, lon]));
  }

  function labelIcon(text, kind, color) {
    const cls = kind === "bu" ? "map-label map-label-bu" : "map-label map-label-ut";
    return L.divIcon({
      className: "",
      html: `<div class="${cls}" style="--label-accent:${color || "#e8a317"}">${text}</div>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
  }

  function updateLabelVisibility() {
    if (!state.map) return;
    const z = state.map.getZoom();
    if (state.layers.buLabels) {
      if (z >= 10) {
        if (!state.map.hasLayer(state.layers.buLabels)) state.map.addLayer(state.layers.buLabels);
      } else if (state.map.hasLayer(state.layers.buLabels)) {
        state.map.removeLayer(state.layers.buLabels);
      }
    }
    if (state.layers.utLabels) {
      if (z >= 12) {
        if (!state.map.hasLayer(state.layers.utLabels)) state.map.addLayer(state.layers.utLabels);
      } else if (state.map.hasLayer(state.layers.utLabels)) {
        state.map.removeLayer(state.layers.utLabels);
      }
    }
  }

  function initMap() {
    if (state.map) return;
    state.map = L.map("map", { zoomControl: true, attributionControl: true }).setView([6.6, 3.45], 11);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}", {
      attribution: "Tiles © Esri",
      maxZoom: 16,
    }).addTo(state.map);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}", {
      attribution: "",
      maxZoom: 16,
      opacity: 0.85,
    }).addTo(state.map);
    state.map.on("zoomend", updateLabelVisibility);
    redrawMapLayers();
  }

  function clearMapLayers() {
    Object.entries(state.layers).forEach(([key, layer]) => {
      if (layer && state.map) {
        try { state.map.removeLayer(layer); } catch (_) { /* ignore */ }
      }
      state.layers[key] = null;
    });
  }

  function redrawMapLayers() {
    if (!state.map) return;
    clearMapLayers();

    const buPolys = state.data.map.bu_polygons.filter((b) => state.bu === "ALL" || b.bu_name === state.bu);
    const utPolys = state.data.map.ut_polygons.filter((u) => {
      if (state.bu !== "ALL" && u.bu_name !== state.bu) return false;
      if (state.ut !== "ALL" && u.ut_name !== state.ut) return false;
      return true;
    });

    state.layers.bu = L.layerGroup();
    buPolys.forEach((b) => {
      ringsToLatLngs(b.rings).forEach((latlngs) => {
        L.polygon(latlngs, {
          color: b.fill_hex,
          weight: 2,
          fillColor: b.fill_hex,
          fillOpacity: 0.14,
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
          fillOpacity: 0.04,
          dashArray: "4 4",
        })
          .bindPopup(`<strong>${u.ut_name}</strong> (${u.bu_name})<br>${fmt.format(u.dt_total)} DTs · agreement ${pct(u.agreement_pct)}`)
          .addTo(state.layers.ut);
      });
    });
    state.layers.ut.addTo(state.map);

    // Feeder lines
    state.layers.feeders11 = L.layerGroup();
    state.layers.feeders33 = L.layerGroup();
    const feederFeatures = (state.feedersGeo && state.feedersGeo.features) || [];
    feederFeatures.forEach((feat) => {
      const p = feat.properties || {};
      if (state.bu !== "ALL" && p.new_bu !== state.bu) return;
      if (state.ut !== "ALL" && p.new_ut !== state.ut) return;
      if (state.feeder !== "ALL" && p.feeder !== state.feeder) return;
      const is33 = p.voltage === "33kV";
      const style = {
        color: is33 ? "#f0a020" : "#4db6ff",
        weight: is33 ? 2.2 : 1.4,
        opacity: state.feeder !== "ALL" ? 0.95 : 0.7,
      };
      const layer = L.geoJSON(feat, {
        style,
        onEachFeature: (f, lyr) => {
          lyr.bindPopup(
            `<strong>${p.feeder}</strong><br>${p.voltage} · ${p.new_bu || "—"} / ${p.new_ut || "—"}<br>` +
            `${fmt.format(p.dt_count || 0)} DTs · ${Number(p.len_km || 0).toFixed(1)} km`
          );
        },
      });
      layer.addTo(is33 ? state.layers.feeders33 : state.layers.feeders11);
    });
    state.layers.feeders11.addTo(state.map);
    state.layers.feeders33.addTo(state.map);

    const dts = (state.data.map.dt_sample || []).filter((p) => {
      if (state.bu !== "ALL" && p.bu !== state.bu) return false;
      if (state.ut !== "ALL" && p.ut !== state.ut) return false;
      return true;
    });
    state.layers.dts = L.layerGroup();
    dts.forEach((p) => {
      L.circleMarker([p.lat, p.lon], {
        radius: 2,
        color: p.own === "PRIVATE" ? "#c8452c" : "#4aa3ff",
        weight: 0,
        fillOpacity: 0.5,
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

    // Labels
    state.layers.buLabels = L.layerGroup();
    ((state.labels && state.labels.bu) || []).forEach((lab) => {
      if (state.bu !== "ALL" && lab.name !== state.bu) return;
      L.marker([lab.lat, lab.lon], { icon: labelIcon(lab.name, "bu", lab.fill), interactive: false })
        .addTo(state.layers.buLabels);
    });

    state.layers.utLabels = L.layerGroup();
    ((state.labels && state.labels.ut) || []).forEach((lab) => {
      if (state.bu !== "ALL" && lab.bu !== state.bu) return;
      if (state.ut !== "ALL" && lab.name !== state.ut) return;
      L.marker([lab.lat, lab.lon], { icon: labelIcon(lab.name, "ut", lab.fill), interactive: false })
        .addTo(state.layers.utLabels);
    });

    updateLabelVisibility();

    const bounds = [];
    buPolys.forEach((b) => b.rings.forEach((ring) => ring.forEach(([lon, lat]) => bounds.push([lat, lon]))));
    if (bounds.length) state.map.fitBounds(bounds, { padding: [20, 20] });

    document.getElementById("map-legend").innerHTML = `
      ${buPolys.map((b) => `<span><i class="legend-swatch" style="background:${b.fill_hex}"></i>${b.bu_name}</span>`).join("")}
      <span><i class="legend-swatch" style="background:#4db6ff"></i>11 kV feeders</span>
      <span><i class="legend-swatch" style="background:#f0a020"></i>33 kV feeders</span>
      <span><i class="legend-swatch" style="background:#4aa3ff"></i>Public DT</span>
      <span><i class="legend-swatch" style="background:#c8452c"></i>Private DT</span>
      <span><i class="legend-swatch" style="background:#e8a317"></i>ISS</span>
      <span><i class="legend-swatch" style="background:#fff;outline:2px solid #c8452c"></i>TCN</span>
      <span>BU labels ≥ zoom 10 · UT labels ≥ zoom 12</span>
    `;
  }

  function focusUT(utName) {
    const ut = state.data.map.ut_polygons.find((u) => u.ut_name === utName);
    if (!ut || !state.map) return;
    const bounds = [];
    ut.rings.forEach((ring) => ring.forEach(([lon, lat]) => bounds.push([lat, lon])));
    if (bounds.length) state.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
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

  function refreshAll() {
    state.rendered = { overview: false, assets: false, feeders: false };
    renderKPIs();
    renderCompare();
    renderUTTable();
    renderActiveTabCharts(true);
    redrawMapLayers();
    populateCombos();
    syncComboLabels();
  }

  /* ---------- Searchable comboboxes ---------- */
  function comboRoot(kind) {
    return document.querySelector(`.combo[data-combo="${kind}"]`);
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
      return [
        { value: "ALL", label: "All BUs" },
        ...state.data.business_units.map((b) => ({ value: b.bu_name, label: b.bu_name })),
      ];
    }
    if (kind === "ut") {
      let uts = state.data.undertakings;
      if (state.bu !== "ALL") uts = uts.filter((u) => u.bu_name === state.bu);
      return [
        { value: "ALL", label: "All UTs" },
        ...uts.map((u) => ({ value: u.ut_name, label: `${u.ut_name} (${u.bu_name})` })),
      ];
    }
    let feeders = state.data.feeders;
    if (state.bu !== "ALL") feeders = feeders.filter((f) => f.new_bu === state.bu);
    if (state.ut !== "ALL") feeders = feeders.filter((f) => f.new_ut === state.ut);
    feeders = feeders.slice().sort((a, b) => a.feeder.localeCompare(b.feeder));
    return [
      { value: "ALL", label: "All feeders" },
      ...feeders.map((f) => ({ value: f.feeder, label: `${f.feeder} · ${f.voltage}` })),
    ];
  }

  function fillComboList(kind, query) {
    const root = comboRoot(kind);
    const list = root.querySelector(".combo-list");
    const q = (query || "").trim().toLowerCase();
    let items = comboItems(kind);
    if (q) items = items.filter((i) => i.label.toLowerCase().includes(q) || i.value.toLowerCase().includes(q));
    if (!items.length) {
      list.innerHTML = `<li class="empty">No matches</li>`;
      return;
    }
    const selected = state[kind === "feeder" ? "feeder" : kind];
    list.innerHTML = items
      .map((i) => `<li><button type="button" role="option" data-value="${encodeURIComponent(i.value)}" aria-selected="${i.value === selected}">${i.label}</button></li>`)
      .join("");
    list.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const value = decodeURIComponent(btn.dataset.value);
        if (kind === "bu") {
          state.bu = value;
          state.ut = "ALL";
          state.feeder = "ALL";
        } else if (kind === "ut") {
          state.ut = value;
          state.feeder = "ALL";
          if (value !== "ALL") {
            const hit = state.data.undertakings.find((u) => u.ut_name === value);
            if (hit) state.bu = hit.bu_name;
          }
        } else {
          state.feeder = value;
          if (value !== "ALL") {
            const hit = state.data.feeders.find((f) => f.feeder === value);
            if (hit) {
              if (hit.new_bu) state.bu = hit.new_bu;
              if (hit.new_ut) state.ut = hit.new_ut;
            }
          }
        }
        closeAllCombos();
        refreshAll();
      });
    });
  }

  function syncComboLabels() {
    const buLabel = state.bu === "ALL" ? "All BUs" : state.bu;
    const utLabel = state.ut === "ALL" ? "All UTs" : state.ut;
    const feederLabel = state.feeder === "ALL"
      ? "All feeders"
      : (state.feeder.length > 28 ? state.feeder.slice(0, 28) + "…" : state.feeder);
    const set = (kind, text) => {
      const el = comboRoot(kind)?.querySelector(".combo-value");
      if (el) el.textContent = text;
    };
    set("bu", buLabel);
    set("ut", utLabel);
    set("feeder", feederLabel);
  }

  function populateCombos() {
    ["bu", "ut", "feeder"].forEach((kind) => {
      const root = comboRoot(kind);
      if (!root) return;
      const search = root.querySelector(".combo-search");
      fillComboList(kind, search.value || "");
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

  async function boot() {
    chartDefaults();
    wireTabs();
    wireCombos();

    const [dashRes, feedRes, labelRes] = await Promise.all([
      fetch("data/dashboard.json"),
      fetch("data/feeders.geojson"),
      fetch("data/map_labels.json"),
    ]);
    if (!dashRes.ok) throw new Error("Failed to load dashboard.json");
    state.data = await dashRes.json();
    state.feedersGeo = feedRes.ok ? await feedRes.json() : { type: "FeatureCollection", features: [] };
    state.labels = labelRes.ok ? await labelRes.json() : { bu: [], ut: [] };

    document.getElementById("footer-meta").textContent =
      `${state.data.meta.title} · exported ${state.data.meta.generated} · ${state.data.meta.source}`;

    refreshAll();
    initMap();
  }

  boot().catch((err) => {
    document.getElementById("footer-meta").textContent = `Error: ${err.message}`;
    console.error(err);
  });
})();
