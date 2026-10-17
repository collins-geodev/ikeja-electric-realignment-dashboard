/* Stars, ambient instrumental, theme, coverage replica, story map, PDF export, live feeds */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const fmt = new Intl.NumberFormat("en-US");

  const experience = {
    view: "intelligence",
    theme: localStorage.getItem("ikedc-theme") || "dark",
    audioOn: false,
    audioCtx: null,
    nodes: null,
    starsRaf: 0,
    coverageMap: null,
    coverageLayers: { bus: null, feeders: null, highlight: null, buLabels: null, utLabels: null },
    labels: null,
    coverageCharts: {},
    coverageFocusBu: null,
    coverageFocusFeeder: null,
    lagos: null,
    storyMap: null,
    storyMaps: {},
    storyCharts: {},
    storyObserver: null,
    storyTab: "glance",
    storyWired: false,
  };

  const ESRI = {
    imagery: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    labels: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    lightGray: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    darkGray: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
  };

  function hybridBasemapGroup() {
    return L.layerGroup([
      L.tileLayer(ESRI.imagery, { attribution: "Tiles © Esri", maxZoom: 19 }),
      L.tileLayer(ESRI.labels, { attribution: "Labels © Esri", maxZoom: 19, opacity: 0.92 }),
    ]);
  }

  function chartColors() {
    const light = document.documentElement.getAttribute("data-theme") === "light";
    return {
      light,
      text: light ? "#0f1c2e" : "#eef3fa",
      muted: light ? "#3d4f63" : "#a8b7c9",
      border: light ? "rgba(15,30,50,0.14)" : "rgba(255,255,255,0.10)",
      labelStroke: light ? "rgba(255,255,255,0.95)" : "rgba(8,12,18,0.92)",
      labelFill: light ? "#0f1c2e" : "#ffffff",
    };
  }

  /* ---------- Theme ---------- */
  function syncBrandLogos(theme) {
    const src = theme === "light"
      ? "assets/ikeja-electric-logo-light.png"
      : "assets/ikeja-electric-logo.png";
    $$("img.brand-logo, .chrome-brand-trio img[data-brand='ie']").forEach((img) => {
      if (img.getAttribute("src") !== src) img.setAttribute("src", src);
    });
  }

  function applyTheme(theme) {
    experience.theme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("ikedc-theme", theme);
    const btn = $("#btn-theme");
    if (btn) btn.textContent = theme === "dark" ? "Light mode" : "Dark mode";
    syncBrandLogos(theme);
    window.IKEDC?.setMapTheme?.(theme);
    window.IKEDC?.refreshChartTheme?.();
    Object.values(experience.coverageCharts).forEach((c) => {
      try { restyleChart(c); c.update("none"); } catch (_) { /* ignore */ }
    });
    Object.values(experience.storyCharts).forEach((c) => {
      try { restyleChart(c); c.update("none"); } catch (_) { /* ignore */ }
    });
  }

  function restyleChart(chart) {
    const t = chartColors();
    if (chart.options.plugins?.legend?.labels) {
      chart.options.plugins.legend.labels.color = t.text;
    }
    ["x", "y", "r"].forEach((axis) => {
      const s = chart.options.scales?.[axis];
      if (!s) return;
      if (s.ticks) s.ticks.color = t.muted;
      if (s.grid) s.grid.color = t.border;
      if (s.border) s.border.color = t.border;
    });
  }

  /* ---------- Starfield ---------- */
  function initStars() {
    const canvas = $("#starfield");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let stars = [];
    const resize = () => {
      canvas.width = window.innerWidth * devicePixelRatio;
      canvas.height = window.innerHeight * devicePixelRatio;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      const n = Math.min(180, Math.floor((window.innerWidth * window.innerHeight) / 12000));
      stars = Array.from({ length: n }, () => ({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: (Math.random() * 1.4 + 0.3) * devicePixelRatio,
        a: Math.random(),
        s: Math.random() * 0.02 + 0.005,
        phase: Math.random() * Math.PI * 2,
      }));
    };
    resize();
    window.addEventListener("resize", resize);
    const draw = (t) => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const light = document.documentElement.getAttribute("data-theme") === "light";
      stars.forEach((st) => {
        const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * st.s + st.phase));
        ctx.beginPath();
        ctx.fillStyle = light
          ? `rgba(146, 64, 14, ${tw * 0.35})`
          : `rgba(255, 230, 180, ${tw * 0.85})`;
        ctx.arc(st.x, st.y, st.r * (0.8 + tw * 0.5), 0, Math.PI * 2);
        ctx.fill();
      });
      experience.starsRaf = requestAnimationFrame(draw);
    };
    experience.starsRaf = requestAnimationFrame(draw);
  }

  /* Ambient instrumental is owned by js/audio.js (hosted royalty-free track). */
  function setAudio(on) {
    experience.audioOn = on;
    if (window.IKEDCAudio?.setPlaying) {
      window.IKEDCAudio.setPlaying(on);
      return;
    }
    const btn = $("#btn-audio");
    if (btn) btn.textContent = on ? "Mute ambient instrumental" : "Play ambient instrumental";
  }

  /* ---------- View switching ---------- */
  function showView(view) {
    experience.view = view;
    $$(".app-view").forEach((el) => {
      el.hidden = el.dataset.view !== view;
    });
    $$("[data-goto]").forEach((btn) => {
      btn.classList.toggle("active-view", btn.dataset.goto === view);
    });
    if (view === "coverage") {
      requestAnimationFrame(() => {
        initCoverage();
        window.IKEDCFeeds?.mount?.("cov-feed", { limit: 16 });
      });
    }
    if (view === "story") {
      requestAnimationFrame(() => {
        initStory();
        window.IKEDCFeeds?.mount?.("story-feed", { limit: 12 });
      });
    }
    if (view === "intelligence") {
      window.IKEDC?.resize?.();
      requestAnimationFrame(() => {
        window.IKEDCFeeds?.mount?.("intel-feed", { limit: 8 });
      });
    }
    history.replaceState(null, "", `#${view}`);
  }

  function resetCurrent() {
    if (experience.view === "intelligence" || experience.view === "coverage") {
      window.IKEDC?.resetFilters?.();
    }
    if (experience.view === "coverage") {
      experience.coverageFocusBu = null;
      experience.coverageFocusFeeder = null;
      initCoverage(true);
    }
    if (experience.view === "story") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    const status = $("#io-status");
    if (status) {
      status.hidden = false;
      status.textContent = "Dashboard reset.";
      setTimeout(() => { status.hidden = true; }, 2500);
    }
  }

  /* ---------- Coverage dashboard ---------- */
  let coverageBaseLayer = null;
  let coverageLayerControl = null;

  function setCoverageBasemap() {
    if (!experience.coverageMap) return;
    if (coverageBaseLayer) experience.coverageMap.removeLayer(coverageBaseLayer);
    coverageBaseLayer = hybridBasemapGroup();
    coverageBaseLayer.addTo(experience.coverageMap);
    if (!coverageLayerControl) {
      const gray = experience.theme === "light" ? ESRI.lightGray : ESRI.darkGray;
      coverageLayerControl = L.control.layers(
        {
          "Hybrid satellite": coverageBaseLayer,
          "Light canvas": L.tileLayer(ESRI.lightGray, { attribution: "Tiles © Esri", maxZoom: 16 }),
          "Dark canvas": L.tileLayer(ESRI.darkGray, { attribution: "Tiles © Esri", maxZoom: 16 }),
          Streets: L.tileLayer(gray, { attribution: "Tiles © Esri", maxZoom: 16 }),
        },
        null,
        { position: "topright", collapsed: true }
      ).addTo(experience.coverageMap);
    }
  }

  function busInFocus(data) {
    const bus = data.business_units.slice();
    if (!experience.coverageFocusBu) return bus;
    return bus.filter((b) => b.bu_name === experience.coverageFocusBu);
  }

  function setCoverageFocus(buName) {
    experience.coverageFocusBu = buName || null;
    experience.coverageFocusFeeder = null;
    initCoverage(false, { keepMap: true });
  }

  function initCoverage(force, opts = {}) {
    const data = window.IKEDC?.getData?.();
    if (!data) return;
    const k = data.kpis;
    const totalArea = data.business_units.reduce((s, b) => s + (b.area_km2 || 0), 0);
    const dens = (totalArea ? k.dt_total / totalArea : 0).toFixed(1);
    const focused = busInFocus(data);
    const focus = focused[0];

    $("#cov-kpi-area").textContent = focus && experience.coverageFocusBu
      ? `${Number(focus.area_km2).toLocaleString()} km²`
      : `${Number(totalArea).toLocaleString()} km²`;
    $("#cov-kpi-alt").textContent = focus && experience.coverageFocusBu
      ? (focus.area_km2 ? (focus.dt_total / focus.area_km2).toFixed(1) : dens)
      : dens;
    $("#cov-kpi-alt-label").textContent = "DT DENSITY";
    $("#cov-kpi-alt-hint").textContent = experience.coverageFocusBu
      ? `transformers per km² · ${experience.coverageFocusBu}`
      : "transformers per km² across 2026 BUs";
    $("#cov-kpi-feeders").textContent = experience.coverageFocusBu
      ? String((data.feeders_by_bu || []).find((r) => r.bu_name === experience.coverageFocusBu)?.feeder_count || "—")
      : `${k.feeders_total}`;
    $("#cov-kpi-dts").textContent = experience.coverageFocusBu
      ? Number(focus.dt_total).toLocaleString()
      : Number(k.dt_total).toLocaleString();
    const agreeVal = (() => {
      const uts = experience.coverageFocusBu
        ? data.undertakings.filter((u) => u.bu_name === experience.coverageFocusBu)
        : data.undertakings;
      if (!uts.length) return k.mean_agreement_pct;
      return +(uts.reduce((s, u) => s + u.agreement_pct, 0) / uts.length).toFixed(1);
    })();
    $("#cov-kpi-agree").textContent = `${agreeVal}%`;

    const subtitle = $("#cov-map-subtitle");
    if (subtitle) {
      subtitle.textContent = experience.coverageFocusBu
        ? `Hybrid satellite · focused on ${experience.coverageFocusBu}`
        : "Hybrid satellite · Lagos boundary · BU fills · feeder corridors";
    }

    renderCovChips(data);
    renderCovInsights(data, totalArea);
    renderCovFeederList(data);

    if (!experience.coverageMap || force) {
      const el = $("#coverage-map");
      if (experience.coverageMap) {
        experience.coverageMap.remove();
        experience.coverageMap = null;
        coverageLayerControl = null;
      }
      experience.coverageMap = L.map(el, { zoomControl: true }).setView([6.55, 3.5], 10);
      setCoverageBasemap();
    }

    if (!opts.keepMap || force || !experience.coverageLayers.bus) {
      redrawCoverageLayers(data);
    } else {
      redrawCoverageLayers(data);
    }

    destroyCovCharts();
    const bus = data.business_units.slice().sort((a, b) => b.dt_total - a.dt_total);
    const t = chartColors();
    const ctx1 = $("#chart-cov-band");
    const ctx2 = $("#chart-cov-phase");
    if (ctx1 && window.Chart) {
      experience.coverageCharts.band = new Chart(ctx1, {
        type: "doughnut",
        data: {
          labels: bus.map((b) => b.bu_name),
          datasets: [{
            data: bus.map((b) => b.dt_total),
            backgroundColor: bus.map((b) => b.fill_hex),
            borderWidth: 2,
            borderColor: t.light ? "#ffffff" : "#0b1017",
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          onClick: (_evt, elems) => {
            if (!elems.length) return;
            setCoverageFocus(bus[elems[0].index]?.bu_name);
          },
          plugins: {
            legend: { position: "bottom", labels: { boxWidth: 10, color: t.text, font: { size: 11 } } },
            valueLabels: { display: true, decimals: 0, fontSize: 12 },
          },
          cutout: "52%",
        },
      });
    }
    if (ctx2 && window.Chart) {
      const agreeData = bus.map((b) => {
        const uts = data.undertakings.filter((u) => u.bu_name === b.bu_name);
        return uts.length ? +(uts.reduce((s, u) => s + u.agreement_pct, 0) / uts.length).toFixed(1) : 0;
      });
      experience.coverageCharts.phase = new Chart(ctx2, {
        type: "bar",
        data: {
          labels: bus.map((b) => b.bu_name),
          datasets: [{
            label: "Agreement %",
            data: agreeData,
            backgroundColor: bus.map((b) => (
              experience.coverageFocusBu && b.bu_name !== experience.coverageFocusBu
                ? `${b.fill_hex}66`
                : "#2e8b57"
            )),
            borderRadius: 6,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 22 } },
          onClick: (_evt, elems) => {
            if (!elems.length) return;
            setCoverageFocus(bus[elems[0].index]?.bu_name);
          },
          plugins: {
            legend: { display: false },
            valueLabels: { display: true, suffix: "%", decimals: 1, fontSize: 12 },
          },
          scales: {
            x: { grid: { display: false }, ticks: { color: t.muted } },
            y: {
              min: 90,
              max: 100,
              ticks: { color: t.muted, callback: (v) => `${v}%` },
              grid: { color: t.border },
            },
          },
        },
      });
    }

    $$(".cov-kpi").forEach((el) => {
      el.classList.toggle("active", !!experience.coverageFocusBu);
      el.onclick = () => {
        if (experience.coverageFocusBu) setCoverageFocus(null);
        else {
          const heaviest = bus[0]?.bu_name;
          if (heaviest) setCoverageFocus(heaviest);
        }
      };
    });
  }

  function mapLabelIcon(text, kind, color) {
    const size = kind === "bu" ? 12 : 10;
    return L.divIcon({
      className: kind === "bu" ? "map-label-bu" : "map-label-ut",
      html: `<div style="transform:translate(-50%,-50%);padding:${kind === "bu" ? "3px 9px" : "2px 6px"};border-radius:999px;font:700 ${size}px Sora,sans-serif;color:#fff;background:${color || "#334"};border:1px solid rgba(255,255,255,.35);white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,.45)">${text}</div>`,
      iconSize: [0, 0],
    });
  }

  function updateCoverageLabelVisibility() {
    const map = experience.coverageMap;
    if (!map) return;
    const z = map.getZoom();
    const buMin = window.IKEDC?.LABEL_ZOOM?.bu ?? 9;
    const utMin = window.IKEDC?.LABEL_ZOOM?.ut ?? 11;
    if (experience.coverageLayers.buLabels) {
      if (z >= buMin) map.addLayer(experience.coverageLayers.buLabels);
      else map.removeLayer(experience.coverageLayers.buLabels);
    }
    if (experience.coverageLayers.utLabels) {
      if (z >= utMin) map.addLayer(experience.coverageLayers.utLabels);
      else map.removeLayer(experience.coverageLayers.utLabels);
    }
  }

  function redrawCoverageLayers(data) {
    if (!experience.coverageMap) return;
    ["bus", "feeders", "highlight", "lagos", "buLabels", "utLabels"].forEach((k) => {
      if (experience.coverageLayers[k]) {
        experience.coverageMap.removeLayer(experience.coverageLayers[k]);
        experience.coverageLayers[k] = null;
      }
    });

    const bounds = [];
    if (experience.lagos?.features?.length) {
      experience.coverageLayers.lagos = L.geoJSON(experience.lagos, {
        style: { color: "#f0b429", weight: 2.5, fillOpacity: 0.02, dashArray: "6 4" },
      }).addTo(experience.coverageMap);
    }

    const buGroup = L.layerGroup();
    data.map.bu_polygons.forEach((b) => {
      const dim = experience.coverageFocusBu && b.bu_name !== experience.coverageFocusBu;
      b.rings.forEach((ring) => {
        const latlngs = ring.map(([lon, lat]) => [lat, lon]);
        L.polygon(latlngs, {
          color: b.fill_hex,
          weight: dim ? 1 : 2.4,
          fillColor: b.fill_hex,
          fillOpacity: dim ? 0.06 : 0.28,
        })
          .bindPopup(`<strong>${b.bu_name}</strong>`)
          .on("click", () => setCoverageFocus(b.bu_name))
          .addTo(buGroup);
        if (!dim) latlngs.forEach((ll) => bounds.push(ll));
      });
    });
    experience.coverageLayers.bus = buGroup.addTo(experience.coverageMap);

    const feeders = window.IKEDC?.getFeedersGeo?.();
    const feederGroup = L.layerGroup();
    if (feeders?.features) {
      feeders.features.forEach((feat) => {
        const p = feat.properties || {};
        const bu = p.new_bu || p.bu;
        if (experience.coverageFocusBu && bu && bu !== experience.coverageFocusBu) return;
        const name = p.feeder || p.name || "";
        const isFocus = experience.coverageFocusFeeder && String(name).toLowerCase().includes(String(experience.coverageFocusFeeder).toLowerCase());
        const is33 = String(p.voltage || "").includes("33");
        L.geoJSON(feat, {
          style: {
            color: isFocus ? "#ff4d4d" : (is33 ? "#f0a020" : "#4db6ff"),
            weight: isFocus ? 4 : (is33 ? 2.2 : 1.4),
            opacity: isFocus ? 1 : 0.85,
          },
          onEachFeature: (_f, lyr) => {
            lyr.bindPopup(`<strong>${name}</strong><br>${p.voltage || ""} · ${bu || "—"}`);
            lyr.on("click", () => {
              experience.coverageFocusFeeder = name;
              redrawCoverageLayers(data);
              renderCovFeederList(data);
            });
          },
        }).addTo(feederGroup);
      });
    }
    experience.coverageLayers.feeders = feederGroup.addTo(experience.coverageMap);

    const labels = experience.labels || window.IKEDC?.getLabels?.() || { bu: [], ut: [] };
    const buLab = L.layerGroup();
    (labels.bu || []).forEach((lab) => {
      if (experience.coverageFocusBu && lab.name !== experience.coverageFocusBu) return;
      L.marker([lab.lat, lab.lon], { icon: mapLabelIcon(lab.name, "bu", lab.fill), interactive: false }).addTo(buLab);
    });
    experience.coverageLayers.buLabels = buLab;

    const utLab = L.layerGroup();
    (labels.ut || []).forEach((lab) => {
      if (experience.coverageFocusBu && lab.bu !== experience.coverageFocusBu) return;
      L.marker([lab.lat, lab.lon], { icon: mapLabelIcon(lab.name, "ut", lab.fill), interactive: false }).addTo(utLab);
    });
    experience.coverageLayers.utLabels = utLab;

    experience.coverageMap.off("zoomend", updateCoverageLabelVisibility);
    experience.coverageMap.on("zoomend", updateCoverageLabelVisibility);
    updateCoverageLabelVisibility();

    if (bounds.length) {
      experience.coverageMap.fitBounds(bounds, { padding: [28, 28], maxZoom: 12 });
    }
    setTimeout(() => experience.coverageMap.invalidateSize(), 80);
  }

  function renderCovChips(data) {
    const host = $("#cov-bu-chips");
    if (!host) return;
    host.innerHTML = data.business_units.map((b) => `
      <button type="button" class="cov-bu-chip ${experience.coverageFocusBu === b.bu_name ? "active" : ""}" data-bu="${b.bu_name}" style="border-color:${b.fill_hex}">
        ${b.bu_name}
      </button>`).join("");
    host.querySelectorAll("[data-bu]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const bu = btn.dataset.bu;
        setCoverageFocus(experience.coverageFocusBu === bu ? null : bu);
      });
    });
    $("#cov-clear-filter")?.addEventListener("click", () => setCoverageFocus(null), { once: true });
  }

  function renderCovInsights(data, totalArea) {
    const host = $("#cov-insights");
    if (!host) return;
    const bus = data.business_units.slice().sort((a, b) => b.dt_total - a.dt_total);
    const densest = data.business_units.slice().sort((a, b) => (b.dt_total / b.area_km2) - (a.dt_total / a.area_km2))[0];
    const widest = data.business_units.slice().sort((a, b) => b.area_km2 - a.area_km2)[0];
    const heaviestUts = data.undertakings.slice().sort((a, b) => b.dt_total - a.dt_total).slice(0, 1)[0];
    const cards = [
      {
        bu: bus[0]?.bu_name,
        title: "Largest DT workload",
        metric: fmt.format(bus[0]?.dt_total || 0),
        body: `${bus[0]?.bu_name || "—"} carries the most transformers in the 2026 register.`,
      },
      {
        bu: densest?.bu_name,
        title: "Highest DT density",
        metric: densest ? `${(densest.dt_total / densest.area_km2).toFixed(1)} / km²` : "—",
        body: `${densest?.bu_name || "—"} packs the highest transformers per square kilometre.`,
      },
      {
        bu: widest?.bu_name,
        title: "Widest territory",
        metric: widest ? `${widest.area_km2.toFixed(0)} km²` : "—",
        body: `${widest?.bu_name || "—"} covers ${((widest?.area_km2 || 0) / totalArea * 100).toFixed(0)}% of franchise area.`,
      },
      {
        bu: heaviestUts?.bu_name,
        title: "Heaviest Undertaking",
        metric: heaviestUts ? fmt.format(heaviestUts.dt_total) : "—",
        body: `${heaviestUts?.ut_name || "—"} (${heaviestUts?.bu_name || "—"}) leads UT DT counts.`,
      },
      {
        bu: null,
        title: "Public vs private",
        metric: `${fmt.format(data.kpis.dt_public)} / ${fmt.format(data.kpis.dt_private)}`,
        body: "Public and private transformers across the full DT register.",
      },
      {
        bu: null,
        title: "Network corridors",
        metric: `${data.kpis.feeders_11kv} · ${data.kpis.feeders_33kv}`,
        body: "11 kV and 33 kV feeders tagged to 2026 Business Units.",
      },
    ];
    host.innerHTML = cards.map((c) => `
      <button type="button" class="cov-insight ${experience.coverageFocusBu && c.bu === experience.coverageFocusBu ? "active" : ""}" data-bu="${c.bu || ""}">
        <h3>${c.title}</h3>
        <div class="metric">${c.metric}</div>
        <p>${c.body}</p>
      </button>`).join("");
    host.querySelectorAll(".cov-insight").forEach((btn) => {
      btn.addEventListener("click", () => {
        const bu = btn.dataset.bu;
        if (bu) setCoverageFocus(experience.coverageFocusBu === bu ? null : bu);
      });
    });
  }

  function renderCovFeederList(data) {
    const host = $("#cov-feeder-list");
    if (!host) return;
    let rows = (data.feeders || []).slice();
    if (experience.coverageFocusBu) {
      rows = rows.filter((f) => f.new_bu === experience.coverageFocusBu);
    }
    rows.sort((a, b) => (b.dt_count || 0) - (a.dt_count || 0));
    rows = rows.slice(0, 12);
    if (!rows.length) {
      host.innerHTML = `<li><button type="button" disabled>No feeders in current focus</button></li>`;
      return;
    }
    host.innerHTML = rows.map((f) => `
      <li><button type="button" class="${experience.coverageFocusFeeder === f.feeder ? "active" : ""}" data-feeder="${f.feeder}">
        ${f.feeder} · ${fmt.format(f.dt_count || 0)} DTs · ${f.new_bu || "—"}
      </button></li>`).join("");
    host.querySelectorAll("[data-feeder]").forEach((btn) => {
      btn.addEventListener("click", () => {
        experience.coverageFocusFeeder = btn.dataset.feeder;
        if (!experience.coverageFocusBu) {
          const row = rows.find((r) => r.feeder === btn.dataset.feeder);
          if (row?.new_bu) experience.coverageFocusBu = row.new_bu;
        }
        redrawCoverageLayers(data);
        renderCovFeederList(data);
        renderCovChips(data);
      });
    });
  }

  function destroyCovCharts() {
    Object.values(experience.coverageCharts).forEach((c) => c.destroy());
    experience.coverageCharts = {};
  }

  /* ---------- Story map ---------- */
  const BU_BLURBS = {
    IKEJA: "10 Undertakings and the largest asset base — the busiest Business Unit in the franchise.",
    AKOWONJO: "10 Undertakings across a varied urban mix, including Dopemu, the heaviest Undertaking.",
    IKORODU: "The widest territory — nearly two-thirds of franchise area, where distance drives workload.",
    OSHODI: "Consolidated Undertakings with a nearly even public/private transformer mix.",
    SHOMOLU: "The densest Business Unit — compact territory and short travel between assets.",
  };

  function showStoryTab(tabId, { animate = true } = {}) {
    const id = tabId || "glance";
    experience.storyTab = id;
    $$(".story-nav [data-story-tab]").forEach((btn) => {
      const on = btn.dataset.storyTab === id;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    $$(".story-panel").forEach((panel) => {
      const on = panel.dataset.storyPanel === id;
      panel.hidden = !on;
      panel.classList.toggle("active", on);
      if (on && animate) {
        panel.classList.remove("story-panel-enter");
        // restart CSS animation
        void panel.offsetWidth;
        panel.classList.add("story-panel-enter");
      }
    });
    requestAnimationFrame(() => {
      Object.values(experience.storyCharts).forEach((c) => {
        try { c.resize(); } catch (_) { /* ignore */ }
      });
      if (experience.storyMap) {
        try { experience.storyMap.invalidateSize(); } catch (_) { /* ignore */ }
      }
      Object.values(experience.storyMaps).forEach((m) => {
        try { m.invalidateSize(); } catch (_) { /* ignore */ }
      });
      if (id === "feeds") window.IKEDCFeeds?.mount?.("story-feed", { limit: 14 });
      if (id === "before" || id === "glance" || id === "quality") {
        const data = window.IKEDC?.getData?.();
        if (data) ensureStoryMaps(data);
      }
    });
  }

  function wireStoryTabs() {
    if (experience.storyWired) return;
    experience.storyWired = true;
    $$(".story-nav [data-story-tab]").forEach((btn) => {
      btn.addEventListener("click", () => showStoryTab(btn.dataset.storyTab, { animate: true }));
    });
  }

  function initStory() {
    const data = window.IKEDC?.getData?.();
    if (!data || !window.Chart) return;

    const stats = $("#story-stats");
    if (stats) {
      stats.innerHTML = `
        <div><strong>${data.kpis.bu_2026}</strong><span>Business Units</span></div>
        <div><strong>${data.kpis.ut_2026}</strong><span>Undertakings</span></div>
        <div><strong>${fmt.format(data.kpis.dt_total)}</strong><span>Distribution transformers</span></div>
        <div><strong>${data.kpis.feeders_total}</strong><span>MV feeders</span></div>`;
    }

    const cards = $("#story-bu-cards");
    if (cards) {
      cards.innerHTML = data.business_units.map((b) => `
        <button type="button" class="story-bu-card" style="--bu-color:${b.fill_hex}" data-bu="${b.bu_name}">
          <h3>${b.bu_name}</h3>
          <p>${BU_BLURBS[b.bu_name] || `${b.ut_count} UTs · ${fmt.format(b.dt_total)} DTs · ${b.area_km2.toFixed(0)} km²`}</p>
          <p style="margin-top:0.45rem"><strong>${fmt.format(b.dt_total)}</strong> DTs · <strong>${(b.dt_total / b.area_km2).toFixed(1)}</strong> / km²</p>
        </button>`).join("");
      cards.querySelectorAll("[data-bu]").forEach((btn) => {
        btn.addEventListener("click", () => {
          window.IKEDC?.setFilters?.({ bus: [btn.dataset.bu], uts: [], feeders: [], dts: [] });
          setCoverageFocus(btn.dataset.bu);
        });
      });
    }

    wireStoryTabs();
    initStoryCharts(data);
    showStoryTab(experience.storyTab || "glance", { animate: true });
  }

  function paintStoryMap(el, data, key) {
    if (!el || !window.L) return null;
    if (experience.storyMaps[key]?._container === el) {
      setTimeout(() => experience.storyMaps[key].invalidateSize(), 60);
      return experience.storyMaps[key];
    }
    if (experience.storyMaps[key]) {
      try { experience.storyMaps[key].remove(); } catch (_) { /* ignore */ }
      experience.storyMaps[key] = null;
    }
    if (key === "before" && experience.storyMap && experience.storyMap !== experience.storyMaps.before) {
      try { experience.storyMap.remove(); } catch (_) { /* ignore */ }
      experience.storyMap = null;
    }
    const map = L.map(el, { zoomControl: true, attributionControl: false }).setView([6.55, 3.5], 10);
    hybridBasemapGroup().addTo(map);
    const bounds = [];
    data.map.bu_polygons.forEach((b) => {
      b.rings.forEach((ring) => {
        const latlngs = ring.map(([lon, lat]) => [lat, lon]);
        L.polygon(latlngs, {
          color: b.fill_hex, weight: 2, fillColor: b.fill_hex, fillOpacity: 0.35,
        })
          .bindTooltip(b.bu_name)
          .on("click", () => {
            window.IKEDC?.setFilters?.({ bus: [b.bu_name], uts: [], feeders: [], dts: [] });
          })
          .addTo(map);
        latlngs.forEach((ll) => bounds.push(ll));
      });
    });
    const labels = experience.labels || window.IKEDC?.getLabels?.() || { bu: [], ut: [] };
    const buLab = L.layerGroup();
    const utLab = L.layerGroup();
    (labels.bu || []).forEach((lab) => {
      L.marker([lab.lat, lab.lon], { icon: mapLabelIcon(lab.name, "bu", lab.fill), interactive: false }).addTo(buLab);
    });
    (labels.ut || []).forEach((lab) => {
      L.marker([lab.lat, lab.lon], { icon: mapLabelIcon(lab.name, "ut", lab.fill), interactive: false }).addTo(utLab);
    });
    const sync = () => {
      const z = map.getZoom();
      const buMin = window.IKEDC?.LABEL_ZOOM?.bu ?? 9;
      const utMin = window.IKEDC?.LABEL_ZOOM?.ut ?? 11;
      if (z >= buMin) map.addLayer(buLab); else map.removeLayer(buLab);
      if (z >= utMin) map.addLayer(utLab); else map.removeLayer(utLab);
    };
    map.on("zoomend", sync);
    sync();
    if (bounds.length) map.fitBounds(bounds, { padding: [12, 12] });
    setTimeout(() => map.invalidateSize(), 80);
    experience.storyMaps[key] = map;
    if (key === "before") experience.storyMap = map;
    return map;
  }

  function ensureStoryMaps(data) {
    if (!data) return;
    if (experience.storyTab === "glance") {
      const glance = $("#story-map-glance");
      if (glance) paintStoryMap(glance, data, "glance");
    } else if (experience.storyTab === "before") {
      const before = $("#story-map");
      if (before) paintStoryMap(before, data, "before");
    } else if (experience.storyTab === "quality") {
      const quality = $("#story-map-quality");
      if (quality) paintStoryMap(quality, data, "quality");
    }
  }

  function destroyStoryCharts() {
    Object.values(experience.storyCharts).forEach((c) => {
      try { c.destroy(); } catch (_) { /* ignore */ }
    });
    experience.storyCharts = {};
  }

  function initStoryCharts(data) {
    destroyStoryCharts();
    const bus = data.business_units;
    const t = chartColors();

    const mk = (id, cfg) => {
      const el = document.getElementById(id);
      if (!el) return;
      experience.storyCharts[id] = new Chart(el, cfg);
    };

    const storyFilterBu = (buName) => {
      if (!buName) return;
      window.IKEDC?.setFilters?.({ bus: [buName], uts: [], feeders: [], dts: [] });
      setCoverageFocus(buName);
    };

    const byBuAgree = bus.map((b) => {
      const uts = data.undertakings.filter((u) => u.bu_name === b.bu_name);
      return uts.length ? +(uts.reduce((s, u) => s + u.agreement_pct, 0) / uts.length).toFixed(1) : 0;
    });

    mk("story-chart-glance-bu", {
      type: "doughnut",
      data: {
        labels: bus.map((b) => b.bu_name),
        datasets: [{
          data: bus.map((b) => b.dt_total),
          backgroundColor: bus.map((b) => b.fill_hex),
          borderWidth: 2,
          borderColor: t.light ? "#ffffff" : "#0b1017",
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick: (_e, elems) => {
          if (!elems.length) return;
          storyFilterBu(bus[elems[0].index]?.bu_name);
        },
        plugins: {
          legend: { position: "bottom", labels: { color: t.text, boxWidth: 10 } },
          valueLabels: { display: true, decimals: 0, fontSize: 11 },
        },
        cutout: "52%",
      },
    });

    mk("story-chart-glance-feeders", {
      type: "bar",
      data: {
        labels: (data.feeders_by_bu || []).map((r) => r.bu_name),
        datasets: [
          { label: "Feeders", data: (data.feeders_by_bu || []).map((r) => r.feeder_count), backgroundColor: "#1f6fb2", borderRadius: 6 },
          { label: "Length km", data: (data.feeders_by_bu || []).map((r) => Math.round(r.len_km)), backgroundColor: "#d99a1e", borderRadius: 6 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 16 } },
        onClick: (_e, elems) => {
          if (!elems.length) return;
          storyFilterBu((data.feeders_by_bu || [])[elems[0].index]?.bu_name);
        },
        plugins: {
          legend: { position: "bottom", labels: { color: t.text } },
          valueLabels: { display: true, decimals: 0, fontSize: 11 },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: t.muted } },
          y: { beginAtZero: true, ticks: { color: t.muted }, grid: { color: t.border } },
        },
      },
    });

    mk("story-chart-before-move", {
      type: "bar",
      data: {
        labels: ["DTs moved BU", "UTs consolidated", "BUs reduced"],
        datasets: [{
          label: "Change",
          data: [2717, (data.kpis.ut_existing - data.kpis.ut_2026), (data.kpis.bu_existing - data.kpis.bu_2026)],
          backgroundColor: ["#c8452c", "#d99a1e", "#1f6fb2"],
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 16 } },
        plugins: {
          legend: { display: false },
          valueLabels: { display: true, decimals: 0, fontSize: 12 },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: t.muted } },
          y: { beginAtZero: true, ticks: { color: t.muted }, grid: { color: t.border } },
        },
      },
    });

    mk("story-chart-bus-area", {
      type: "bar",
      data: {
        labels: bus.map((b) => b.bu_name),
        datasets: [{
          label: "Area km²",
          data: bus.map((b) => b.area_km2),
          backgroundColor: bus.map((b) => b.fill_hex),
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 16 } },
        onClick: (_e, elems) => {
          if (!elems.length) return;
          storyFilterBu(bus[elems[0].index]?.bu_name);
        },
        plugins: {
          legend: { display: false },
          valueLabels: { display: true, decimals: 1, fontSize: 11 },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: t.muted } },
          y: { beginAtZero: true, ticks: { color: t.muted }, grid: { color: t.border } },
        },
      },
    });

    mk("story-chart-bus-uts", {
      type: "bar",
      data: {
        labels: bus.map((b) => b.bu_name),
        datasets: [{
          label: "Undertakings",
          data: bus.map((b) => b.ut_count),
          backgroundColor: "#7a4fb5",
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 16 } },
        onClick: (_e, elems) => {
          if (!elems.length) return;
          storyFilterBu(bus[elems[0].index]?.bu_name);
        },
        plugins: {
          legend: { display: false },
          valueLabels: { display: true, decimals: 0, fontSize: 12 },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: t.muted } },
          y: { beginAtZero: true, ticks: { color: t.muted }, grid: { color: t.border } },
        },
      },
    });

    mk("story-chart-quality-ut", {
      type: "bar",
      data: {
        labels: data.undertakings.slice().sort((a, b) => a.agreement_pct - b.agreement_pct).slice(0, 12).map((u) => u.ut_name),
        datasets: [{
          label: "Agreement %",
          data: data.undertakings.slice().sort((a, b) => a.agreement_pct - b.agreement_pct).slice(0, 12).map((u) => u.agreement_pct),
          backgroundColor: "#2e8b57",
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 16 } },
        plugins: {
          legend: { display: false },
          valueLabels: { display: true, suffix: "%", decimals: 1, fontSize: 10 },
        },
        scales: {
          x: { ticks: { maxRotation: 50, minRotation: 30, color: t.muted, font: { size: 9 } }, grid: { display: false } },
          y: { min: 90, max: 100, ticks: { color: t.muted, callback: (v) => `${v}%` }, grid: { color: t.border } },
        },
      },
    });

    mk("story-chart-method-agree", {
      type: "doughnut",
      data: {
        labels: [">=97%", "90–97%"],
        datasets: [{
          data: [
            data.undertakings.filter((u) => u.agreement_pct >= 97).length,
            data.undertakings.filter((u) => u.agreement_pct < 97).length,
          ],
          backgroundColor: ["#2e8b57", "#d99a1e"],
          borderWidth: 2,
          borderColor: t.light ? "#ffffff" : "#0b1017",
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { color: t.text } },
          valueLabels: { display: true, decimals: 0, fontSize: 12 },
        },
        cutout: "55%",
      },
    });

    mk("story-chart-method-move", {
      type: "bar",
      data: {
        labels: bus.map((b) => b.bu_name),
        datasets: [{
          label: "Mean agreement %",
          data: byBuAgree,
          backgroundColor: bus.map((b) => b.fill_hex),
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 16 } },
        plugins: {
          legend: { display: false },
          valueLabels: { display: true, suffix: "%", decimals: 1, fontSize: 11 },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: t.muted } },
          y: { min: 90, max: 100, ticks: { color: t.muted }, grid: { color: t.border } },
        },
      },
    });

    mk("story-chart-bu", {
      type: "bar",
      data: {
        labels: bus.map((b) => b.bu_name),
        datasets: [
          { label: "Public", data: bus.map((b) => b.dt_public), backgroundColor: "#1f6fb2", borderRadius: 5 },
          { label: "Private", data: bus.map((b) => b.dt_private), backgroundColor: "#c8452c", borderRadius: 5 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 18 } },
        onClick: (_e, elems) => {
          if (!elems.length) return;
          storyFilterBu(bus[elems[0].index]?.bu_name);
        },
        plugins: {
          valueLabels: { display: true, decimals: 0, fontSize: 11 },
          legend: { position: "bottom", labels: { color: t.text } },
        },
        scales: {
          x: { stacked: true, grid: { display: false }, ticks: { color: t.muted } },
          y: { stacked: true, beginAtZero: true, ticks: { color: t.muted }, grid: { color: t.border } },
        },
      },
    });

    mk("story-chart-compare", {
      type: "bar",
      data: {
        labels: ["Business Units", "Undertakings"],
        datasets: [
          { label: "Pre-2026", data: [data.kpis.bu_existing, data.kpis.ut_existing], backgroundColor: "#6b7c90", borderRadius: 6 },
          { label: "2026", data: [data.kpis.bu_2026, data.kpis.ut_2026], backgroundColor: "#e8a317", borderRadius: 6 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 18 } },
        plugins: {
          valueLabels: { display: true, decimals: 0, fontSize: 12 },
          legend: { position: "bottom", labels: { color: t.text } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: t.muted } },
          y: { beginAtZero: true, ticks: { color: t.muted }, grid: { color: t.border } },
        },
      },
    });

    mk("story-chart-density", {
      type: "bar",
      data: {
        labels: bus.map((b) => b.bu_name),
        datasets: [{
          label: "DTs / km²",
          data: bus.map((b) => +(b.dt_total / b.area_km2).toFixed(1)),
          backgroundColor: bus.map((b) => b.fill_hex),
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 18 } },
        onClick: (_e, elems) => {
          if (!elems.length) return;
          storyFilterBu(bus[elems[0].index]?.bu_name);
        },
        plugins: {
          legend: { display: false },
          valueLabels: { display: true, decimals: 1, fontSize: 11 },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: t.muted } },
          y: { beginAtZero: true, ticks: { color: t.muted }, grid: { color: t.border } },
        },
      },
    });

    mk("story-chart-own", {
      type: "doughnut",
      data: {
        labels: ["Public", "Private"],
        datasets: [{
          data: [data.kpis.dt_public, data.kpis.dt_private],
          backgroundColor: ["#1f6fb2", "#c8452c"],
          borderWidth: 2,
          borderColor: t.light ? "#ffffff" : "#0b1017",
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom", labels: { color: t.text } },
          valueLabels: { display: true, decimals: 0, fontSize: 12 },
        },
        cutout: "55%",
      },
    });

    mk("story-chart-agree", {
      type: "bar",
      data: {
        labels: bus.map((b) => b.bu_name),
        datasets: [{
          label: "Agreement %",
          data: byBuAgree,
          backgroundColor: "#2e8b57",
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 18 } },
        onClick: (_e, elems) => {
          if (!elems.length) return;
          storyFilterBu(bus[elems[0].index]?.bu_name);
        },
        plugins: {
          legend: { display: false },
          valueLabels: { display: true, suffix: "%", decimals: 1, fontSize: 12 },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: t.muted } },
          y: { min: 90, max: 100, ticks: { color: t.muted, callback: (v) => `${v}%` }, grid: { color: t.border } },
        },
      },
    });

    const tbody = $("#story-bu-table tbody");
    if (tbody) {
      tbody.innerHTML = bus.map((b) => `
        <tr data-bu="${b.bu_name}">
          <td>${b.bu_name}</td>
          <td>${b.ut_count}</td>
          <td>${b.dt_total.toLocaleString()}</td>
          <td>${b.area_km2.toFixed(1)}</td>
          <td>${(b.dt_per_km2 ?? (b.dt_total / b.area_km2)).toFixed(1)}</td>
        </tr>`).join("");
      tbody.querySelectorAll("tr[data-bu]").forEach((tr) => {
        tr.addEventListener("click", () => storyFilterBu(tr.dataset.bu));
      });
    }
  }

  /* ---------- Exports ---------- */
  async function exportPDF() {
    if (typeof html2canvas === "undefined" || typeof jspdf === "undefined") {
      alert("PDF libraries still loading — try again in a moment.");
      return;
    }
    const { jsPDF } = jspdf;
    const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();

    const addHeader = (title) => {
      pdf.setFillColor(12, 17, 24);
      pdf.rect(0, 0, pageW, pageH, "F");
      pdf.setTextColor(232, 163, 23);
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(16);
      pdf.text("Ikeja Electric · Powered by the GIS Team", 36, 36);
      pdf.setTextColor(232, 238, 246);
      pdf.setFontSize(20);
      pdf.text(title, 36, 64);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(10);
      pdf.setTextColor(147, 164, 184);
      pdf.text(new Date().toLocaleString(), 36, 82);
    };

    const snap = async (selector, title) => {
      const node = $(selector);
      if (!node) return;
      node.hidden = false;
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 200)));
      const canvas = await html2canvas(node, {
        backgroundColor: experience.theme === "light" ? "#e8eef5" : "#0b1017",
        scale: 1.2,
        useCORS: true,
        logging: false,
      });
      addHeader(title);
      const img = canvas.toDataURL("image/jpeg", 0.92);
      const maxW = pageW - 72;
      const maxH = pageH - 110;
      let w = maxW;
      let h = (canvas.height / canvas.width) * w;
      if (h > maxH) {
        h = maxH;
        w = (canvas.width / canvas.height) * h;
      }
      pdf.addImage(img, "JPEG", 36, 96, w, h);
    };

    const prev = experience.view;
    showView("intelligence");
    await snap("#view-intelligence", "IE Network Monitoring Dashboard");
    pdf.addPage();
    showView("coverage");
    await snap("#view-coverage", "IE Network Monitoring Dashboard · Coverage");
    pdf.save("IE_Network_Monitoring_Dashboard.pdf");
    showView(prev);
  }

  function exportDualWorkbook() {
    if (typeof XLSX === "undefined") return;
    const data = window.IKEDC?.getData?.();
    if (!data) return;
    const wb = XLSX.utils.book_new();
    const styleNote = [{ Note: "Ikeja Electric — IKEDC 2026 Realignment exports" }, { Generated: new Date().toISOString() }];

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(styleNote), "Cover");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.business_units), "Intel_BUs");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.undertakings), "Intel_UTs");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.feeders || []), "Intel_Feeders");

    const coverageKPI = [{
      total_coverage_km2: data.business_units.reduce((s, b) => s + b.area_km2, 0),
      dt_density_per_km2: +(data.kpis.dt_total / data.business_units.reduce((s, b) => s + b.area_km2, 0)).toFixed(2),
      active_feeders: data.kpis.feeders_total,
      transformers: data.kpis.dt_total,
      mean_agreement_pct: data.kpis.mean_agreement_pct,
    }];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(coverageKPI), "Coverage_KPIs");
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(data.business_units.map((b) => ({
        bu_name: b.bu_name,
        dt_total: b.dt_total,
        area_km2: b.area_km2,
        dt_density: +(b.dt_total / b.area_km2).toFixed(2),
        ut_count: b.ut_count,
      }))),
      "Coverage_BU_Summary"
    );

    XLSX.writeFile(wb, "IKEDC_Both_Dashboards.xlsx");
  }

  /* ---------- Wire UI ---------- */
  async function boot() {
    applyTheme(experience.theme);
    initStars();

    try {
      const [lagosRes, labelRes] = await Promise.all([
        fetch("data/lagos_boundary.geojson"),
        fetch("data/map_labels.json"),
      ]);
      if (lagosRes.ok) experience.lagos = await lagosRes.json();
      if (labelRes.ok) experience.labels = await labelRes.json();
      window.IKEDC?.setLagos?.(experience.lagos);
    } catch (_) { /* optional */ }
    syncBrandLogos(experience.theme);

    $$("[data-goto]").forEach((btn) => {
      btn.addEventListener("click", () => showView(btn.dataset.goto));
    });
    $("#btn-reset")?.addEventListener("click", resetCurrent);
    $("#btn-theme")?.addEventListener("click", () => {
      applyTheme(experience.theme === "dark" ? "light" : "dark");
    });
    // Audio button + autoplay unlock handled by js/audio.js when present
    if (!window.IKEDCAudio) {
      $("#btn-audio")?.addEventListener("click", () => setAudio(!experience.audioOn));
    }

    $("#btn-export-pdf")?.addEventListener("click", () => exportPDF());
    $("#btn-export-dual-xlsx")?.addEventListener("click", () => exportDualWorkbook());

    // Prefetch feeds off the critical path (shared cache for all views)
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(() => window.IKEDCFeeds?.refresh?.(), { timeout: 2500 });
    } else {
      setTimeout(() => window.IKEDCFeeds?.refresh?.(), 600);
    }

    const hash = (location.hash || "#intelligence").replace("#", "");
    showView(["intelligence", "coverage", "story"].includes(hash) ? hash : "intelligence");
  }

  window.IKEDCExperience = {
    showView,
    resetCurrent,
    exportPDF,
    getLagos: () => experience.lagos,
    hybridBasemapGroup,
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
