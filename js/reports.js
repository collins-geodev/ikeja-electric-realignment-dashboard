/* Branded exports — Excel workbooks (ExcelJS), PDF report (jsPDF + AutoTable), CSV / GeoJSON / KML.
 * Everything is built at click time from the live dashboard data and the active filters,
 * so every export always matches what the dashboard shows. */
(() => {
  const BRAND = {
    red: "C8452C",
    gold: "E8A317",
    ink: "0F1C2E",
    navy: "142235",
    muted: "5B6B7F",
    line: "D9E1EA",
    zebra: "F6F8FB",
    cream: "FFF7E8",
    blue: "1F6FB2",
  };
  const rgb = (hex) => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  const LIBS = {
    exceljs: "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js",
    autotable: "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js",
  };
  const fmt = new Intl.NumberFormat("en-US");
  const fmt1 = (n) => (Number.isFinite(+n) ? (+n).toFixed(1) : "—");
  const pctOf = (a, b) => (b ? (a / b) * 100 : 0);
  /* Store tidy values in exports (display formats round too, but raw floats leak into CSV / formulas) */
  const r1 = (n) => (Number.isFinite(+n) ? Math.round(+n * 10) / 10 : n);
  const r2 = (n) => (Number.isFinite(+n) ? Math.round(+n * 100) / 100 : n);
  const titleCase = (s) => String(s || "").toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());

  /* ---------- Library + asset loading ---------- */
  const scriptCache = {};
  function loadScript(src) {
    if (!scriptCache[src]) {
      scriptCache[src] = new Promise((resolve, reject) => {
        const el = document.createElement("script");
        el.src = src;
        el.async = true;
        el.onload = resolve;
        el.onerror = () => {
          delete scriptCache[src];
          reject(new Error(`Could not load ${src.split("/").slice(-1)[0]} — check your connection and try again.`));
        };
        document.head.appendChild(el);
      });
    }
    return scriptCache[src];
  }

  let logoPromise = null;
  function logoDataUrl() {
    if (!logoPromise) {
      logoPromise = fetch("assets/ie-logo-report.png")
        .then((r) => r.blob())
        .then((b) => new Promise((resolve) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.readAsDataURL(b);
        }))
        .catch(() => null);
    }
    return logoPromise;
  }

  function download(filename, blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  /* ---------- Progress toast ---------- */
  function progress(text) {
    let el = document.getElementById("report-progress");
    if (!el) {
      el = document.createElement("div");
      el.id = "report-progress";
      el.className = "report-progress";
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      el.innerHTML = `<span class="report-progress-spinner" aria-hidden="true"></span><span class="report-progress-text"></span>`;
      document.body.appendChild(el);
    }
    el.hidden = !text;
    el.querySelector(".report-progress-text").textContent = text || "";
    return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
  }

  /* ---------- One data model for every export ---------- */
  function reportData() {
    const api = window.IKEDC;
    const data = api.getData();
    const sum = api.getScopeSummary();
    const network = sum.level === "network";
    const register = !!data.map.dt_register;
    const dts = register ? api.getScopeDTs() : [];
    const isPriv = (d) => String(d.own || "").toUpperCase().includes("PRIVATE");

    const byBu = {};
    const byUt = {};
    dts.forEach((d) => {
      const b = byBu[d.bu] || (byBu[d.bu] = { total: 0, priv: 0 });
      const u = byUt[d.ut] || (byUt[d.ut] = { total: 0, priv: 0 });
      b.total += 1;
      u.total += 1;
      if (isPriv(d)) { b.priv += 1; u.priv += 1; }
    });
    const inBu = (b) => (register ? byBu[b.bu_name] || { total: 0, priv: 0 } : { total: b.dt_total, priv: b.dt_private });
    const inUt = (u) => (register ? byUt[u.ut_name] || { total: 0, priv: 0 } : { total: u.dt_total, priv: u.dt_private });

    const utsAll = data.undertakings.filter((u) => sum.uts.includes(u.ut_name));
    const meanAgree = (list) => (list.length ? list.reduce((a, u) => a + u.agreement_pct, 0) / list.length : 0);

    const bus = data.business_units.filter((b) => sum.bus.includes(b.bu_name)).map((b) => {
      const c = inBu(b);
      return {
        swatch: b.fill_hex,
        name: api.buDisplayName(b.bu_name),
        code: b.bu_name,
        uts: b.ut_count,
        dts: c.total,
        buTotal: b.dt_total,
        pub: c.total - c.priv,
        priv: c.priv,
        privPct: r1(pctOf(c.priv, c.total)),
        area: r2(b.area_km2),
        density: r1(b.dt_per_km2 ?? (b.area_km2 ? b.dt_total / b.area_km2 : 0)),
        agree: r1(meanAgree(data.undertakings.filter((u) => u.bu_name === b.bu_name))),
      };
    });

    const uts = utsAll.map((u) => {
      const c = inUt(u);
      return {
        swatch: u.fill_hex || u.bu_hex,
        name: titleCase(u.ut_name),
        code: u.ut_name,
        bu: api.buDisplayName(u.bu_name),
        buCode: u.bu_name,
        dts: c.total,
        utTotal: u.dt_total,
        pub: c.total - c.priv,
        priv: c.priv,
        privPct: r1(pctOf(c.priv, c.total)),
        agree: r1(u.agreement_pct),
        area: r2(u.area_km2),
        density: r1(u.dt_per_km2 ?? (u.area_km2 ? u.dt_total / u.area_km2 : 0)),
        formedFrom: u.from_old_uts || "",
      };
    }).sort((a, b) => b.dts - a.dts);

    /* Feeders in the register's standard nomenclature (e.g. 11-Oke IraINJ-T2-Kayode); route length
       and boundary fidelity are joined from the feeder network where the names match */
    const scopeMeta = api.getScopeFeeders();
    const metaByName = new Map();
    scopeMeta.forEach((f) => (f.register_names || []).forEach((n) => metaByName.set(n, f)));
    const metaRow = (m) => ({
      len: m ? r2(Number(m.len_km) || 0) : null,
      inBu: m ? r1((Number(m.in_own_bu) || 0) * (Number(m.in_own_bu) <= 1 ? 100 : 1)) : null,
      inUt: m ? r1((Number(m.in_own_ut) || 0) * (Number(m.in_own_ut) <= 1 ? 100 : 1)) : null,
    });
    const ranked = (o) => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    let feeders;
    if (register) {
      const groups = {};
      dts.forEach((d) => {
        if (!d.feeder) return;
        const g = groups[d.feeder] || (groups[d.feeder] = { dts: 0, bu: {}, ut: {} });
        g.dts += 1;
        g.bu[d.bu] = (g.bu[d.bu] || 0) + 1;
        g.ut[d.ut] = (g.ut[d.ut] || 0) + 1;
      });
      feeders = Object.entries(groups).map(([name, g]) => {
        const m = metaByName.get(name);
        const bus = ranked(g.bu);
        return {
          name,
          kv: /^33/.test(name) ? "33" : /^11/.test(name) ? "11" : String(m?.voltage || "").replace(/kV/i, ""),
          bu: bus.map((b) => api.buDisplayName(b)).join(", "),
          buCode: bus[0],
          ut: ranked(g.ut).map(titleCase).join(", "),
          dts: g.dts,
          ...metaRow(m),
        };
      });
    } else {
      feeders = scopeMeta.map((f) => ({
        name: api.feederDisplayName(f.feeder, f.voltage),
        kv: String(f.voltage || "").replace(/kV/i, ""),
        bu: f.new_bu ? api.buDisplayName(f.new_bu) : "Unassigned",
        buCode: f.new_bu || "Unassigned",
        ut: f.new_ut ? titleCase(f.new_ut) : "—",
        dts: f.dt_count || 0,
        ...metaRow(f),
      }));
    }
    feeders.sort((a, b) => b.dts - a.dts);

    const dtRows = dts.map((d) => ({
      name: d.name || "",
      feeder: d.feeder || "",
      bu: titleCase(d.bu),
      ut: titleCase(d.ut),
      oldBu: titleCase(d.old_bu),
      own: titleCase(d.own),
      cap: d.cap ?? null,
      conn: titleCase(d.conn),
      meter: titleCase(d.meter),
      lat: d.lat,
      lon: d.lon,
    }));

    /* Breakdowns by BU (register attributes) */
    const capBins = ["≤50", "51–100", "101–200", "201–300", "301–500", ">500", "Unknown"];
    const capBin = (c) => {
      const n = Number(c);
      if (!Number.isFinite(n) || n <= 0) return "Unknown";
      if (n <= 50) return "≤50";
      if (n <= 100) return "51–100";
      if (n <= 200) return "101–200";
      if (n <= 300) return "201–300";
      if (n <= 500) return "301–500";
      return ">500";
    };
    const breakdown = bus.map((b) => {
      const rows = dts.filter((d) => d.bu === b.code);
      const count = (fn) => rows.filter(fn).length;
      const caps = {};
      capBins.forEach((k) => { caps[k] = 0; });
      rows.forEach((d) => { caps[capBin(d.cap)] += 1; });
      return {
        name: b.name,
        code: b.code,
        total: rows.length,
        pub: count((d) => !isPriv(d)),
        priv: count(isPriv),
        privMulti: count((d) => String(d.own).toUpperCase() === "PRIVATE MULTIPLE"),
        kva: rows.reduce((a, d) => a + (Number(d.cap) || 0), 0),
        caps,
      };
    });

    const flows = {};
    dts.forEach((d) => {
      if (!d.old_bu || d.old_bu === d.bu) return;
      const k = `${titleCase(d.old_bu)} → ${titleCase(d.bu)}`;
      flows[k] = (flows[k] || 0) + 1;
    });
    const reassign = Object.entries(flows).map(([flow, count]) => ({ flow, count })).sort((a, b) => b.count - a.count);

    const totalArea = data.business_units.reduce((a, b) => a + (b.area_km2 || 0), 0);
    const area = network ? totalArea : sum.areaKm2;
    const below = sum.level === "feeder" || sum.level === "dt";
    const coverage = {
      area,
      density: area ? (below ? sum.utDtTotal : sum.dtTotal) / area : 0,
      feeders: sum.feederCount,
      dts: sum.dtTotal,
      agree: network ? data.kpis.mean_agreement_pct : sum.meanAgree,
    };

    return {
      api,
      data,
      sum,
      network,
      register,
      generated: new Date(),
      scope: network ? "Whole network (no filters)" : sum.label,
      bus,
      uts,
      feeders,
      dtRows,
      dts,
      breakdown,
      capBins,
      reassign,
      coverage,
      kva: dts.reduce((a, d) => a + (Number(d.cap) || 0), 0),
    };
  }

  const stamp = (d) => d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const slug = (R) => (R.network ? "Network" : R.scope.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40));
  const dateTag = (d) => d.toISOString().slice(0, 10);

  /* ---------- Column specs (shared by Excel, CSV and PDF tables) ---------- */
  const COLS = {
    bus: [
      { h: "Business Unit", k: "name", w: 26 },
      { h: "Undertakings", k: "uts", w: 13, n: "0" },
      { h: "DTs in filter", k: "dts", w: 13, n: "#,##0", sum: true },
      { h: "Public", k: "pub", w: 11, n: "#,##0", sum: true },
      { h: "Private", k: "priv", w: 11, n: "#,##0", sum: true },
      { h: "Private share", k: "privPct", w: 13, n: "0.0\"%\"" },
      { h: "BU total DTs", k: "buTotal", w: 13, n: "#,##0", sum: true },
      { h: "Area (km²)", k: "area", w: 12, n: "#,##0.0", sum: true },
      { h: "DTs per km²", k: "density", w: 12, n: "0.0" },
      { h: "Mean register agreement", k: "agree", w: 15, n: "0.0\"%\"" },
    ],
    uts: [
      { h: "Undertaking", k: "name", w: 22 },
      { h: "Business Unit", k: "bu", w: 24 },
      { h: "DTs in filter", k: "dts", w: 13, n: "#,##0", sum: true },
      { h: "Public", k: "pub", w: 11, n: "#,##0", sum: true },
      { h: "Private", k: "priv", w: 11, n: "#,##0", sum: true },
      { h: "Private share", k: "privPct", w: 13, n: "0.0\"%\"" },
      { h: "UT total DTs", k: "utTotal", w: 13, n: "#,##0", sum: true },
      { h: "Register agreement", k: "agree", w: 14, n: "0.0\"%\"" },
      { h: "Area (km²)", k: "area", w: 12, n: "#,##0.00", sum: true },
      { h: "DTs per km²", k: "density", w: 12, n: "0.0" },
      { h: "Formed from (pre-October 1, 2026 UTs)", k: "formedFrom", w: 44 },
    ],
    feeders: [
      { h: "Feeder (standard nomenclature)", k: "name", w: 40 },
      { h: "Voltage (kV)", k: "kv", w: 12 },
      { h: "Business Unit", k: "bu", w: 24 },
      { h: "Undertaking", k: "ut", w: 18 },
      { h: "DTs", k: "dts", w: 10, n: "#,##0", sum: true },
      { h: "Length (km)", k: "len", w: 12, n: "#,##0.0", sum: true },
      { h: "Length inside own BU", k: "inBu", w: 15, n: "0.0\"%\"" },
      { h: "Length inside own UT", k: "inUt", w: 15, n: "0.0\"%\"" },
    ],
    dts: [
      { h: "DT (standard nomenclature)", k: "name", w: 46 },
      { h: "Feeder (standard nomenclature)", k: "feeder", w: 34 },
      { h: "Business Unit (2026)", k: "bu", w: 16 },
      { h: "Undertaking (2026)", k: "ut", w: 18 },
      { h: "Previous BU", k: "oldBu", w: 14 },
      { h: "Ownership", k: "own", w: 17 },
      { h: "Capacity (kVA)", k: "cap", w: 13, n: "#,##0" },
      { h: "Connection", k: "conn", w: 15 },
      { h: "Metering", k: "meter", w: 12 },
      { h: "Latitude", k: "lat", w: 11, n: "0.000000" },
      { h: "Longitude", k: "lon", w: 11, n: "0.000000" },
    ],
    breakdown: [
      { h: "Business Unit", k: "name", w: 26 },
      { h: "DTs", k: "total", w: 10, n: "#,##0", sum: true },
      { h: "Public", k: "pub", w: 10, n: "#,##0", sum: true },
      { h: "Private", k: "priv", w: 10, n: "#,##0", sum: true },
      { h: "Private (multiple)", k: "privMulti", w: 14, n: "#,##0", sum: true },
      { h: "Installed capacity (kVA)", k: "kva", w: 16, n: "#,##0", sum: true },
    ],
    reassign: [
      { h: "Previous BU → 2026 BU", k: "flow", w: 34 },
      { h: "DTs moved", k: "count", w: 12, n: "#,##0", sum: true },
    ],
  };

  /* ---------- Charts rendered off-screen in IE colours (PNG for PDF and Excel) ---------- */
  const reportLabels = {
    id: "reportLabels",
    afterDatasetsDraw(chart) {
      const cfg = chart.options.plugins?.reportLabels;
      if (!cfg?.display) return;
      const { ctx } = chart;
      ctx.save();
      ctx.font = "600 11px 'IBM Plex Sans', Helvetica, Arial, sans-serif";
      ctx.textAlign = "center";
      chart.data.datasets.forEach((ds, di) => {
        const meta = chart.getDatasetMeta(di);
        if (meta.hidden) return;
        meta.data.forEach((el, i) => {
          const v = ds.data[i];
          if (!Number.isFinite(+v) || +v === 0) return;
          const text = `${cfg.decimals ? (+v).toFixed(cfg.decimals) : fmt.format(Math.round(v))}${cfg.suffix || ""}`;
          if (chart.config.type === "doughnut") {
            if (el.endAngle - el.startAngle < 0.25) return;
            const mid = (el.startAngle + el.endAngle) / 2;
            const r = el.innerRadius + (el.outerRadius - el.innerRadius) / 2;
            ctx.fillStyle = "#ffffff";
            ctx.textBaseline = "middle";
            ctx.fillText(text, el.x + Math.cos(mid) * r, el.y + Math.sin(mid) * r);
            return;
          }
          const stacked = chart.options.scales?.x?.stacked;
          if (stacked) {
            const h = Math.abs(el.base - el.y);
            if (h < 14) return;
            ctx.fillStyle = "#ffffff";
            ctx.textBaseline = "middle";
            ctx.fillText(text, el.x, (el.base + el.y) / 2);
          } else {
            ctx.fillStyle = `#${BRAND.ink}`;
            ctx.textBaseline = "bottom";
            ctx.fillText(text, el.x, el.y - 4);
          }
        });
      });
      ctx.restore();
    },
  };

  function chartPNG(config, w = 760, h = 380) {
    const host = document.createElement("div");
    host.style.cssText = `position:fixed;left:-10000px;top:0;width:${w}px;height:${h}px;`;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    host.appendChild(canvas);
    document.body.appendChild(host);
    const ink = `#${BRAND.ink}`;
    const muted = `#${BRAND.muted}`;
    const grid = "#E6EBF1";
    const scales = config.type === "doughnut" ? undefined : {
      x: { stacked: !!config.stacked, grid: { display: false }, ticks: { color: ink, font: { size: 11 }, maxRotation: config.rotate ?? 0, minRotation: config.rotate ?? 0, autoSkip: false } },
      y: { stacked: !!config.stacked, beginAtZero: config.min == null, min: config.min, max: config.max, grid: { color: grid }, ticks: { color: muted, font: { size: 10 }, callback: (v) => `${fmt.format(v)}${config.suffix || ""}` } },
    };
    const chart = new Chart(canvas, {
      type: config.type,
      data: config.data,
      options: {
        responsive: false,
        animation: false,
        devicePixelRatio: 2,
        layout: { padding: { top: 22, right: 12, left: 6, bottom: 4 } },
        cutout: config.type === "doughnut" ? "56%" : undefined,
        plugins: {
          legend: { display: config.legend !== false, position: "bottom", labels: { color: ink, boxWidth: 12, font: { size: 11 } } },
          tooltip: { enabled: false },
          valueLabels: { display: false },
          reportLabels: { display: true, suffix: config.suffix || "", decimals: config.decimals || 0 },
        },
        scales,
      },
      plugins: [reportLabels],
    });
    const url = canvas.toDataURL("image/png");
    chart.destroy();
    host.remove();
    return { url, w, h };
  }

  const PAL = ["#1F6FB2", "#C8452C", "#2E8B57", "#E8A317", "#7A4FB5", "#0F8B8D", "#B5487A", "#6B7C90"];
  const buColor = (R, code) => R.data.business_units.find((b) => b.bu_name === code)?.fill_hex || "#6B7C90";

  function buildCharts(R) {
    const charts = {};
    const bus = R.bus.filter((b) => b.dts > 0);
    const short = (b) => titleCase(b.code);
    charts.workload = {
      title: "Distribution transformers by Business Unit",
      note: "Public and private DTs inside the current filter.",
      ...chartPNG({
        type: "bar",
        stacked: true,
        data: {
          labels: bus.map(short),
          datasets: [
            { label: "Public", data: bus.map((b) => b.pub), backgroundColor: "#1F6FB2", borderRadius: 4 },
            { label: "Private", data: bus.map((b) => b.priv), backgroundColor: "#C8452C", borderRadius: 4 },
          ],
        },
      }),
    };
    const pub = R.bus.reduce((a, b) => a + b.pub, 0);
    const priv = R.bus.reduce((a, b) => a + b.priv, 0);
    charts.ownership = {
      title: "Ownership mix",
      note: `${fmt.format(pub)} public and ${fmt.format(priv)} private DTs.`,
      ...chartPNG({
        type: "doughnut",
        data: { labels: ["Public", "Private"], datasets: [{ data: [pub, priv], backgroundColor: ["#1F6FB2", "#C8452C"], borderColor: "#fff", borderWidth: 2 }] },
      }, 420, 380),
    };
    const capTotals = R.capBins.map((k) => R.breakdown.reduce((a, b) => a + b.caps[k], 0));
    const capIdx = R.capBins.map((_, i) => i).filter((i) => capTotals[i] > 0 || R.capBins[i] !== "Unknown");
    charts.capacity = {
      title: "Transformer capacity classes (kVA)",
      note: "Count of DTs by nameplate rating.",
      ...chartPNG({
        type: "bar",
        legend: false,
        data: {
          labels: capIdx.map((i) => R.capBins[i]),
          datasets: [{ label: "DTs", data: capIdx.map((i) => capTotals[i]), backgroundColor: `#${BRAND.gold}`, borderRadius: 5 }],
        },
      }),
    };
    const below = R.sum.level !== "network" && R.sum.level !== "bu";
    const densRows = below
      ? R.uts.slice().sort((a, b) => b.density - a.density).slice(0, 14).map((u) => ({ label: u.name, v: u.density, c: u.swatch }))
      : R.bus.map((b) => ({ label: short(b), v: b.density, c: b.swatch }));
    charts.density = {
      title: below ? "DT density by Undertaking (per km²)" : "DT density by Business Unit (per km²)",
      note: "Transformers per square kilometre of territory.",
      ...chartPNG({
        type: "bar",
        legend: false,
        decimals: 1,
        rotate: densRows.length > 6 ? 35 : 0,
        data: { labels: densRows.map((d) => d.label), datasets: [{ label: "DTs / km²", data: densRows.map((d) => +d.v.toFixed(1)), backgroundColor: densRows.map((d) => d.c), borderRadius: 5 }] },
      }),
    };
    const qual = R.uts.slice().sort((a, b) => a.agree - b.agree).slice(0, 15);
    charts.agreement = {
      title: "Register agreement — lowest Undertakings",
      note: "Share of DTs whose register UT matches the 2026 polygon.",
      ...chartPNG({
        type: "bar",
        legend: false,
        decimals: 1,
        suffix: "%",
        min: Math.max(0, Math.floor(Math.min(...qual.map((u) => u.agree), 100) - 2)),
        max: 100,
        rotate: qual.length > 6 ? 40 : 0,
        data: { labels: qual.map((u) => u.name), datasets: [{ label: "Agreement", data: qual.map((u) => u.agree), backgroundColor: qual.map((u) => (u.agree >= 97 ? "#2E8B57" : u.agree >= 94 ? `#${BRAND.gold}` : `#${BRAND.red}`)), borderRadius: 4 }] },
      }),
    };
    const fb = {};
    R.feeders.forEach((f) => {
      const k = titleCase(f.buCode || "Unassigned");
      if (!fb[k]) fb[k] = { n: 0, len: 0 };
      fb[k].n += 1;
      fb[k].len += f.len || 0;
    });
    const fbRows = Object.entries(fb).sort((a, b) => b[1].n - a[1].n);
    charts.feeders = {
      title: "Feeders and corridor length by Business Unit",
      note: "Feeders carrying DTs (main BU) and their total route length (km).",
      ...chartPNG({
        type: "bar",
        data: {
          labels: fbRows.map(([k]) => k),
          datasets: [
            { label: "Feeders", data: fbRows.map(([, v]) => v.n), backgroundColor: "#1F6FB2", borderRadius: 4 },
            { label: "Length (km)", data: fbRows.map(([, v]) => Math.round(v.len)), backgroundColor: `#${BRAND.gold}`, borderRadius: 4 },
          ],
        },
      }),
    };
    if (R.reassign.length) {
      charts.reassign = {
        title: "BU reassignments in the realignment",
        note: "DTs whose previous BU differs from their 2026 BU.",
        ...chartPNG({
          type: "bar",
          legend: false,
          rotate: R.reassign.length > 4 ? 25 : 0,
          data: { labels: R.reassign.slice(0, 10).map((r) => r.flow), datasets: [{ label: "DTs moved", data: R.reassign.slice(0, 10).map((r) => r.count), backgroundColor: `#${BRAND.red}`, borderRadius: 4 }] },
        }),
      };
    }
    return charts;
  }

  /* ---------- Vector map of the filtered area (no tile servers needed) ---------- */
  function mapPNG(R, w = 1200, h = 720) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    const data = R.data;
    const scopeBus = new Set(R.sum.bus);
    const scopeUts = new Set(R.sum.uts);
    const belowBu = !R.network && R.sum.level !== "bu";

    const focusPolys = belowBu
      ? data.map.ut_polygons.filter((p) => scopeUts.has(p.ut_name))
      : data.map.bu_polygons.filter((p) => R.network || scopeBus.has(p.bu_name));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    focusPolys.forEach((p) => p.rings.forEach((ring) => ring.forEach(([x, y]) => {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    })));
    if (!Number.isFinite(minX)) { minX = 3.1; maxX = 4.1; minY = 6.4; maxY = 6.75; }
    const padX = (maxX - minX) * 0.08 || 0.02;
    const padY = (maxY - minY) * 0.1 || 0.02;
    minX -= padX; maxX += padX; minY -= padY; maxY += padY;
    const kx = Math.cos(((minY + maxY) / 2) * Math.PI / 180);
    const sx = w / ((maxX - minX) * kx);
    const sy = h / (maxY - minY);
    const s = Math.min(sx, sy);
    const ox = (w - (maxX - minX) * kx * s) / 2;
    const oy = (h - (maxY - minY) * s) / 2;
    const P = (x, y) => [ox + (x - minX) * kx * s, h - (oy + (y - minY) * s)];

    ctx.fillStyle = "#EEF3F8";
    ctx.fillRect(0, 0, w, h);
    const path = (ring) => {
      ctx.beginPath();
      ring.forEach(([x, y], i) => { const [px, py] = P(x, y); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
      ctx.closePath();
    };
    const lagos = R.api.getLagos?.();
    (lagos?.features || []).forEach((f) => {
      const g = f.geometry || {};
      const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
      polys.forEach((poly) => poly.forEach((ring) => {
        path(ring);
        ctx.fillStyle = "#FFFFFF";
        ctx.fill();
        ctx.strokeStyle = `#${BRAND.gold}`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }));
    });
    /* BU then UT areas in the KMZ symbology; one path per polygon (even-odd) keeps holes open */
    const area = (p, mode) => {
      const st = R.api.boundaryStyle?.(p, mode) || { color: p.stroke || p.fill_hex, weight: p.stroke_width || 2, opacity: 1, fillColor: p.fill_hex, fillOpacity: p.fill_opacity ?? 0.4 };
      ctx.beginPath();
      p.rings.forEach((ring) => {
        ring.forEach(([x, y], i) => { const [px, py] = P(x, y); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
        ctx.closePath();
      });
      ctx.globalAlpha = st.fillOpacity;
      ctx.fillStyle = st.fillColor;
      ctx.fill("evenodd");
      ctx.globalAlpha = st.opacity ?? 1;
      ctx.strokeStyle = st.color;
      ctx.lineWidth = st.weight;
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    data.map.bu_polygons.forEach((b) => area(b, R.network || scopeBus.has(b.bu_name) ? "normal" : "dim"));
    data.map.ut_polygons.forEach((u) => {
      if (!(R.network || scopeBus.has(u.bu_name))) return;
      area(u, belowBu && scopeUts.has(u.ut_name) ? "focus" : "normal");
    });
    const feeders = R.api.getFeedersGeo?.();
    (feeders?.features || []).forEach((f) => {
      const p = f.properties || {};
      if (!R.network && p.new_bu && !scopeBus.has(p.new_bu)) return;
      const is33 = String(p.voltage || "").includes("33");
      const g = f.geometry || {};
      const lines = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates : [];
      ctx.strokeStyle = is33 ? "rgba(255,122,61,0.9)" : "rgba(31,111,178,0.55)";
      ctx.lineWidth = is33 ? 1.8 : 1;
      lines.forEach((line) => {
        ctx.beginPath();
        line.forEach(([x, y], i) => { const [px, py] = P(x, y); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); });
        ctx.stroke();
      });
    });
    const pts = R.dts;
    const stride = Math.max(1, Math.ceil(pts.length / 9000));
    pts.forEach((d, i) => {
      if (i % stride || d.lat == null) return;
      const [px, py] = P(d.lon, d.lat);
      if (px < 0 || py < 0 || px > w || py > h) return;
      const priv = String(d.own || "").toUpperCase().includes("PRIVATE");
      ctx.fillStyle = priv ? "rgba(200,69,44,0.85)" : "rgba(31,111,178,0.75)";
      ctx.beginPath();
      ctx.arc(px, py, priv ? 1.9 : 1.6, 0, Math.PI * 2);
      ctx.fill();
    });
    (data.map.iss || []).forEach((p) => {
      const [px, py] = P(p.lon, p.lat);
      if (px < 0 || py < 0 || px > w || py > h) return;
      ctx.fillStyle = `#${BRAND.gold}`;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    const labels = R.api.getLabels?.() || {};
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const label = (text, x, y, size, color) => {
      const [px, py] = P(x, y);
      if (px < 20 || py < 12 || px > w - 20 || py > h - 12) return;
      ctx.font = `700 ${size}px Helvetica, Arial, sans-serif`;
      const tw = ctx.measureText(text).width + 14;
      ctx.fillStyle = color;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(px - tw / 2, py - size * 0.9, tw, size * 1.8, size);
      else ctx.rect(px - tw / 2, py - size * 0.9, tw, size * 1.8);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(text, px, py + 0.5);
    };
    if (belowBu) {
      (labels.ut || []).forEach((l) => { if (scopeUts.has(l.name)) label(l.name, l.lon, l.lat, 15, l.fill || "#334"); });
    } else if (R.sum.level === "bu") {
      /* One or two BUs: name their Undertakings as well */
      (labels.ut || []).forEach((l) => { if (scopeBus.has(l.bu)) label(l.name, l.lon, l.lat, 11, l.fill || "#334"); });
      (labels.bu || []).forEach((l) => { if (scopeBus.has(l.name)) label(l.name, l.lon, l.lat, 16, l.fill || "#334"); });
    } else {
      (labels.bu || []).forEach((l) => { if (R.network || scopeBus.has(l.name)) label(l.name, l.lon, l.lat, 16, l.fill || "#334"); });
    }
    /* North arrow + scale bar */
    ctx.fillStyle = `#${BRAND.ink}`;
    ctx.beginPath();
    ctx.moveTo(w - 40, 26); ctx.lineTo(w - 50, 52); ctx.lineTo(w - 40, 46); ctx.lineTo(w - 30, 52); ctx.closePath();
    ctx.fill();
    ctx.font = "700 14px Helvetica, Arial, sans-serif";
    ctx.fillText("N", w - 40, 64);
    const kmPerPx = (111.32 * 1) / s;
    const nice = [1, 2, 5, 10, 20, 50].find((km) => km / kmPerPx > 80) || 50;
    const bar = nice / kmPerPx;
    ctx.fillRect(24, h - 30, bar, 5);
    ctx.textAlign = "left";
    ctx.font = "600 12px Helvetica, Arial, sans-serif";
    ctx.fillText(`${nice} km`, 24, h - 42);
    return { url: canvas.toDataURL("image/png"), w, h };
  }

  /* ---------- Key findings written from the numbers ---------- */
  const plural = (n, one, many = `${one}s`) => `${fmt.format(n)} ${n === 1 ? one : many}`;

  function findings(R) {
    const out = [];
    const t = R.sum.dtTotal;
    const priv = R.bus.reduce((a, b) => a + b.priv, 0);
    out.push(`${fmt.format(t)} distribution transformers in scope — ${fmt1(pctOf(t - priv, t))}% public and ${fmt1(pctOf(priv, t))}% private.`);
    const top = R.bus.slice().sort((a, b) => b.dts - a.dts)[0];
    if (top && R.bus.length > 1) out.push(`${top.name} carries the largest workload with ${fmt.format(top.dts)} DTs (${fmt1(pctOf(top.dts, t))}% of the scope).`);
    const dens = R.bus.slice().sort((a, b) => b.density - a.density)[0];
    if (dens && R.bus.length > 1) out.push(`${dens.name} is the densest territory at ${fmt1(dens.density)} DTs per km².`);
    if (R.uts.length === 1) {
      out.push(`Register agreement in ${R.uts[0].name} Undertaking is ${fmt1(R.uts[0].agree)}%.`);
    } else if (R.uts.length) {
      const low = R.uts.slice().sort((a, b) => a.agree - b.agree)[0];
      const high = R.uts.filter((u) => u.agree >= 97).length;
      out.push(`Register agreement averages ${fmt1(R.sum.meanAgree)}%; ${high} of ${R.uts.length} Undertakings are at 97% or above, lowest ${low.name} at ${fmt1(low.agree)}%.`);
    }
    if (R.register && t) {
      const big = R.breakdown.reduce((a, b) => a + b.caps["301–500"] + b.caps[">500"], 0);
      out.push(`Installed capacity totals ${fmt.format(Math.round(R.kva))} kVA; ${fmt1(pctOf(big, t))}% of DTs are rated above 300 kVA.`);
    }
    if (R.reassign.length) {
      const moved = R.reassign.reduce((a, r) => a + r.count, 0);
      out.push(`${plural(moved, "DT")} changed Business Unit in the realignment; the largest flow is ${R.reassign[0].flow} (${fmt.format(R.reassign[0].count)}).`);
    }
    if (R.feeders.length) {
      const longest = R.feeders.filter((f) => f.len != null).sort((a, b) => b.len - a.len)[0];
      out.push(`${plural(R.feeders.length, "feeder")} ${R.feeders.length === 1 ? "carries" : "carry"} DTs in the scope${longest ? `; the longest is ${longest.name} at ${fmt1(longest.len)} km` : ""}.`);
    }
    return out;
  }

  /* ---------- Excel (ExcelJS): branded, formatted, no colour-code columns ---------- */
  const ARGB = (hex) => `FF${hex}`;
  const thin = { style: "thin", color: { argb: ARGB(BRAND.line) } };

  function sheetFrame(ws, title, subtitle, description, ncols) {
    ws.mergeCells(1, 1, 1, ncols);
    ws.mergeCells(2, 1, 2, ncols);
    ws.mergeCells(3, 1, 3, ncols);
    Object.assign(ws.getCell(1, 1), { value: title });
    ws.getCell(1, 1).font = { name: "Calibri", size: 16, bold: true, color: { argb: ARGB(BRAND.ink) } };
    ws.getCell(2, 1).value = subtitle;
    ws.getCell(2, 1).font = { name: "Calibri", size: 10, italic: true, color: { argb: ARGB(BRAND.red) } };
    ws.getCell(3, 1).value = description;
    ws.getCell(3, 1).font = { name: "Calibri", size: 10, color: { argb: ARGB(BRAND.muted) } };
    ws.getCell(3, 1).alignment = { wrapText: true, vertical: "top" };
    ws.getRow(1).height = 26;
    ws.getRow(3).height = 30;
    ws.headerFooter.oddFooter = "&L&8Ikeja Electric · IE Network Monitoring · GIS Team&R&8Page &P of &N";
    ws.pageSetup = { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.3 } };
  }

  /** Data sheet: title block, IE-red header, number formats, banded rows, totals, filters, frozen panes */
  function tableSheet(wb, name, R, cols, rows, { description, totals = true, swatch = false, tab = BRAND.red } = {}) {
    const spec = swatch ? [{ h: "", k: "swatch", w: 2.6, swatch: true }, ...cols] : cols;
    const ws = wb.addWorksheet(name, {
      properties: { tabColor: { argb: ARGB(tab) } },
      views: [{ state: "frozen", ySplit: 5, xSplit: swatch ? 2 : 1, showGridLines: false }],
    });
    const n = spec.length;
    sheetFrame(ws, name, `Ikeja Electric · ${R.scope} · generated ${stamp(R.generated)} · ${fmt.format(rows.length)} rows`, description, n);
    spec.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c.w;
      if (c.n) col.numFmt = c.n;
    });
    const HDR = 5;
    const head = ws.getRow(HDR);
    spec.forEach((c, i) => {
      const cell = head.getCell(i + 1);
      cell.value = c.h;
      cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ARGB(c.swatch ? BRAND.red : BRAND.red) } };
      cell.alignment = { vertical: "middle", horizontal: c.n ? "right" : "left", wrapText: true };
      cell.border = { bottom: { style: "medium", color: { argb: ARGB(BRAND.gold) } } };
    });
    head.height = 30;
    const big = rows.length > 2000;
    rows.forEach((r) => {
      const row = ws.addRow(spec.map((c) => (c.swatch ? "" : r[c.k] ?? null)));
      if (big) return;
      row.eachCell({ includeEmpty: true }, (cell, ci) => {
        const c = spec[ci - 1];
        cell.border = { bottom: thin };
        cell.font = { name: "Calibri", size: 10, color: { argb: ARGB(BRAND.ink) } };
        if (c?.swatch && r.swatch) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ARGB(String(r.swatch).replace("#", "").toUpperCase()) } };
      });
    });
    const last = HDR + rows.length;
    if (rows.length) {
      ws.addConditionalFormatting({
        /* Band from the first text column so the colour swatch keeps its BU / UT colour */
        ref: `${ws.getColumn(swatch ? 2 : 1).letter}${HDR + 1}:${ws.getColumn(n).letter}${last}`,
        rules: [{ type: "expression", formulae: ["MOD(ROW(),2)=0"], style: { fill: { type: "pattern", pattern: "solid", bgColor: { argb: ARGB(BRAND.zebra) } } } }],
      });
      ws.autoFilter = { from: { row: HDR, column: 1 }, to: { row: HDR, column: n } };
    }
    if (totals && rows.length > 1 && spec.some((c) => c.sum)) {
      const tr = ws.addRow(spec.map(() => null));
      const labelCol = swatch ? 2 : 1;
      tr.getCell(labelCol).value = "Total";
      spec.forEach((c, i) => {
        if (!c.sum) return;
        const L = ws.getColumn(i + 1).letter;
        tr.getCell(i + 1).value = { formula: `SUBTOTAL(9,${L}${HDR + 1}:${L}${last})`, result: rows.reduce((a, r) => a + (Number(r[c.k]) || 0), 0) };
      });
      tr.eachCell({ includeEmpty: true }, (cell) => {
        cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: ARGB(BRAND.ink) } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ARGB(BRAND.cream) } };
        cell.border = { top: { style: "double", color: { argb: ARGB(BRAND.gold) } } };
      });
    }
    return ws;
  }

  function kpiTiles(ws, startRow, tiles, cols = 4, span = 2, firstCol = 2) {
    tiles.forEach((t, i) => {
      const r = startRow + Math.floor(i / cols) * 4;
      const c = firstCol + (i % cols) * span;
      const cells = [[r, t.label, 9, false, BRAND.muted], [r + 1, t.value, 20, true, t.accent || BRAND.red], [r + 2, t.hint || "", 9, false, BRAND.muted]];
      cells.forEach(([row, value, size, bold, color]) => {
        ws.mergeCells(row, c, row, c + span - 1);
        const cell = ws.getCell(row, c);
        cell.value = value;
        cell.font = { name: "Calibri", size, bold, color: { argb: ARGB(color) } };
        cell.alignment = { vertical: "middle", horizontal: "left", indent: 1, wrapText: true };
        for (let k = 0; k < span; k += 1) {
          const cc = ws.getCell(row, c + k);
          cc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ARGB(BRAND.cream) } };
          cc.border = {
            top: row === r ? { style: "medium", color: { argb: ARGB(t.accent || BRAND.red) } } : undefined,
            bottom: row === r + 2 ? thin : undefined,
          };
        }
      });
      ws.getRow(r + 1).height = 30;
    });
  }

  function kpiList(R) {
    const s = R.sum;
    const priv = R.bus.reduce((a, b) => a + b.priv, 0);
    return [
      { label: "DISTRIBUTION TRANSFORMERS", value: fmt.format(s.dtTotal), hint: s.dtPublic == null ? "in scope" : `${fmt.format(s.dtTotal - priv)} public · ${fmt.format(priv)} private` },
      { label: "BUSINESS UNITS", value: String(s.buCount), hint: R.network ? "2026 territories (from 6)" : s.bus.map(titleCase).join(", "), accent: BRAND.blue },
      { label: "UNDERTAKINGS", value: String(s.utCount), hint: R.network ? "from 54 previous" : `${s.uts.length <= 4 ? s.uts.map(titleCase).join(", ") : "in scope"}`, accent: BRAND.blue },
      { label: "MV FEEDERS", value: fmt.format(s.feederCount), hint: `${s.feeders11 || 0} × 11 kV · ${s.feeders33 || 0} × 33 kV`, accent: BRAND.gold },
      { label: "MEAN REGISTER AGREEMENT", value: `${fmt1(s.meanAgree)}%`, hint: "DT register vs 2026 UT polygon", accent: "2E8B57" },
      { label: "INSTALLED CAPACITY", value: `${fmt.format(Math.round(R.kva / 1000))} MVA`, hint: `${fmt.format(Math.round(R.kva))} kVA nameplate`, accent: BRAND.gold },
      { label: "COVERAGE AREA", value: `${fmt.format(Math.round(R.coverage.area))} km²`, hint: `${fmt1(R.coverage.density)} DTs per km²`, accent: BRAND.blue },
      { label: "SUBSTATIONS", value: `${s.iss} ISS · ${s.tcn} TCN`, hint: R.network ? "injection · transmission" : "inside the filtered area", accent: BRAND.red },
    ];
  }

  async function coverSheet(wb, R, logo, both, contents) {
    const ws = wb.addWorksheet("Cover", { properties: { tabColor: { argb: ARGB(BRAND.gold) } }, views: [{ showGridLines: false }] });
    ws.columns = [{ width: 3 }, ...Array.from({ length: 8 }, () => ({ width: 15 })), { width: 3 }];
    /* Image ids start at 0, so test for null rather than truthiness */
    if (logo != null) ws.addImage(logo, { tl: { col: 1.1, row: 0.6 }, ext: { width: 120, height: 87 } });
    ws.mergeCells("D2:I2");
    ws.getCell("D2").value = "IE Network Monitoring Dashboard";
    ws.getCell("D2").font = { name: "Calibri", size: 24, bold: true, color: { argb: ARGB(BRAND.ink) } };
    ws.mergeCells("D3:I3");
    ws.getCell("D3").value = both ? "Data export · Operations, Summary and Story dashboards" : "Data export · Operations dashboard";
    ws.getCell("D3").font = { name: "Calibri", size: 13, bold: true, color: { argb: ARGB(BRAND.red) } };
    ws.mergeCells("D4:I4");
    ws.getCell("D4").value = "2026 Undertaking / Business Unit realignment · Prepared by the GIS Team, Ikeja Electric";
    ws.getCell("D4").font = { name: "Calibri", size: 10, color: { argb: ARGB(BRAND.muted) } };
    ws.getRow(2).height = 34;
    ws.getRow(3).height = 20;
    for (let c = 2; c <= 9; c += 1) ws.getCell(6, c).border = { bottom: { style: "medium", color: { argb: ARGB(c <= 6 ? BRAND.red : BRAND.gold) } } };

    const info = [
      ["Generated", stamp(R.generated)],
      ["Filter scope", R.scope],
      ["Data", `DT register (${fmt.format(R.data.kpis.dt_total)} DTs), 2026 BU / UT polygons, MV feeder network`],
      ["Note", "Figures follow the dashboard filters at the moment of export."],
    ];
    info.forEach(([k, v], i) => {
      const r = 8 + i;
      ws.mergeCells(r, 2, r, 3);
      ws.mergeCells(r, 4, r, 9);
      ws.getCell(r, 2).value = k;
      ws.getCell(r, 2).font = { name: "Calibri", size: 10, bold: true, color: { argb: ARGB(BRAND.muted) } };
      ws.getCell(r, 4).value = v;
      ws.getCell(r, 4).font = { name: "Calibri", size: 10, color: { argb: ARGB(BRAND.ink) } };
    });
    kpiTiles(ws, 13, kpiList(R));

    let r = 22;
    ws.mergeCells(r, 2, r, 9);
    ws.getCell(r, 2).value = "Key findings";
    ws.getCell(r, 2).font = { name: "Calibri", size: 13, bold: true, color: { argb: ARGB(BRAND.ink) } };
    findings(R).forEach((f) => {
      r += 1;
      ws.mergeCells(r, 2, r, 9);
      ws.getCell(r, 2).value = `•  ${f}`;
      ws.getCell(r, 2).font = { name: "Calibri", size: 10, color: { argb: ARGB(BRAND.ink) } };
      ws.getCell(r, 2).alignment = { wrapText: true, vertical: "top" };
      ws.getRow(r).height = 28;
    });
    r += 2;
    ws.mergeCells(r, 2, r, 9);
    ws.getCell(r, 2).value = "Contents";
    ws.getCell(r, 2).font = { name: "Calibri", size: 13, bold: true, color: { argb: ARGB(BRAND.ink) } };
    contents.forEach(([sheet, desc]) => {
      r += 1;
      ws.mergeCells(r, 2, r, 4);
      ws.mergeCells(r, 5, r, 9);
      ws.getCell(r, 2).value = { text: sheet, hyperlink: `#'${sheet}'!A1` };
      ws.getCell(r, 2).font = { name: "Calibri", size: 10, bold: true, underline: true, color: { argb: ARGB(BRAND.blue) } };
      ws.getCell(r, 5).value = desc;
      ws.getCell(r, 5).font = { name: "Calibri", size: 10, color: { argb: ARGB(BRAND.muted) } };
      for (let c = 2; c <= 9; c += 1) ws.getCell(r, c).border = { bottom: thin };
    });
    ws.pageSetup = { orientation: "portrait", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 1 };
  }

  function chartsSheet(wb, R, charts) {
    const ws = wb.addWorksheet("Charts", { properties: { tabColor: { argb: ARGB(BRAND.gold) } }, views: [{ showGridLines: false }] });
    ws.columns = Array.from({ length: 20 }, () => ({ width: 9.5 }));
    sheetFrame(ws, "Charts", `Ikeja Electric · ${R.scope} · generated ${stamp(R.generated)}`, "Charts drawn from the same figures as the data sheets.", 20);
    const list = Object.values(charts);
    list.forEach((c, i) => {
      const col = (i % 2) * 10;
      const row = 5 + Math.floor(i / 2) * 22;
      ws.mergeCells(row, col + 1, row, col + 9);
      ws.getCell(row, col + 1).value = c.title;
      ws.getCell(row, col + 1).font = { name: "Calibri", size: 11, bold: true, color: { argb: ARGB(BRAND.ink) } };
      ws.mergeCells(row + 1, col + 1, row + 1, col + 9);
      ws.getCell(row + 1, col + 1).value = c.note;
      ws.getCell(row + 1, col + 1).font = { name: "Calibri", size: 9, italic: true, color: { argb: ARGB(BRAND.muted) } };
      const id = wb.addImage({ base64: c.url, extension: "png" });
      /* Fixed height keeps every chart inside its 22-row slot whatever its shape */
      const height = 300;
      ws.addImage(id, { tl: { col: col + 0.1, row: row + 1.2 }, ext: { width: Math.min(600, Math.round(height * c.w / c.h)), height } });
    });
  }

  function notesSheet(wb, R) {
    const ws = wb.addWorksheet("Notes", { properties: { tabColor: { argb: ARGB(BRAND.muted) } }, views: [{ showGridLines: false }] });
    ws.columns = [{ width: 30 }, { width: 100 }];
    sheetFrame(ws, "Notes & definitions", `Ikeja Electric · generated ${stamp(R.generated)}`, "How the figures in this workbook are defined.", 2);
    const rows = [
      ["Filter scope", "Every sheet reflects the dashboard filters (Business Unit, Undertaking, feeder, DT) at the time of export."],
      ["DT register", "One row per distribution transformer from the IE DT register (public and private), with its 2026 Business Unit and Undertaking."],
      ["DTs in filter / total", "\"In filter\" counts only the DTs inside the current filter; \"total\" is the whole BU or UT."],
      ["Register agreement", "Share of DTs inside a 2026 Undertaking polygon whose register Undertaking matches that polygon."],
      ["Previous BU", "The DT's Business Unit before October 1, 2026; it differs from the 2026 BU for reassigned DTs."],
      ["Feeder length inside own BU / UT", "Share of the feeder's route that lies inside the Business Unit / Undertaking it is tagged to."],
      ["Capacity", "Transformer nameplate rating in kVA; installed capacity sums these ratings."],
      ["Nomenclature", "Feeders and DTs use the DT register's standard nomenclature: feeders as <kV>-<Injection / TCN station>-<Transformer>-<Feeder> (e.g. 11-Oke IraINJ-T2-Kayode) and DTs as <Feeder>-<DT name>. Spellings that differ only by case are merged."],
      ["Privacy", "No customer account identifiers are included."],
    ];
    rows.forEach(([k, v], i) => {
      const r = 5 + i;
      ws.getCell(r, 1).value = k;
      ws.getCell(r, 1).font = { name: "Calibri", size: 10, bold: true, color: { argb: ARGB(BRAND.ink) } };
      ws.getCell(r, 2).value = v;
      ws.getCell(r, 2).font = { name: "Calibri", size: 10, color: { argb: ARGB(BRAND.ink) } };
      ws.getCell(r, 2).alignment = { wrapText: true, vertical: "top" };
      ws.getCell(r, 1).alignment = { vertical: "top" };
      [1, 2].forEach((c) => { ws.getCell(r, c).border = { bottom: thin }; });
      ws.getRow(r).height = 30;
    });
  }

  async function excel({ both = false } = {}) {
    await progress("Loading spreadsheet tools…");
    await loadScript(LIBS.exceljs);
    await progress("Collecting the filtered data…");
    const R = reportData();
    const wb = new ExcelJS.Workbook();
    wb.creator = "Ikeja Electric · GIS Team";
    wb.company = "Ikeja Electric";
    wb.title = "IE Network Monitoring Dashboard";
    wb.created = R.generated;
    const logoUrl = await logoDataUrl();
    const logo = logoUrl ? wb.addImage({ base64: logoUrl, extension: "png" }) : null;

    const contents = [
      ...(both ? [["Summary view", "Coverage KPIs and Business Unit coverage (Summary dashboard)"], ["Story highlights", "Before / after the realignment (Story map)"]] : []),
      ["Business Units", "Business Unit totals, ownership, area and density"],
      ["Undertakings", "Undertaking totals, agreement and lineage"],
      ["Feeders", "MV feeders with DT load, length and boundary fidelity"],
      ["DT register", "Every distribution transformer in the filter"],
      ["Ownership & capacity", "Ownership and installed capacity by BU"],
      ["Capacity classes", "DT count by kVA class and BU"],
      ["Reassignments", "DTs whose Business Unit changed"],
      ["Charts", "Charts of the figures above"],
      ["Notes", "Definitions and data notes"],
    ];
    await coverSheet(wb, R, logo, both, contents);

    if (both) {
      await progress("Writing Summary and Story sheets…");
      const ws = wb.addWorksheet("Summary view", { properties: { tabColor: { argb: ARGB(BRAND.blue) } }, views: [{ showGridLines: false }] });
      ws.columns = [{ width: 3 }, ...Array.from({ length: 8 }, () => ({ width: 15 }))];
      sheetFrame(ws, "Summary view", `Ikeja Electric · ${R.scope} · generated ${stamp(R.generated)}`, "Coverage KPIs as shown on the Summary dashboard.", 9);
      kpiTiles(ws, 5, [
        { label: "TOTAL COVERAGE AREA", value: `${fmt.format(+R.coverage.area.toFixed(1))} km²`, hint: R.network ? "2026 Business Unit footprint" : `${R.scope} footprint` },
        { label: "DT DENSITY", value: fmt1(R.coverage.density), hint: "transformers per km²", accent: BRAND.gold },
        { label: "ACTIVE FEEDERS", value: fmt.format(R.coverage.feeders), hint: "11 kV + 33 kV", accent: BRAND.blue },
        { label: "TRANSFORMERS", value: fmt.format(R.coverage.dts), hint: "public + private", accent: BRAND.blue },
      ]);
      ws.getCell(10, 2).value = `Mean register agreement: ${fmt1(R.coverage.agree)}%`;
      ws.getCell(10, 2).font = { name: "Calibri", size: 11, bold: true, color: { argb: "FF2E8B57" } };
      tableSheet(wb, "Story highlights", R, [
        { h: "Measure", k: "m", w: 40 },
        { h: "Pre-October 1, 2026", k: "a", w: 20, n: "#,##0" },
        { h: "2026 realignment", k: "b", w: 20, n: "#,##0" },
        { h: "Change", k: "c", w: 16, n: "+#,##0;-#,##0;0" },
      ], [
        { m: "Business Units", a: R.data.kpis.bu_existing, b: R.data.kpis.bu_2026, c: R.data.kpis.bu_2026 - R.data.kpis.bu_existing },
        { m: "Undertakings", a: R.data.kpis.ut_existing, b: R.data.kpis.ut_2026, c: R.data.kpis.ut_2026 - R.data.kpis.ut_existing },
        { m: "Distribution transformers (register)", a: R.data.kpis.dt_total, b: R.data.kpis.dt_total, c: 0 },
        { m: "DTs that changed Business Unit (in filter)", a: null, b: R.reassign.reduce((a, r) => a + r.count, 0), c: null },
      ], { description: "Structure of the franchise before and after the October 1, 2026 realignment.", totals: false, tab: BRAND.blue });
    }

    await progress("Writing data sheets…");
    for (const k of ["bus", "uts", "feeders", "dts"]) {
      if (k === "dts") await progress(`Writing ${fmt.format(R.dtRows.length)} DT rows…`);
      const [, title, cols, rows, opts] = tableSpec(R, k);
      tableSheet(wb, title, R, cols, rows, opts);
    }
    tableSheet(wb, "Ownership & capacity", R, COLS.breakdown, R.breakdown, { description: "Ownership and installed capacity by Business Unit." });
    tableSheet(wb, "Capacity classes", R, [{ h: "Business Unit", k: "name", w: 26 }, ...R.capBins.map((b) => ({ h: `${b} kVA`, k: b, w: 12, n: "#,##0", sum: true }))],
      R.breakdown.map((b) => ({ name: b.name, ...b.caps })), { description: "Distribution transformers by nameplate capacity class (kVA)." });
    tableSheet(wb, "Reassignments", R, COLS.reassign, R.reassign, { description: "DTs whose previous Business Unit differs from their 2026 Business Unit." });

    await progress("Drawing charts…");
    chartsSheet(wb, R, buildCharts(R));
    notesSheet(wb, R);

    await progress("Saving workbook…");
    const buf = await wb.xlsx.writeBuffer();
    download(`IE_Network_${both ? "Both_Dashboards" : "Operations"}_${slug(R)}_${dateTag(R.generated)}.xlsx`,
      new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    await progress("");
  }

  /* ---------- CSV / GeoJSON / KML ---------- */
  /** One table per download: file name, sheet title, columns, rows and sheet options */
  function tableSpec(R, kind) {
    return {
      bus: ["Business_Units", "Business Units", COLS.bus, R.bus, { description: "One row per Business Unit in the filter. The colour band matches the dashboard map.", swatch: true }],
      uts: ["Undertakings", "Undertakings", COLS.uts, R.uts, { description: "One row per Undertaking in the filter, with register agreement and the pre-October 1, 2026 UTs it was formed from.", swatch: true }],
      feeders: ["Feeders", "Feeders", COLS.feeders, R.feeders, { description: "Feeders with DTs in the filter, named in the DT register's standard nomenclature. Length and boundary fidelity come from the feeder network where the names match (blank otherwise)." }],
      dts: ["DT_Register", "DT register", COLS.dts, R.dtRows, { description: "Every distribution transformer inside the filter, from the IE DT register.", totals: false }],
    }[kind];
  }

  /** Single branded sheet (the formatted counterpart of a CSV download) plus the notes sheet */
  async function sheet(kind) {
    await progress("Loading spreadsheet tools…");
    await loadScript(LIBS.exceljs);
    const R = reportData();
    const [file, title, cols, rows, opts] = tableSpec(R, kind);
    await progress(`Writing ${plural(rows.length, "row")}…`);
    const wb = new ExcelJS.Workbook();
    wb.creator = "Ikeja Electric · GIS Team";
    wb.company = "Ikeja Electric";
    wb.title = `IE ${title}`;
    wb.created = R.generated;
    tableSheet(wb, title, R, cols, rows, opts);
    notesSheet(wb, R);
    const buf = await wb.xlsx.writeBuffer();
    download(`IE_${file}_${slug(R)}_${dateTag(R.generated)}.xlsx`, new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    await progress("");
  }

  function csv(kind) {
    const R = reportData();
    const [name, , cols, rows] = tableSpec(R, kind);
    const esc = (v) => {
      if (v == null) return "";
      const s = typeof v === "number" ? String(Math.round(v * 1e6) / 1e6) : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [cols.map((c) => esc(c.h)).join(","), ...rows.map((r) => cols.map((c) => esc(r[c.k])).join(","))];
    /* BOM so Excel opens UTF-8 names (≤, ², →) correctly */
    download(`IE_${name}_${slug(R)}_${dateTag(R.generated)}.csv`, new Blob([`﻿${lines.join("\r\n")}`], { type: "text/csv;charset=utf-8" }));
  }

  /** KMZ boundary symbology as simplestyle properties (read by geojson.io, QGIS styling expressions, etc.) */
  const simpleStyle = (p) => ({ fill: p.fill_hex, "fill-opacity": p.fill_opacity ?? 0.4, stroke: p.stroke || p.fill_hex, "stroke-width": p.stroke_width || 2 });

  function geojson() {
    const R = reportData();
    const features = [];
    R.data.map.bu_polygons.filter((p) => R.sum.bus.includes(p.bu_name)).forEach((p) => {
      const b = R.bus.find((x) => x.code === p.bu_name) || {};
      features.push({
        type: "Feature",
        properties: { layer: "Business Unit", business_unit: b.name, undertakings: b.uts, dts_in_filter: b.dts, area_km2: b.area, dts_per_km2: +(+b.density).toFixed(1), ...simpleStyle(p) },
        geometry: { type: "Polygon", coordinates: p.rings },
      });
    });
    if (!R.network && R.sum.level !== "bu") {
      R.data.map.ut_polygons.filter((p) => R.sum.uts.includes(p.ut_name)).forEach((p) => {
        const u = R.uts.find((x) => x.code === p.ut_name) || {};
        features.push({
          type: "Feature",
          properties: { layer: "Undertaking", undertaking: u.name, business_unit: u.bu, dts_in_filter: u.dts, register_agreement_pct: u.agree, area_km2: u.area, ...simpleStyle(p) },
          geometry: { type: "Polygon", coordinates: p.rings },
        });
      });
    }
    R.dtRows.forEach((d) => {
      if (d.lat == null) return;
      features.push({
        type: "Feature",
        properties: { layer: "Distribution transformer", name: d.name, feeder: d.feeder, business_unit: d.bu, undertaking: d.ut, previous_bu: d.oldBu, ownership: d.own, capacity_kva: d.cap, connection: d.conn, metering: d.meter },
        geometry: { type: "Point", coordinates: [d.lon, d.lat] },
      });
    });
    const fc = { type: "FeatureCollection", name: `IE Network · ${R.scope}`, generated: R.generated.toISOString(), features };
    download(`IE_Map_${slug(R)}_${dateTag(R.generated)}.geojson`, new Blob([JSON.stringify(fc)], { type: "application/geo+json" }));
  }

  function kml() {
    const R = reportData();
    const x = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const kmlColor = (hex, a) => { const h = String(hex || "#6b7c90").replace("#", ""); return `${a}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`; };
    const alpha = (o) => Math.round((o ?? 0.4) * 255).toString(16).padStart(2, "0");
    const styles = R.data.map.bu_polygons.map((p) => `<Style id="bu-${x(p.bu_name)}"><LineStyle><color>${kmlColor(p.stroke || p.fill_hex, "ff")}</color><width>${p.stroke_width || 2}</width></LineStyle><PolyStyle><color>${kmlColor(p.fill_hex, alpha(p.fill_opacity))}</color></PolyStyle></Style>`).join("");
    const pin = (id, color) => `<Style id="${id}"><IconStyle><color>${color}</color><scale>0.55</scale><Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon></IconStyle><LabelStyle><scale>0</scale></LabelStyle></Style>`;
    const ring = (r) => r.map(([lon, lat]) => `${lon},${lat},0`).join(" ");
    const buFolder = R.data.map.bu_polygons.filter((p) => R.sum.bus.includes(p.bu_name)).map((p) => {
      const b = R.bus.find((y) => y.code === p.bu_name) || {};
      return `<Placemark><name>${x(b.name)}</name><description>${x(`${fmt.format(b.dts || 0)} DTs in filter · ${b.uts} Undertakings · ${fmt1(b.area)} km²`)}</description><styleUrl>#bu-${x(p.bu_name)}</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>${ring(p.rings[0])}</coordinates></LinearRing></outerBoundaryIs>${p.rings.slice(1).map((r) => `<innerBoundaryIs><LinearRing><coordinates>${ring(r)}</coordinates></LinearRing></innerBoundaryIs>`).join("")}</Polygon></Placemark>`;
    }).join("");
    const byBu = {};
    R.dtRows.forEach((d) => { if (d.lat != null) (byBu[d.bu] || (byBu[d.bu] = [])).push(d); });
    const dtFolders = Object.entries(byBu).map(([bu, rows]) => `<Folder><name>DTs · ${x(bu)} (${fmt.format(rows.length)})</name>${rows.map((d) => `<Placemark><name>${x(d.name)}</name><styleUrl>#${/private/i.test(d.own) ? "dt-private" : "dt-public"}</styleUrl><ExtendedData>${[["Feeder", d.feeder], ["Undertaking", d.ut], ["Ownership", d.own], ["Capacity (kVA)", d.cap], ["Connection", d.conn], ["Metering", d.meter]].map(([k, v]) => `<Data name="${k}"><value>${x(v)}</value></Data>`).join("")}</ExtendedData><Point><coordinates>${d.lon},${d.lat},0</coordinates></Point></Placemark>`).join("")}</Folder>`).join("");
    const doc = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>IE Network · ${x(R.scope)}</name><description>Ikeja Electric · GIS Team · generated ${x(stamp(R.generated))}</description>${styles}${pin("dt-public", "ffb26f1f")}${pin("dt-private", "ff2c45c8")}<Folder><name>Business Units</name>${buFolder}</Folder>${dtFolders}</Document></kml>`;
    download(`IE_Map_${slug(R)}_${dateTag(R.generated)}.kml`, new Blob([doc], { type: "application/vnd.google-earth.kml+xml" }));
  }

  /* ---------- PDF report (A4 landscape, IE branded) ---------- */
  /* The PDF core fonts only cover Latin-1: swap the few symbols the dashboard uses */
  const pdfText = (s) => String(s ?? "")
    .replace(/≤/g, "<=").replace(/≥/g, ">=").replace(/→/g, "to").replace(/₦/g, "N").replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

  async function pdf({ both = true } = {}) {
    if (typeof jspdf === "undefined") throw new Error("PDF library is still loading — try again in a moment.");
    await progress("Loading report tools…");
    await loadScript(LIBS.autotable);
    await progress("Collecting the filtered data…");
    const R = reportData();
    const { jsPDF } = jspdf;
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4", compress: true });
    doc.setProperties({ title: "IE Network Monitoring Report", subject: R.scope, author: "Ikeja Electric · GIS Team", creator: "IE Network Monitoring Dashboard" });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();
    const M = 36;
    const logo = await logoDataUrl();
    const ink = rgb(BRAND.ink);
    const muted = rgb(BRAND.muted);
    const red = rgb(BRAND.red);
    const gold = rgb(BRAND.gold);

    await progress("Drawing charts and map…");
    const charts = buildCharts(R);
    const map = mapPNG(R);

    const text = (s, x, y, o = {}) => doc.text(pdfText(s), x, y, o);
    /* Pages are white already; no background fill (AutoTable calls this after drawing the table).
       Drawn once per page: the first caller names the page, later tables on it don't overprint. */
    const headed = new Set();
    const header = (title, section) => {
      const page = doc.getCurrentPageInfo().pageNumber;
      if (headed.has(page)) return;
      headed.add(page);
      if (logo) doc.addImage(logo, "PNG", M, 12, 40, 29, "ielogo", "FAST");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(15);
      doc.setTextColor(...ink);
      text(title, M + 52, 30);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(...muted);
      text(section, W - M, 22, { align: "right" });
      text(R.scope, W - M, 34, { align: "right" });
      doc.setFillColor(...red);
      doc.rect(M, 48, (W - 2 * M) * 0.62, 3, "F");
      doc.setFillColor(...gold);
      doc.rect(M + (W - 2 * M) * 0.62, 48, (W - 2 * M) * 0.38, 3, "F");
    };
    const sectionTitle = (s, x, y) => {
      doc.setFillColor(...red);
      doc.rect(x, y - 9, 3, 12, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11.5);
      doc.setTextColor(...ink);
      text(s, x + 9, y);
    };
    const tile = (x, y, w, h, t) => {
      const accent = rgb(t.accent || BRAND.red);
      doc.setFillColor(255, 247, 232);
      doc.roundedRect(x, y, w, h, 6, 6, "F");
      doc.setFillColor(...accent);
      doc.rect(x, y, w, 3, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(...muted);
      text(t.label, x + 10, y + 16);
      doc.setFontSize(t.value.length > 12 ? 13 : 17);
      doc.setTextColor(...accent);
      text(t.value, x + 10, y + 37);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.2);
      doc.setTextColor(...muted);
      text(doc.splitTextToSize(pdfText(t.hint || ""), w - 18)[0] || "", x + 10, y + h - 9);
    };
    const chartBox = (c, x, y, w, h) => {
      if (!c) return;
      doc.setDrawColor(...rgb(BRAND.line));
      doc.setLineWidth(0.6);
      doc.roundedRect(x, y, w, h, 6, 6, "S");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(...ink);
      text(c.title, x + 10, y + 16);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...muted);
      text(c.note, x + 10, y + 28);
      const iw = w - 20;
      const ih = h - 42;
      const scale = Math.min(iw / c.w, ih / c.h);
      doc.addImage(c.url, "PNG", x + 10 + (iw - c.w * scale) / 2, y + 34 + (ih - c.h * scale) / 2, c.w * scale, c.h * scale, undefined, "FAST");
    };
    const table = (title, cols, rows, startY, o = {}) => {
      const num = (c, v) => {
        if (v == null || v === "") return "";
        if (!c.n) return pdfText(v);
        const n = Number(v);
        if (!Number.isFinite(n)) return pdfText(v);
        if (c.n.includes("%")) return `${n.toFixed(1)}%`;
        if (c.n.includes(".000000")) return n.toFixed(5);
        if (c.n.includes(".00")) return n.toFixed(2);
        if (c.n.includes(".0")) return n.toFixed(1);
        return fmt.format(Math.round(n));
      };
      const sums = cols.map((c) => (c.sum ? rows.reduce((a, r) => a + (Number(r[c.k]) || 0), 0) : null));
      doc.autoTable({
        startY,
        head: [cols.map((c) => pdfText(c.h))],
        body: rows.map((r) => cols.map((c) => num(c, r[c.k]))),
        foot: o.totals !== false && rows.length > 1 && cols.some((c) => c.sum) ? [cols.map((c, i) => (i === 0 ? "Total" : c.sum ? num(c, sums[i]) : ""))] : undefined,
        theme: "plain",
        margin: { left: M, right: M, top: 64, bottom: 40 },
        styles: { font: "helvetica", fontSize: o.fontSize || 8, cellPadding: { top: 4, bottom: 4, left: 5, right: 5 }, textColor: ink, lineColor: rgb(BRAND.line), lineWidth: { bottom: 0.5 }, overflow: "linebreak" },
        headStyles: { fillColor: red, textColor: 255, fontStyle: "bold", fontSize: (o.fontSize || 8) + 0.2, lineWidth: { bottom: 1.5 }, lineColor: gold },
        footStyles: { fillColor: [255, 247, 232], textColor: ink, fontStyle: "bold" },
        alternateRowStyles: { fillColor: rgb(BRAND.zebra) },
        columnStyles: Object.fromEntries(cols.map((c, i) => [i, { halign: c.n ? "right" : "left", cellWidth: c.pw || "auto" }])),
        didDrawPage: () => header("IE Network Monitoring Report", title),
        /* Totals sit under their number columns */
        didParseCell: (d) => { if (d.section === "foot" && cols[d.column.index]?.n) d.cell.styles.halign = "right"; },
        showFoot: "lastPage",
      });
      return doc.lastAutoTable.finalY;
    };

    /* 1 · Cover */
    doc.setFillColor(...ink);
    doc.rect(0, 0, W, H, "F");
    doc.setFillColor(...rgb(BRAND.navy));
    doc.rect(W * 0.42, 0, W * 0.58, H, "F");
    doc.setFillColor(...red);
    doc.rect(0, H - 8, W * 0.62, 8, "F");
    doc.setFillColor(...gold);
    doc.rect(W * 0.62, H - 8, W * 0.38, 8, "F");
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(M, 40, 120, 90, 10, 10, "F");
    if (logo) doc.addImage(logo, "PNG", M + 14, 47, 92, 67, "ielogo", "FAST");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...gold);
    text("IKEJA ELECTRIC  ·  GIS TEAM", M, 168, { charSpace: 1.2 });
    doc.setFontSize(28);
    doc.setTextColor(255, 255, 255);
    text("IE Network", M, 204);
    text("Monitoring Report", M, 236);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.setTextColor(214, 222, 232);
    text("2026 Undertaking / Business Unit realignment", M, 262);
    doc.setDrawColor(...gold);
    doc.setLineWidth(1);
    const chip = doc.splitTextToSize(pdfText(`Scope: ${R.scope}`), W * 0.42 - 2 * M - 20)[0];
    doc.roundedRect(M, 280, doc.getTextWidth(chip) + 20, 22, 11, 11, "S");
    doc.setFontSize(10);
    doc.setTextColor(...gold);
    doc.text(chip, M + 10, 295);
    doc.setFontSize(9);
    doc.setTextColor(170, 182, 198);
    text(`Generated ${stamp(R.generated)}`, M, 324);
    text(both ? "Operations · Summary · Story map" : "Operations dashboard", M, 338);
    const kp = kpiList(R).slice(0, 4);
    kp.forEach((t, i) => {
      const x = M + (i % 2) * 150;
      const y = 380 + Math.floor(i / 2) * 78;
      doc.setFillColor(...rgb(BRAND.navy));
      doc.roundedRect(x, y, 140, 66, 6, 6, "F");
      doc.setFillColor(...rgb(t.accent || BRAND.red));
      doc.rect(x, y, 140, 3, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.8);
      doc.setTextColor(170, 182, 198);
      text(t.label, x + 10, y + 17);
      doc.setFontSize(16);
      doc.setTextColor(255, 255, 255);
      text(t.value, x + 10, y + 40);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.8);
      doc.setTextColor(170, 182, 198);
      text(doc.splitTextToSize(pdfText(t.hint), 124)[0] || "", x + 10, y + 56);
    });
    const mx = W * 0.42 + 24;
    const mw = W * 0.58 - 48;
    const mh = mw * (map.h / map.w);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(mx - 6, 70 - 6, mw + 12, mh + 12, 8, 8, "F");
    doc.addImage(map.url, "PNG", mx, 70, mw, mh, "covermap", "FAST");
    doc.setFontSize(8);
    doc.setTextColor(170, 182, 198);
    text("Filtered area · BU areas (dark outline) and UTs (white outline) as in the 2026 KMZ, 11 kV (blue) and 33 kV (orange) feeders, DTs (public blue, private red), ISS (gold)", mx, 70 + mh + 22, { maxWidth: mw });

    /* 2 · Executive summary */
    doc.addPage();
    header("Executive summary", "Key figures and findings");
    const tiles = kpiList(R);
    const tw = (W - 2 * M - 3 * 10) / 4;
    tiles.forEach((t, i) => tile(M + (i % 4) * (tw + 10), 62 + Math.floor(i / 4) * 70, tw, 62, t));
    sectionTitle("Key findings", M, 222);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...ink);
    let fy = 242;
    findings(R).forEach((f) => {
      const lines = doc.splitTextToSize(pdfText(f), W * 0.55 - M - 18);
      doc.setFillColor(...gold);
      doc.circle(M + 4, fy - 3, 2.2, "F");
      doc.text(lines, M + 14, fy);
      fy += lines.length * 12 + 7;
    });
    chartBox(charts.ownership, W * 0.58, 208, W * 0.42 - M, 162);
    chartBox(charts.workload, W * 0.58, 378, W * 0.42 - M, H - 378 - 40);
    doc.setFontSize(8);
    doc.setTextColor(...muted);
    text("All figures follow the dashboard filters at the moment this report was generated.", M, H - 52);

    /* 3 · Network map */
    doc.addPage();
    header("Network map", "Filtered area");
    const fh = H - 64 - 80;
    const fw = Math.min(W - 2 * M, fh * (map.w / map.h));
    doc.addImage(map.url, "PNG", (W - fw) / 2, 62, fw, fw * (map.h / map.w), "covermap", "FAST");
    const legend = [["Public DT", BRAND.blue], ["Private DT", BRAND.red], ["11 kV feeder", "1F6FB2"], ["33 kV feeder", "FF7A3D"], ["Injection substation", BRAND.gold]];
    legend.forEach(([label, hex], i) => {
      const x = M + i * 150;
      doc.setFillColor(...rgb(hex));
      doc.circle(x + 4, H - 56, 4, "F");
      doc.setFontSize(8.5);
      doc.setTextColor(...ink);
      text(label, x + 13, H - 53);
    });
    R.bus.slice(0, 5).forEach((b, i) => {
      const x = M + i * 150;
      doc.setFillColor(...rgb(String(b.swatch).replace("#", "")));
      doc.rect(x, H - 44, 9, 9, "F");
      doc.setFontSize(8.5);
      doc.setTextColor(...ink);
      text(b.name, x + 13, H - 36);
    });

    /* 4 · Network & assets */
    doc.addPage();
    header("Network and assets", "Workload, capacity, density, feeders");
    const gw = (W - 2 * M - 14) / 2;
    const gh = (H - 64 - 44 - 14) / 2;
    chartBox(charts.workload, M, 62, gw, gh);
    chartBox(charts.capacity, M + gw + 14, 62, gw, gh);
    chartBox(charts.density, M, 62 + gh + 14, gw, gh);
    chartBox(charts.feeders, M + gw + 14, 62 + gh + 14, gw, gh);

    /* 5 · Ownership, quality and change */
    doc.addPage();
    header("Ownership, quality and change", "Agreement, reassignments, ownership and capacity");
    chartBox(charts.agreement, M, 62, gw, gh);
    if (charts.reassign) chartBox(charts.reassign, M + gw + 14, 62, gw, gh);
    sectionTitle("Ownership and capacity by Business Unit", M, 62 + gh + 30);
    doc.autoTable({
      startY: 62 + gh + 40,
      margin: { left: M, right: M },
      tableWidth: W - 2 * M,
      head: [["Business Unit", "DTs", "Public", "Private", "Installed capacity (kVA)"]],
      body: R.breakdown.map((b) => [pdfText(b.name.replace(/ Business Unit$/, "")), fmt.format(b.total), `${fmt1(pctOf(b.pub, b.total))}%`, `${fmt1(pctOf(b.priv, b.total))}%`, fmt.format(b.kva)]),
      theme: "plain",
      styles: { fontSize: 8, cellPadding: 4, textColor: ink, lineColor: rgb(BRAND.line), lineWidth: { bottom: 0.5 } },
      headStyles: { fillColor: red, textColor: 255, fontStyle: "bold" },
      alternateRowStyles: { fillColor: rgb(BRAND.zebra) },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
      didParseCell: (d) => { if (d.section === "head" && d.column.index > 0) d.cell.styles.halign = "right"; },
    });

    /* 6+ · Tables */
    await progress("Laying out tables…");
    doc.addPage();
    header("IE Network Monitoring Report", "Business Units");
    sectionTitle("Business Units", M, 76);
    let y = table("Business Units", COLS.bus, R.bus, 86, { fontSize: 8.5 });
    if (both) {
      sectionTitle("Summary view · coverage", M, y + 30);
      const cov = [
        { label: "TOTAL COVERAGE AREA", value: `${fmt.format(+R.coverage.area.toFixed(1))} km²`, hint: R.network ? "2026 BU footprint" : `${R.scope} footprint` },
        { label: "DT DENSITY", value: fmt1(R.coverage.density), hint: "transformers per km²", accent: BRAND.gold },
        { label: "ACTIVE FEEDERS", value: fmt.format(R.coverage.feeders), hint: "11 kV + 33 kV", accent: BRAND.blue },
        { label: "TRANSFORMERS", value: fmt.format(R.coverage.dts), hint: "public + private", accent: BRAND.blue },
        { label: "MEAN AGREEMENT", value: `${fmt1(R.coverage.agree)}%`, hint: "register vs polygon", accent: "2E8B57" },
      ];
      const cw = (W - 2 * M - 4 * 10) / 5;
      if (y + 120 > H - 40) { doc.addPage(); header("IE Network Monitoring Report", "Summary view"); y = 40; }
      cov.forEach((t, i) => tile(M + i * (cw + 10), y + 42, cw, 62, t));
      y += 120;
      sectionTitle("Story map · before and after", M, y + 14);
      doc.autoTable({
        startY: y + 24,
        margin: { left: M, right: M, top: 64, bottom: 40 },
        head: [["Measure", "Pre-October 1, 2026", "2026 realignment", "Change"]],
        body: [
          ["Business Units", R.data.kpis.bu_existing, R.data.kpis.bu_2026, R.data.kpis.bu_2026 - R.data.kpis.bu_existing],
          ["Undertakings", R.data.kpis.ut_existing, R.data.kpis.ut_2026, R.data.kpis.ut_2026 - R.data.kpis.ut_existing],
          ["DTs that changed Business Unit (in filter)", "", fmt.format(R.reassign.reduce((a, r) => a + r.count, 0)), ""],
        ].map((r) => r.map((v) => (typeof v === "number" ? (v > 0 && r[0] !== "Business Units" && r[0] !== "Undertakings" ? `+${v}` : String(v)) : pdfText(v)))),
        theme: "plain",
        styles: { fontSize: 8.5, cellPadding: 4, textColor: ink, lineColor: rgb(BRAND.line), lineWidth: { bottom: 0.5 } },
        headStyles: { fillColor: red, textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: rgb(BRAND.zebra) },
        columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
        didDrawPage: () => header("IE Network Monitoring Report", "Summary and Story"),
      });
    }
    doc.addPage();
    header("IE Network Monitoring Report", "Undertakings");
    sectionTitle("Undertakings", M, 76);
    table("Undertakings", COLS.uts.map((c) => (c.k === "formedFrom" ? { ...c, pw: 170 } : c)), R.uts, 86, { fontSize: 7.6 });
    doc.addPage();
    header("IE Network Monitoring Report", "Feeders");
    sectionTitle(`Top feeders by DT count${R.feeders.length > 30 ? " (top 30)" : ""}`, M, 76);
    table("Feeders", COLS.feeders, R.feeders.slice(0, 30), 86, { totals: false });
    if (R.reassign.length) {
      sectionTitle("Business Unit reassignments", M, doc.lastAutoTable.finalY + 28);
      table("Reassignments", COLS.reassign.map((c) => ({ ...c, pw: c.k === "flow" ? 260 : 110 })), R.reassign, doc.lastAutoTable.finalY + 38);
    }

    /* Last · Notes */
    doc.addPage();
    header("Notes and method", "How the figures are produced");
    const notes = [
      ["Live figures", "This report is generated in the browser from the same data and filters as the dashboard, at the moment you click Export. Re-export after data or filter changes and the report updates with them."],
      ["Filter scope", R.scope],
      ["DT register", `${fmt.format(R.data.kpis.dt_total)} distribution transformers (public and private) with their 2026 Business Unit, Undertaking, feeder, ownership, capacity, connection and metering status.`],
      ["Register agreement", "Share of DTs inside a 2026 Undertaking polygon whose register Undertaking matches that polygon."],
      ["Reassignments", "DTs whose previous (pre-October 1, 2026) Business Unit differs from their 2026 Business Unit."],
      ["Map", "BU / UT boundaries, labels and 11 / 33 kV feeder routes come from the IE 2026 KMZ exports and use their symbology (BU: dark 4 px outline, 40% fill; UT: white 2 px outline, 55% fill). DTs from the DT register; ISS locations; the Lagos State outline is the solid gold line."],
      ["Privacy", "No customer account identifiers are included."],
    ];
    let ny = 84;
    notes.forEach(([k, v]) => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(...ink);
      text(k, M, ny);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...muted);
      const lines = doc.splitTextToSize(pdfText(v), W - 2 * M - 160);
      doc.text(lines, M + 160, ny);
      ny += Math.max(1, lines.length) * 12 + 12;
      doc.setDrawColor(...rgb(BRAND.line));
      doc.line(M, ny - 7, W - M, ny - 7);
    });

    /* Footer on every page except the cover */
    const pages = doc.getNumberOfPages();
    for (let p = 2; p <= pages; p += 1) {
      doc.setPage(p);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...muted);
      text("Ikeja Electric  ·  IE Network Monitoring Report  ·  Prepared by the GIS Team", M, H - 20);
      text(`Generated ${stamp(R.generated)}`, W / 2, H - 20, { align: "center" });
      text(`Page ${p} of ${pages}`, W - M, H - 20, { align: "right" });
    }

    await progress("Saving report…");
    doc.save(`IE_Network_Report_${slug(R)}_${dateTag(R.generated)}.pdf`);
    await progress("");
  }

  /* ---------- Public API ---------- */
  const busy = new Set();
  async function run(key, fn) {
    if (busy.has(key)) return;
    busy.add(key);
    document.querySelectorAll(`[data-report="${key}"]`).forEach((b) => b.setAttribute("aria-busy", "true"));
    try {
      await fn();
    } catch (err) {
      console.error(err);
      await progress("");
      const status = document.getElementById("io-status");
      if (status) {
        status.hidden = false;
        status.textContent = `Export failed: ${err.message || err}`;
        status.classList.add("error");
      }
    } finally {
      busy.delete(key);
      document.querySelectorAll(`[data-report="${key}"]`).forEach((b) => b.removeAttribute("aria-busy"));
    }
  }

  window.IKEDCReports = {
    pdf: (o) => run("pdf", () => pdf(o)),
    excel: (o) => run(o?.both ? "excel-both" : "excel", () => excel(o)),
    sheet: (kind) => run(`sheet-${kind}`, () => sheet(kind)),
    csv: (kind) => run(`csv-${kind}`, async () => csv(kind)),
    geojson: () => run("geojson", async () => geojson()),
    kml: () => run("kml", async () => kml()),
    scopeLabel: () => { try { return reportData().scope; } catch { return ""; } },
  };
})();
