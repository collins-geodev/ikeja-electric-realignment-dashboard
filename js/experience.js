/* Stars, ambient audio, theme, coverage replica, story map, PDF export */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const experience = {
    view: "intelligence", // intelligence | coverage | story
    theme: localStorage.getItem("ikedc-theme") || "dark",
    audioOn: false,
    audioCtx: null,
    nodes: null,
    starsRaf: 0,
    coverageMap: null,
    coverageCharts: {},
    lagos: null,
  };

  /* ---------- Theme ---------- */
  function applyTheme(theme) {
    experience.theme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("ikedc-theme", theme);
    const btn = $("#btn-theme");
    if (btn) btn.textContent = theme === "dark" ? "Light mode" : "Dark mode";
    window.IKEDC?.setMapTheme?.(theme);
    window.IKEDC?.refreshChartTheme?.();
    Object.values(experience.coverageCharts).forEach((c) => {
      try { c.update("none"); } catch (_) { /* ignore */ }
    });
    if (experience.coverageMap) setCoverageTiles(theme);
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
          ? `rgba(180, 120, 40, ${tw * 0.55})`
          : `rgba(255, 230, 180, ${tw * 0.9})`;
        ctx.arc(st.x, st.y, st.r * (0.8 + tw * 0.5), 0, Math.PI * 2);
        ctx.fill();
        if (tw > 0.85) {
          ctx.beginPath();
          ctx.fillStyle = light ? `rgba(232,163,23,0.25)` : `rgba(255,255,255,0.35)`;
          ctx.arc(st.x, st.y, st.r * 3, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      experience.starsRaf = requestAnimationFrame(draw);
    };
    experience.starsRaf = requestAnimationFrame(draw);
  }

  /* ---------- Calm ambient pad (Web Audio) ---------- */
  function ensureAudio() {
    if (experience.audioCtx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0.045;
    master.connect(ctx.destination);

    const makeOsc = (freq, type, gainVal) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();
      o.type = type;
      o.frequency.value = freq;
      f.type = "lowpass";
      f.frequency.value = 680;
      g.gain.value = gainVal;
      o.connect(f);
      f.connect(g);
      g.connect(master);
      o.start();
      return { o, g };
    };

    const a = makeOsc(110, "sine", 0.35);
    const b = makeOsc(164.81, "sine", 0.22);
    const c = makeOsc(220, "triangle", 0.08);
    // gentle LFO on master
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.07;
    lfoGain.gain.value = 0.012;
    lfo.connect(lfoGain);
    lfoGain.connect(master.gain);
    lfo.start();

    experience.audioCtx = ctx;
    experience.nodes = { master, a, b, c, lfo };
  }

  function setAudio(on) {
    experience.audioOn = on;
    const btn = $("#btn-audio");
    if (on) {
      ensureAudio();
      experience.audioCtx.resume();
      if (btn) btn.textContent = "Mute ambience";
    } else if (experience.audioCtx) {
      experience.audioCtx.suspend();
      if (btn) btn.textContent = "Play ambience";
    }
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
      requestAnimationFrame(() => initCoverage());
    }
    if (view === "story") {
      requestAnimationFrame(() => initStoryCharts());
    }
    if (view === "intelligence") {
      window.IKEDC?.resize?.();
    }
    history.replaceState(null, "", `#${view}`);
  }

  function resetCurrent() {
    if (experience.view === "intelligence" || experience.view === "coverage") {
      window.IKEDC?.resetFilters?.();
    }
    if (experience.view === "coverage") {
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

  /* ---------- Coverage dashboard (same-tab replica) ---------- */
  let coverageBaseLayer = null;
  function setCoverageTiles(theme) {
    if (!experience.coverageMap) return;
    if (coverageBaseLayer) experience.coverageMap.removeLayer(coverageBaseLayer);
    const url = theme === "light"
      ? "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
      : "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}";
    coverageBaseLayer = L.tileLayer(url, { attribution: "Tiles © Esri", maxZoom: 16 });
    coverageBaseLayer.addTo(experience.coverageMap);
  }

  function initCoverage(force) {
    const data = window.IKEDC?.getData?.();
    if (!data) return;
    const k = data.kpis;
    const totalArea = data.business_units.reduce((s, b) => s + (b.area_km2 || 0), 0);
    const dens = (totalArea ? k.dt_total / totalArea : 0).toFixed(1);

    $("#cov-kpi-area").textContent = `${Number(totalArea).toLocaleString()} km²`;
    // Replaces "Realigned customers" with DT density insight
    $("#cov-kpi-alt").textContent = dens;
    $("#cov-kpi-alt-label").textContent = "DT DENSITY";
    $("#cov-kpi-alt-hint").textContent = "transformers per km² across 2026 BUs";
    $("#cov-kpi-feeders").textContent = `${k.feeders_total}`;
    $("#cov-kpi-dts").textContent = Number(k.dt_total).toLocaleString();
    $("#cov-kpi-agree").textContent = `${k.mean_agreement_pct}%`;

    if (!experience.coverageMap || force) {
      const el = $("#coverage-map");
      if (experience.coverageMap) {
        experience.coverageMap.remove();
        experience.coverageMap = null;
      }
      experience.coverageMap = L.map(el, { zoomControl: true }).setView([6.55, 3.5], 10);
      setCoverageTiles(experience.theme);

      const bounds = [];
      // Lagos boundary
      if (experience.lagos?.features?.length) {
        L.geoJSON(experience.lagos, {
          style: { color: "#e8a317", weight: 2.5, fillOpacity: 0.03, dashArray: "6 4" },
        }).addTo(experience.coverageMap);
      }
      data.map.bu_polygons.forEach((b) => {
        b.rings.forEach((ring) => {
          const latlngs = ring.map(([lon, lat]) => [lat, lon]);
          L.polygon(latlngs, {
            color: b.fill_hex, weight: 2, fillColor: b.fill_hex, fillOpacity: 0.22,
          }).bindPopup(`<strong>${b.bu_name}</strong>`).addTo(experience.coverageMap);
          latlngs.forEach((ll) => bounds.push(ll));
        });
      });
      const feeders = window.IKEDC?.getFeedersGeo?.();
      if (feeders?.features) {
        L.geoJSON(feeders, {
          style: (f) => ({
            color: String(f.properties?.voltage || "").includes("33") ? "#f0a020" : "#4db6ff",
            weight: String(f.properties?.voltage || "").includes("33") ? 2.2 : 1.4,
            opacity: 0.85,
          }),
        }).addTo(experience.coverageMap);
      }
      if (bounds.length) experience.coverageMap.fitBounds(bounds, { padding: [24, 24] });
      setTimeout(() => experience.coverageMap.invalidateSize(), 80);
    } else {
      setTimeout(() => experience.coverageMap.invalidateSize(), 80);
    }

    // Charts
    destroyCovCharts();
    const bus = data.business_units.slice().sort((a, b) => b.dt_total - a.dt_total);
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
            borderWidth: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: "bottom", labels: { boxWidth: 10, color: getComputedStyle(document.body).color } },
            valueLabels: { display: true, decimals: 0, fontSize: 10 },
          },
          cutout: "52%",
        },
      });
    }
    if (ctx2 && window.Chart) {
      experience.coverageCharts.phase = new Chart(ctx2, {
        type: "bar",
        data: {
          labels: bus.map((b) => b.bu_name),
          datasets: [{
            label: "Agreement %",
            data: bus.map((b) => {
              const uts = data.undertakings.filter((u) => u.bu_name === b.bu_name);
              return uts.length ? +(uts.reduce((s, u) => s + u.agreement_pct, 0) / uts.length).toFixed(1) : 0;
            }),
            backgroundColor: "#2e8b57",
            borderRadius: 6,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 20 } },
          plugins: {
            legend: { display: false },
            valueLabels: { display: true, suffix: "%", decimals: 1, fontSize: 11 },
          },
          scales: {
            x: { grid: { display: false } },
            y: { min: 90, max: 100, ticks: { callback: (v) => `${v}%` } },
          },
        },
      });
    }

    const feed = $("#cov-feed");
    if (feed) {
      const items = [
        `Update: ${bus[0]?.bu_name || "IKEJA"} carries the largest DT workload (${bus[0]?.dt_total?.toLocaleString() || "—"}).`,
        `Network: ${k.feeders_11kv} × 11 kV and ${k.feeders_33kv} × 33 kV feeders tagged to 2026 BUs.`,
        `Boundary quality: mean register agreement ${k.mean_agreement_pct}% across 38 Undertakings.`,
        `Coverage footprint: ${totalArea.toFixed(0)} km² inside the 2026 realignment.`,
      ];
      feed.innerHTML = items.map((t) => `<li>${t}</li>`).join("");
    }
  }

  function destroyCovCharts() {
    Object.values(experience.coverageCharts).forEach((c) => c.destroy());
    experience.coverageCharts = {};
  }

  /* ---------- Story map ---------- */
  function initStoryCharts() {
    const data = window.IKEDC?.getData?.();
    if (!data || !window.Chart) return;
    const bus = data.business_units;
    const el = $("#story-chart-bu");
    if (!el || el.dataset.ready) return;
    el.dataset.ready = "1";
    new Chart(el, {
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
        layout: { padding: { top: 8 } },
        plugins: {
          valueLabels: { display: true, decimals: 0, fontSize: 10 },
          legend: { position: "bottom" },
        },
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true } },
      },
    });
    const tbody = $("#story-bu-table tbody");
    if (tbody) {
      tbody.innerHTML = bus.map((b) => `
        <tr>
          <td>${b.bu_name}</td>
          <td>${b.ut_count}</td>
          <td>${b.dt_total.toLocaleString()}</td>
          <td>${b.area_km2.toFixed(1)}</td>
          <td>${(b.dt_per_km2 ?? (b.dt_total / b.area_km2)).toFixed(1)}</td>
        </tr>`).join("");
    }
  }

  /* ---------- Exports (PDF + dual workbook) ---------- */
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
        backgroundColor: experience.theme === "light" ? "#f4f1ea" : "#0c1118",
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
      const res = await fetch("data/lagos_boundary.geojson");
      if (res.ok) experience.lagos = await res.json();
      window.IKEDC?.setLagos?.(experience.lagos);
    } catch (_) { /* optional */ }

    $$("[data-goto]").forEach((btn) => {
      btn.addEventListener("click", () => showView(btn.dataset.goto));
    });
    $("#btn-reset")?.addEventListener("click", resetCurrent);
    $("#btn-theme")?.addEventListener("click", () => {
      applyTheme(experience.theme === "dark" ? "light" : "dark");
    });
    $("#btn-audio")?.addEventListener("click", () => setAudio(!experience.audioOn));
    // Start ambience after first user gesture anywhere
    const unlock = () => {
      if (!experience.audioOn) setAudio(true);
      document.removeEventListener("pointerdown", unlock);
    };
    document.addEventListener("pointerdown", unlock, { once: true });

    $("#btn-export-pdf")?.addEventListener("click", () => exportPDF());
    $("#btn-export-dual-xlsx")?.addEventListener("click", () => exportDualWorkbook());

    const hash = (location.hash || "#intelligence").replace("#", "");
    showView(["intelligence", "coverage", "story"].includes(hash) ? hash : "intelligence");
  }

  window.IKEDCExperience = { showView, resetCurrent, exportPDF, getLagos: () => experience.lagos };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
