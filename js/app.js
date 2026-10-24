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
    dtOwn: null,
    installPos: null,
    fidelityBand: null,
    capacityBand: null,
    map: null,
    layers: {
      bu: null, ut: null, dtsPublic: null, dtsPrivate: null, iss: null, tcn: null,
      feeders11: null, feeders33: null, buLabels: null, utLabels: null, uploads: null, lagos: null,
    },
    layerControl: null,
    dtRenderer: null,
    feederRenderer: null,
    mapRedrawRaf: 0,
    uploads: [],
    lagos: null,
    baseTile: null,
    charts: {},
    activeTab: "overview",
    rendered: { overview: false, assets: false, feeders: false },
  };

  /** Overlay checklist defaults — multi-select, not exclusive */
  const LAYER_DEFAULTS = {
    lagos: true,
    bu: true,
    ut: true,
    feeders11: true,
    feeders33: true,
    dtsPublic: true,
    dtsPrivate: true,
    iss: true,
    tcn: true,
    uploads: true,
  };

  const FEEDER_STYLE_11 = {
    color: "#5ec8ff",
    weight: 1.65,
    opacity: 0.9,
    lineCap: "round",
    lineJoin: "round",
    className: "feeder-line feeder-11kv",
  };
  const FEEDER_STYLE_33 = {
    color: "#ff7a3d",
    weight: 2.85,
    opacity: 0.95,
    lineCap: "round",
    lineJoin: "round",
    className: "feeder-line feeder-33kv",
  };

  const isPrivateOwn = (own) => String(own || "").toUpperCase().includes("PRIVATE");

  function dtMarkerOptions(own, focused, renderer) {
    const priv = isPrivateOwn(own);
    if (priv) {
      return {
        radius: focused ? 5.5 : 3.1,
        color: "#fff7f2",
        weight: focused ? 1.6 : 1.15,
        fillColor: "#e4572e",
        fillOpacity: 0.92,
        renderer,
      };
    }
    return {
      radius: focused ? 5 : 2.6,
      color: "#dcefff",
      weight: focused ? 1.4 : 0.9,
      fillColor: "#3d9cf0",
      fillOpacity: 0.88,
      renderer,
    };
  }

  function dtDivIcon(own, focused) {
    const priv = isPrivateOwn(own);
    const s = focused ? 14 : 10;
    if (priv) {
      return L.divIcon({
        className: "dt-marker dt-private",
        html: `<svg width="${s}" height="${s}" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 1.2 L12.8 7 L7 12.8 L1.2 7 Z" fill="#e4572e" stroke="#fff" stroke-width="1.35"/></svg>`,
        iconSize: [s, s],
        iconAnchor: [s / 2, s / 2],
      });
    }
    return L.divIcon({
      className: "dt-marker dt-public",
      html: `<svg width="${s}" height="${s}" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.2" fill="#3d9cf0" stroke="#fff" stroke-width="1.35"/></svg>`,
      iconSize: [s, s],
      iconAnchor: [s / 2, s / 2],
    });
  }

  const chartTheme = () => {
    const theme = document.documentElement.getAttribute("data-theme") || "dark";
    const light = theme === "light";
    return {
      theme,
      light,
      text: light ? "#0f1c2e" : "#eef3fa",
      muted: light ? "#3d4f63" : "#a8b7c9",
      border: light ? "rgba(15,30,50,0.14)" : "rgba(255,255,255,0.10)",
      labelStroke: light ? "rgba(255,255,255,0.96)" : "rgba(8,12,18,0.94)",
      labelFill: light ? "#0f1c2e" : "#ffffff",
    };
  };

  const ESRI_TILES = {
    imagery: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    labels: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
    lightGray: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    darkGray: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    transport: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
    street: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    topo: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    lightRef: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
    darkRef: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",
  };
  const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
  const DEFAULT_BASEMAP = "Hybrid (satellite + streets)";

  /**
   * Every basemap carries street names: satellite is always paired with the Esri roads and
   * place-name reference layers, and the grey canvases with their matching reference layers.
   */
  function makeBasemaps() {
    const esri = (url, o = {}) => L.tileLayer(url, { attribution: "Tiles © Esri", maxZoom: 20, maxNativeZoom: 19, ...o });
    return {
      [DEFAULT_BASEMAP]: L.layerGroup([
        esri(ESRI_TILES.imagery),
        esri(ESRI_TILES.transport, { attribution: "Roads © Esri" }),
        esri(ESRI_TILES.labels, { attribution: "Labels © Esri", opacity: 0.95 }),
      ]),
      "Street map": esri(ESRI_TILES.street),
      "OpenStreetMap": L.tileLayer(OSM_TILES, {
        maxZoom: 20, maxNativeZoom: 19,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
      }),
      "Topographic": esri(ESRI_TILES.topo),
      "Light canvas + streets": L.layerGroup([
        esri(ESRI_TILES.lightGray, { maxNativeZoom: 16 }),
        esri(ESRI_TILES.lightRef, { maxNativeZoom: 16 }),
      ]),
      "Dark canvas + streets": L.layerGroup([
        esri(ESRI_TILES.darkGray, { maxNativeZoom: 16 }),
        esri(ESRI_TILES.darkRef, { maxNativeZoom: 16 }),
      ]),
    };
  }

  const MAP_ICONS = {
    expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/></svg>',
    collapse: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8h5V3M21 8h-5V3M3 16h5v5M21 16h-5v5"/></svg>',
    layers: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5z"/><path d="m3 13 9 5 9-5"/></svg>',
  };

  /**
   * On-map tools: an expand/collapse (full-window) button under the zoom buttons and a basemap
   * picker in the top-right corner. The picker stays in step with the Filter Layers dropdown.
   */
  function addMapTools(map, bases, opts = {}) {
    if (!map || !bases || map._ieMapTools) return;
    map._ieMapTools = true;
    const names = Object.keys(bases);
    const storeKey = opts.storageKey ? `ie-basemap-${opts.storageKey}` : null;
    const current = () => names.find((n) => map.hasLayer(bases[n]));

    let menu = null;
    const refresh = () => {
      if (!menu) return;
      const cur = current();
      menu.querySelectorAll("[data-basemap]").forEach((b) => {
        const on = b.dataset.basemap === cur;
        b.classList.toggle("active", on);
        b.setAttribute("aria-checked", on ? "true" : "false");
      });
    };
    const select = (name) => {
      const cur = current();
      if (!bases[name] || cur === name) return;
      if (cur) map.removeLayer(bases[cur]);
      map.addLayer(bases[name]);
      map.fire("baselayerchange", { layer: bases[name], name });
    };
    map.on("baselayerchange", (e) => {
      refresh();
      const name = e.name || names.find((n) => bases[n] === e.layer);
      if (storeKey && name) { try { localStorage.setItem(storeKey, name); } catch { /* ignore */ } }
    });

    const BaseCtl = L.Control.extend({
      options: { position: "topright" },
      onAdd() {
        const box = L.DomUtil.create("div", "leaflet-bar map-tool map-basemap-ctl");
        box.innerHTML = `<button type="button" class="map-tool-btn" title="Basemap" aria-label="Choose basemap" aria-expanded="false">${MAP_ICONS.layers}</button>
          <div class="map-basemap-menu" role="radiogroup" aria-label="Basemap" hidden>
            <div class="map-basemap-title">Basemap</div>
            ${names.map((n) => `<button type="button" role="radio" data-basemap="${n}">${n}</button>`).join("")}
          </div>`;
        L.DomEvent.disableClickPropagation(box);
        L.DomEvent.disableScrollPropagation(box);
        const btn = box.querySelector(".map-tool-btn");
        menu = box.querySelector(".map-basemap-menu");
        const close = () => { menu.hidden = true; btn.setAttribute("aria-expanded", "false"); };
        btn.addEventListener("click", () => {
          menu.hidden = !menu.hidden;
          btn.setAttribute("aria-expanded", menu.hidden ? "false" : "true");
          refresh();
        });
        menu.addEventListener("click", (e) => {
          const b = e.target.closest("[data-basemap]");
          if (!b) return;
          select(b.dataset.basemap);
          close();
        });
        document.addEventListener("click", (e) => { if (!box.contains(e.target)) close(); });
        return box;
      },
    });
    new BaseCtl().addTo(map);

    const container = opts.container || map.getContainer().closest(".map-card") || map.getContainer();
    let fsBtn = null;
    let placeholder = null;
    const setExpanded = (on) => {
      // Story panels animate with transforms, so expand their map outside that
      // stacking context and restore its exact place when it is collapsed.
      if (opts.portal && on && !placeholder) {
        placeholder = document.createComment("expanded map position");
        container.before(placeholder);
        document.body.appendChild(container);
      } else if (opts.portal && !on && placeholder) {
        placeholder.replaceWith(container);
        placeholder = null;
      }
      container.classList.toggle("map-expanded", on);
      document.body.classList.toggle("map-expanded-open", on || !!document.querySelector(".map-expanded"));
      if (fsBtn) {
        fsBtn.innerHTML = on ? MAP_ICONS.collapse : MAP_ICONS.expand;
        fsBtn.title = on ? "Collapse map" : "Expand map";
        fsBtn.setAttribute("aria-label", fsBtn.title);
        fsBtn.setAttribute("aria-pressed", on ? "true" : "false");
      }
      if (fsBtn && on) fsBtn.focus();
      setTimeout(() => map.invalidateSize(), 60);
      setTimeout(() => map.invalidateSize(), 320);
    };
    const FsCtl = L.Control.extend({
      options: { position: "topleft" },
      onAdd() {
        const box = L.DomUtil.create("div", "leaflet-bar map-tool map-fs-ctl");
        fsBtn = L.DomUtil.create("button", "map-tool-btn", box);
        fsBtn.type = "button";
        L.DomEvent.disableClickPropagation(box);
        L.DomEvent.on(fsBtn, "click", () => setExpanded(!container.classList.contains("map-expanded")));
        return box;
      },
    });
    new FsCtl().addTo(map);
    setExpanded(false);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && container.classList.contains("map-expanded")) setExpanded(false);
    });

    let saved = null;
    if (storeKey) { try { saved = localStorage.getItem(storeKey); } catch { /* ignore */ } }
    if (saved && bases[saved]) select(saved);
    refresh();
  }

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

  const uniq = (arr) => [...new Set(arr.filter(Boolean))];

  /** Feeder meta rows (BU / UT / length) for a register feeder name — exact tail + voltage match first */
  function feederMetaFor(name) {
    const tail = String(name || "").split("-").pop().trim().toLowerCase();
    const volt = guessVoltage(name);
    let hits = state.data.feeders.filter((f) => String(f.feeder).trim().toLowerCase() === tail);
    if (volt !== "—" && hits.some((f) => f.voltage === volt)) hits = hits.filter((f) => f.voltage === volt);
    if (hits.length > 1 && hits.some((f) => f.new_ut)) hits = hits.filter((f) => f.new_ut);
    if (!hits.length) hits = state.data.feeders.filter((f) => matchFeederLine(f.feeder, [name]));
    return hits;
  }

  let _sampleByFeeder = null;
  function sampleByFeeder() {
    if (_sampleByFeeder) return _sampleByFeeder;
    _sampleByFeeder = new Map();
    (state.data.map.dt_sample || []).forEach((d) => {
      if (!d.feeder) return;
      if (!_sampleByFeeder.has(d.feeder)) _sampleByFeeder.set(d.feeder, []);
      _sampleByFeeder.get(d.feeder).push(d);
    });
    return _sampleByFeeder;
  }

  /** True once data/dt_register.json (every DT with its register attributes) has loaded */
  const hasRegister = () => !!state.data?.map?.dt_register;

  /** Expand the dictionary-encoded register into DT records (same shape the map and filters use) */
  function applyRegister(reg) {
    const { fields, dict, rows } = reg;
    state.data.map.dt_sample = rows.map((row) => {
      const rec = {};
      fields.forEach((f, i) => { rec[f] = dict[f] ? dict[f][row[i]] : row[i]; });
      return rec;
    });
    state.data.map.dt_register = true;
    _sampleByFeeder = null;
    _dtFeeder = null;
    _metaDtCounts = null;
  }

  /** Register DTs inside the location filters (BU / UT / feeder / DT); ownership / capacity picks only filter the map */
  function scopeDTs() {
    const sets = [["bu", state.bus], ["ut", state.uts], ["feeder", state.feeders], ["name", state.dts]]
      .filter(([, arr]) => !empty(arr))
      .map(([key, arr]) => [key, new Set(arr)]);
    const dts = state.data.map.dt_sample || [];
    return sets.length ? dts.filter((d) => sets.every(([key, set]) => set.has(d[key]))) : dts;
  }

  let _metaDtCounts = null;
  let _metaNames = new Map();
  /** Register DT count for a feeder meta row (its stored dt_count can predate feeder swaps) */
  function registerDtCount(meta) {
    if (!hasRegister()) return undefined;
    if (!_metaDtCounts) {
      /* Exact tail + voltage match only, so a short name like PTC never collects other feeders */
      _metaDtCounts = new Map();
      _metaNames = new Map();
      sampleByFeeder().forEach((rows, name) => {
        const tail = String(name).split("-").pop().trim().toLowerCase();
        const volt = guessVoltage(name);
        let hits = state.data.feeders.filter((f) => String(f.feeder).trim().toLowerCase() === tail
          && (volt === "—" || f.voltage === volt));
        if (hits.length > 1) hits = hits.filter((f) => f.new_ut);
        if (hits.length !== 1) return;
        _metaDtCounts.set(hits[0], (_metaDtCounts.get(hits[0]) || 0) + rows.length);
        _metaNames.set(hits[0], (_metaNames.get(hits[0]) || []).concat(name));
      });
    }
    return _metaDtCounts.get(meta);
  }

  /** Register feeder names for a feeder meta row (exact tail + voltage match) */
  function registerNamesForMeta(meta) {
    if (!hasRegister()) return [];
    registerDtCount(meta);
    return _metaNames.get(meta) || [];
  }

  /** Exact DT count for a register feeder name */
  const feederDtCount = (name) => {
    const nom = state.data.nomenclature?.feeders?.find((n) => n.name === name);
    if (nom) return nom.count;
    return feederMetaFor(name).reduce((sum, f) => sum + (f.dt_count || 0), 0);
  };

  /**
   * Resolve the active filters to the BUs / UTs they cover.
   * level = finest filter applied (network → bu → ut → feeder → dt); charts whose
   * published data stops at a coarser level use these BUs / UTs and say so.
   */
  function analyticsScope() {
    const allUts = state.data.undertakings;
    const utBu = (ut) => allUts.find((u) => u.ut_name === ut)?.bu_name;
    let level = "network";
    let label = "All Business Units";
    let uts = [];
    let bus = [];
    const sample = state.data.map.dt_sample || [];
    if (!empty(state.dts)) {
      level = "dt";
      const rows = sample.filter((d) => state.dts.includes(d.name));
      uts = rows.map((d) => d.ut);
      bus = rows.map((d) => d.bu);
      label = state.dts.length === 1 ? `DT ${state.dts[0]}` : `${fmt.format(state.dts.length)} selected DTs`;
    } else if (!empty(state.feeders)) {
      level = "feeder";
      state.feeders.forEach((name) => {
        feederMetaFor(name).forEach((f) => { uts.push(f.new_ut); bus.push(f.new_bu); });
        (sampleByFeeder().get(name) || []).forEach((d) => { uts.push(d.ut); bus.push(d.bu); });
      });
      label = state.feeders.length === 1 ? `Feeder ${feederDisplayName(state.feeders[0])}` : `${state.feeders.length} selected feeders`;
    } else if (!empty(state.uts)) {
      level = "ut";
      uts = state.uts.slice();
      bus = uts.map(utBu);
      label = uts.length === 1 ? `${utDisplayName(uts[0])} UT` : `${uts.length} selected UTs`;
    } else if (!empty(state.bus)) {
      level = "bu";
      bus = state.bus.slice();
      label = bus.length === 1 ? buDisplayName(bus[0]) : `${bus.length} selected BUs`;
    }
    uts = uniq(uts).filter((u) => inSet(state.bus, utBu(u)) && (level === "ut" || inSet(state.uts, u)));
    bus = uniq(bus.concat(uts.map(utBu))).filter((b) => inSet(state.bus, b));
    if (level === "bu" || level === "network") {
      if (level === "network") bus = state.data.business_units.map((b) => b.bu_name);
      uts = allUts.filter((u) => bus.includes(u.bu_name)).map((u) => u.ut_name);
    } else if (!uts.length) {
      /* Feeder / DT not linked to a 2026 UT — fall back to the explicit BU / UT picks */
      bus = empty(state.bus) ? bus : state.bus.slice();
      uts = allUts.filter((u) => inSet(state.uts, u.ut_name) && (bus.length ? bus.includes(u.bu_name) : !empty(state.uts))).map((u) => u.ut_name);
    }
    return { level, label, bus, uts };
  }

  const scopeUtLabel = (scope) =>
    scope.uts.length === 1 ? `${utDisplayName(scope.uts[0])} UT` : `${scope.uts.length} UTs`;
  const scopeBuLabel = (scope) =>
    scope.bus.length === 1 ? buDisplayName(scope.bus[0]) : `${scope.bus.length} Business Units`;

  const filteredBUs = () => {
    const scope = analyticsScope();
    return state.data.business_units.filter((b) => scope.bus.includes(b.bu_name));
  };

  const filteredUTs = () => {
    const scope = analyticsScope();
    return state.data.undertakings.filter((u) => scope.uts.includes(u.ut_name));
  };

  /** Point-in-polygon (even-odd over every ring) for ISS / TCN counts per area */
  function pointInRings(lon, lat, rings) {
    let inside = false;
    (rings || []).forEach((ring) => {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
      }
    });
    return inside;
  }

  function stationsInScope(points, scope) {
    if (scope.level === "network") return points.length;
    const polys = scope.level === "bu"
      ? state.data.map.bu_polygons.filter((p) => scope.bus.includes(p.bu_name))
      : state.data.map.ut_polygons.filter((p) => scope.uts.includes(p.ut_name));
    return points.filter((pt) => polys.some((p) => pointInRings(pt.lon, pt.lat, p.rings))).length;
  }

  /** Show "data is coarser than your filter" notes on chart cards */
  function setScopeNote(id, text) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text || "";
    el.hidden = !text;
  }

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

  const fidelityMatch = (f) => {
    const v = Number(f.in_own_bu);
    const band = state.fidelityBand;
    if (!band) return true;
    if (band === "high") return v >= 0.95;
    if (band === "mid-high") return v >= 0.8 && v < 0.95;
    if (band === "mid") return v >= 0.5 && v < 0.8;
    if (band === "low") return v < 0.5;
    return true;
  };

  const capacityMatch = (cap, band) => {
    if (!band) return true;
    const n = Number(cap);
    if (band === "Unknown") return !Number.isFinite(n) || n <= 0;
    if (!Number.isFinite(n) || n <= 0) return false;
    if (band === "≤50") return n <= 50;
    if (band === "51–100") return n >= 51 && n <= 100;
    if (band === "101–200") return n >= 101 && n <= 200;
    if (band === "201–300") return n >= 201 && n <= 300;
    if (band === "301–500") return n >= 301 && n <= 500;
    if (band === ">500") return n > 500;
    return true;
  };

  /** Title-case BU short code → "Ikeja Business Unit" */
  const buDisplayName = (code) => {
    if (!code) return "—";
    const title = String(code)
      .toLowerCase()
      .replace(/\b([a-z])/g, (m) => m.toUpperCase());
    return `${title} Business Unit`;
  };

  const utDisplayName = (name) => {
    if (!name) return "—";
    return String(name)
      .toLowerCase()
      .replace(/\b([a-z])/g, (m) => m.toUpperCase());
  };

  const lookupBu = (code) =>
    state.data?.business_units?.find((b) => b.bu_name === code) || null;
  const lookupUt = (name) =>
    state.data?.undertakings?.find((u) => u.ut_name === name) || null;

  const popupOpts = { maxWidth: 360, className: "ikedc-map-popup" };

  function buPopupHtml(polyOrRow) {
    const code = polyOrRow?.bu_name || "";
    const row = lookupBu(code) || polyOrRow || {};
    const area = Number(row.area_km2);
    const dts = Number(row.dt_total ?? polyOrRow?.dt_total ?? 0);
    const dens = Number.isFinite(area) && area > 0
      ? (row.dt_per_km2 ?? +(dts / area).toFixed(1))
      : null;
    return `
      <div class="map-popup">
        <div class="map-popup-kicker">Business Unit · 2026</div>
        <strong class="map-popup-title">${buDisplayName(code)}</strong>
        <dl class="map-popup-dl">
          <div><dt>Undertakings</dt><dd>${fmt.format(row.ut_count ?? "—")}</dd></div>
          <div><dt>Distribution transformers</dt><dd>${fmt.format(dts)} total<br>${fmt.format(row.dt_public ?? 0)} public · ${fmt.format(row.dt_private ?? 0)} private</dd></div>
          <div><dt>Service area</dt><dd>${Number.isFinite(area) ? `${area.toFixed(1)} km²` : "—"}</dd></div>
          <div><dt>DT density</dt><dd>${dens != null ? `${dens} DT / km²` : "—"}</dd></div>
        </dl>
      </div>`;
  }

  function utPopupHtml(poly) {
    const name = poly?.ut_name || "";
    const row = lookupUt(name) || {};
    const bu = row.bu_name || poly?.bu_name || "";
    const area = Number(row.area_km2);
    const dts = Number(row.dt_total ?? poly?.dt_total ?? 0);
    const dens = Number.isFinite(area) && area > 0
      ? (row.dt_per_km2 ?? +(dts / area).toFixed(1))
      : null;
    const agree = row.agreement_pct ?? poly?.agreement_pct;
    return `
      <div class="map-popup">
        <div class="map-popup-kicker">Undertaking · 2026</div>
        <strong class="map-popup-title">${utDisplayName(name)}</strong>
        <div class="map-popup-sub">${buDisplayName(bu)}${row.ut_code ? ` · ${row.ut_code}` : ""}</div>
        <dl class="map-popup-dl">
          <div><dt>Distribution transformers</dt><dd>${fmt.format(dts)} total<br>${fmt.format(row.dt_public ?? 0)} public · ${fmt.format(row.dt_private ?? 0)} private</dd></div>
          <div><dt>Inside UT boundary</dt><dd>${row.dt_inside != null ? fmt.format(row.dt_inside) : "—"}</dd></div>
          <div><dt>Service area</dt><dd>${Number.isFinite(area) ? `${area.toFixed(1)} km²` : "—"}</dd></div>
          <div><dt>DT density</dt><dd>${dens != null ? `${dens} DT / km²` : "—"}</dd></div>
          <div><dt>Boundary agreement</dt><dd>${agree != null ? `${Number(agree).toFixed(1)}%` : "—"}</dd></div>
          ${row.from_old_uts ? `<div class="map-popup-wide"><dt>Legacy UT mix</dt><dd>${row.from_old_uts}</dd></div>` : ""}
        </dl>
      </div>`;
  }

  function feederPopupHtml(p) {
    const display = feederDisplayName(p.feeder, p.voltage);
    const kv = String(p.voltage || "").includes("33") ? "33 kV" : (String(p.voltage || "").includes("11") ? "11 kV" : (p.voltage || "—"));
    return `
      <div class="map-popup">
        <div class="map-popup-kicker">MV Feeder · ${kv}</div>
        <strong class="map-popup-title">${display}</strong>
        <dl class="map-popup-dl">
          <div><dt>Business Unit</dt><dd>${buDisplayName(p.new_bu || p.bu)}</dd></div>
          <div><dt>Undertaking</dt><dd>${utDisplayName(p.new_ut || p.ut)}</dd></div>
          <div><dt>Distribution transformers</dt><dd>${fmt.format(p.dt_count || 0)}</dd></div>
          <div><dt>Corridor length</dt><dd>${Number(p.len_km || 0).toFixed(1)} km</dd></div>
          ${p.in_own_bu != null ? `<div><dt>In-own BU fidelity</dt><dd>${pct(Number(p.in_own_bu) * (Number(p.in_own_bu) <= 1 ? 100 : 1))}</dd></div>` : ""}
        </dl>
      </div>`;
  }

  function dtPopupHtml(p) {
    const priv = isPrivateOwn(p.own);
    return `
      <div class="map-popup">
        <div class="map-popup-kicker">Distribution Transformer · ${priv ? "Private" : "Public"}</div>
        <strong class="map-popup-title">${p.name || "Unnamed DT"}</strong>
        <dl class="map-popup-dl">
          <div><dt>Ownership</dt><dd>${priv ? "Private" : "Public"}</dd></div>
          <div><dt>Feeder</dt><dd>${feederDisplayName(p.feeder)}</dd></div>
          <div><dt>Business Unit</dt><dd>${buDisplayName(p.bu)}</dd></div>
          <div><dt>Undertaking</dt><dd>${utDisplayName(p.ut)}</dd></div>
          ${p.cap != null ? `<div><dt>Capacity</dt><dd>${p.cap} kVA</dd></div>` : ""}
          ${p.conn ? `<div><dt>Connection</dt><dd>${utDisplayName(p.conn)}</dd></div>` : ""}
          ${p.meter ? `<div><dt>Metering</dt><dd>${utDisplayName(p.meter)}</dd></div>` : ""}
          ${p.install || p.install_pos ? `<div><dt>Install position</dt><dd>${p.install || p.install_pos}</dd></div>` : ""}
        </dl>
      </div>`;
  }

  function issPopupHtml(p) {
    return `
      <div class="map-popup">
        <div class="map-popup-kicker">Injection Substation (ISS)</div>
        <strong class="map-popup-title">${p.name || "ISS"}</strong>
        <dl class="map-popup-dl">
          ${p.bu ? `<div><dt>Business Unit</dt><dd>${buDisplayName(p.bu)}</dd></div>` : ""}
          ${p.ut ? `<div><dt>Undertaking</dt><dd>${utDisplayName(p.ut)}</dd></div>` : ""}
          ${p.voltage ? `<div><dt>Voltage</dt><dd>${p.voltage}</dd></div>` : ""}
        </dl>
      </div>`;
  }

  function tcnPopupHtml(p) {
    return `
      <div class="map-popup">
        <div class="map-popup-kicker">TCN Station</div>
        <strong class="map-popup-title">${p.name || "TCN"}</strong>
        <dl class="map-popup-dl">
          ${p.voltage ? `<div><dt>Voltage</dt><dd>${p.voltage}</dd></div>` : ""}
          <div><dt>Role</dt><dd>Transmission interface</dd></div>
        </dl>
      </div>`;
  }

  let _feederNomIndex = null;
  function feederNomIndex() {
    if (_feederNomIndex) return _feederNomIndex;
    const byTail = new Map();
    const byFull = new Map();
    for (const n of state.data?.nomenclature?.feeders || []) {
      const full = String(n.name || "");
      if (!full) continue;
      byFull.set(full.toLowerCase(), full);
      const parts = full.split("-");
      const tail = (parts[parts.length - 1] || "").trim().toLowerCase();
      if (tail && !byTail.has(tail)) byTail.set(tail, full);
    }
    _feederNomIndex = { byTail, byFull };
    return _feederNomIndex;
  }

  /** Resolve short feeder meta name to full official nomenclature when available */
  const feederDisplayName = (shortOrFull, voltage) => {
    if (!shortOrFull) return "—";
    const s = String(shortOrFull);
    const idx = feederNomIndex();
    const fullHit = idx.byFull.get(s.toLowerCase());
    if (fullHit) return fullHit;
    const tailHit = idx.byTail.get(s.toLowerCase());
    if (tailHit) return tailHit;
    if (voltage && !/^\d{2}-/i.test(s)) {
      const v = String(voltage).replace(/\s*kV/i, "");
      return `${v}-${s}`;
    }
    return s;
  };

  const filteredFeedersMeta = () => {
    let rows = state.data.feeders.slice();
    if (!empty(state.bus)) rows = rows.filter((f) => state.bus.includes(f.new_bu));
    if (!empty(state.uts)) rows = rows.filter((f) => state.uts.includes(f.new_ut));
    if (!empty(state.feeders)) {
      const hits = new Set(state.feeders.flatMap(feederMetaFor));
      rows = rows.filter((f) => hits.has(f));
    }
    if (!empty(state.dts)) {
      /* Feeders that supply the selected DTs */
      const names = uniq((state.data.map.dt_sample || []).filter((d) => state.dts.includes(d.name)).map((d) => d.feeder));
      const hits = new Set(names.flatMap(feederMetaFor));
      rows = rows.filter((f) => hits.has(f));
    }
    if (state.fidelityBand) rows = rows.filter(fidelityMatch);
    return rows;
  };

  const filteredDTs = () => {
    let dts = state.data.map.dt_sample || [];
    if (!empty(state.bus)) dts = dts.filter((d) => state.bus.includes(d.bu));
    if (!empty(state.uts)) dts = dts.filter((d) => state.uts.includes(d.ut));
    if (!empty(state.feeders)) dts = dts.filter((d) => state.feeders.includes(d.feeder));
    if (!empty(state.dts)) dts = dts.filter((d) => state.dts.includes(d.name));
    if (state.dtOwn) {
      const own = String(state.dtOwn).toUpperCase();
      dts = dts.filter((d) => String(d.own || "").toUpperCase().includes(own));
    }
    if (state.installPos && dts.some((d) => d.install || d.install_pos || d.position)) {
      const pos = String(state.installPos).toLowerCase().replace(/ mounted$/, "");
      dts = dts.filter((d) => String(d.install || d.install_pos || d.position || "").toLowerCase().includes(pos));
    }
    if (state.capacityBand) {
      dts = dts.filter((d) => capacityMatch(d.cap, state.capacityBand));
    }
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
      const fontSize = cfg.fontSize || (isRound ? 12 : 12);

      const drawLabel = (text, x, y, baseline = "bottom") => {
        ctx.save();
        ctx.font = `700 ${fontSize}px 'IBM Plex Sans', system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = baseline;
        ctx.lineJoin = "round";
        ctx.miterLimit = 2;
        ctx.lineWidth = Math.max(4, Math.round(fontSize / 2.6));
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
            if (end - start < 0.18) return;
            const mid = (start + end) / 2;
            const r = el.innerRadius + (el.outerRadius - el.innerRadius) * 0.62;
            drawLabel(text, el.x + Math.cos(mid) * r, el.y + Math.sin(mid) * r, "middle");
            return;
          }

          const props = el.getProps(["x", "y", "base", "width", "height"], true);
          const barH = Math.abs((props.base ?? props.y) - props.y);
          if (stacked) {
            if (barH < 16) return;
            const midY = ((props.base ?? props.y) + props.y) / 2;
            drawLabel(text, props.x, midY, "middle");
          } else {
            if (barH < 4 && Number(raw) === 0) return;
            const above = props.y < (props.base ?? props.y);
            drawLabel(text, props.x, above ? props.y - 5 : props.y + 12, above ? "bottom" : "top");
          }
        });
      });
    },
  };
  if (typeof Chart !== "undefined" && !window.__ikedcValueLabels) {
    Chart.register(valueLabelsPlugin);
    window.__ikedcValueLabels = true;
  }

  function applyBuFilterFromLabel(label) {
    if (!label || !state.data) return false;
    const text = String(label);
    const buNames = state.data.business_units.map((b) => b.bu_name);
    const utHit = state.data.undertakings.find((u) => u.ut_name === text);
    if (utHit) {
      if (state.uts.length === 1 && state.uts[0] === utHit.ut_name) {
        state.uts = [];
        state.bus = [];
      } else {
        state.uts = [utHit.ut_name];
        state.bus = [utHit.bu_name];
      }
      state.feeders = [];
      state.dts = [];
      refreshAll({ zoom: true });
      if (state.uts.length) setStatus(`Filtered · UT: ${state.uts[0]} (${state.bus[0] || ""})`);
      else setStatus("UT chart filter cleared");
      return true;
    }
    const hit = buNames.find((n) => n === text || text.toUpperCase() === n);
    if (!hit) return false;
    if (state.bus.length === 1 && state.bus[0] === hit) {
      state.bus = [];
      state.uts = [];
    } else {
      state.bus = [hit];
      state.uts = [];
    }
    state.feeders = [];
    state.dts = [];
    refreshAll({ zoom: true });
    if (state.uts.length) setStatus(`Filtered · UT: ${state.uts[0]} (${state.bus[0] || ""})`);
    else if (state.bus.length) setStatus(`Filtered · ${buDisplayName(state.bus[0])}`);
    else setStatus("BU / UT chart filter cleared");
    return true;
  }

  /** Phones: dense charts drop per-bar values (tooltips keep them) and axis names rotate instead of colliding */
  function phoneScales(scales, count) {
    if (!window.matchMedia("(max-width: 600px)").matches || !scales?.x) return scales;
    const ticks = { ...(scales.x.ticks || {}), autoSkip: false, maxRotation: 60, minRotation: count > 4 ? 40 : 0, font: { size: count > 12 ? 10 : 11 } };
    return { ...scales, x: { ...scales.x, ticks } };
  }
  const denseOnPhone = (count) => count > 8 && window.matchMedia("(max-width: 600px)").matches;

  function barChart(key, canvasId, labels, datasets, opts = {}) {
    destroyChart(key);
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const showLabels = opts.valueLabels !== false && !denseOnPhone(labels.length);
    state.charts[key] = new Chart(ctx, {
      type: opts.type || "bar",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        onClick: (evt, elems) => {
          if (opts.onClick) return opts.onClick(evt, elems, state.charts[key]);
          if (!elems.length) return;
          const label = labels[elems[0].index];
          if (opts.filterBu !== false) applyBuFilterFromLabel(label);
        },
        layout: { padding: { top: showLabels && !opts.stacked ? 20 : 8, right: 4, left: 4 } },
        plugins: {
          legend: { display: opts.legend !== false, position: "bottom", labels: { boxWidth: 12 } },
          tooltip: { mode: "index", intersect: false },
          valueLabels: {
            display: showLabels,
            decimals: opts.labelDecimals ?? 1,
            suffix: opts.labelSuffix || "",
            fontSize: opts.labelFontSize || 12,
          },
        },
        scales: phoneScales(opts.scales || {
          x: { stacked: !!opts.stacked, grid: { display: false } },
          y: { stacked: !!opts.stacked, beginAtZero: true, ticks: { callback: (v) => fmt.format(v) } },
        }, labels.length),
      },
    });
  }

  function doughnut(key, canvasId, labels, values, colors, opts = {}) {
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
        onClick: (evt, elems) => {
          if (opts.onClick) return opts.onClick(evt, elems, state.charts[key]);
          if (!elems.length) return;
          applyBuFilterFromLabel(labels[elems[0].index]);
        },
        plugins: {
          legend: { position: "bottom", labels: { color: chartTheme().text, boxWidth: 10 } },
          valueLabels: { display: true, decimals: 0, fontSize: 12 },
        },
        cutout: "58%",
      },
    });
  }

  /**
   * One set of figures for the active filters. The KPI strip, Summary view and
   * Story map all read this, so every view shows the same numbers.
   */
  function scopeSummary() {
    const k = state.data.kpis;
    const scope = analyticsScope();
    const uts = filteredUTs();
    const sumUts = (key) => uts.reduce((acc, u) => acc + (u[key] || 0), 0);

    let dtTotal = k.dt_total;
    let dtPublic = k.dt_public;
    let dtPrivate = k.dt_private;
    if (hasRegister() && scope.level !== "network") {
      const rows = scopeDTs();
      dtTotal = rows.length;
      dtPrivate = rows.filter((d) => isPrivateOwn(d.own)).length;
      dtPublic = dtTotal - dtPrivate;
    } else if (scope.level === "bu" || scope.level === "ut") {
      dtTotal = sumUts("dt_total");
      dtPublic = sumUts("dt_public");
      dtPrivate = sumUts("dt_private");
    } else if (scope.level === "feeder") {
      dtTotal = state.feeders.reduce((acc, name) => acc + feederDtCount(name), 0);
      dtPublic = null;
      dtPrivate = null;
    } else if (scope.level === "dt") {
      const rows = (state.data.map.dt_sample || []).filter((d) => state.dts.includes(d.name));
      dtTotal = state.dts.length;
      dtPrivate = rows.filter((d) => isPrivateOwn(d.own)).length;
      dtPublic = rows.length - dtPrivate;
    }
    const dtHint = dtPublic == null
      ? "on selected feeder(s) · ownership split not recorded per feeder"
      : `${fmt.format(dtPublic)} public · ${fmt.format(dtPrivate)} private`;

    const meanAgree = uts.length
      ? uts.reduce((acc, u) => acc + u.agreement_pct, 0) / uts.length
      : 0;

    const feederRows = filteredFeedersMeta();
    const dtFeeders = uniq((state.data.map.dt_sample || []).filter((d) => state.dts.includes(d.name)).map((d) => d.feeder));
    const feederCount = scope.level === "network" && !state.fidelityBand
      ? k.feeders_total
      : (scope.level === "feeder" ? state.feeders.length : scope.level === "dt" ? dtFeeders.length : feederRows.length);
    const feederVolts = scope.level === "network" && !state.fidelityBand
      ? { kv11: k.feeders_11kv, kv33: k.feeders_33kv }
      : scope.level === "feeder" || scope.level === "dt"
        ? ((names) => ({ kv11: names.filter((f) => guessVoltage(f) === "11kV").length, kv33: names.filter((f) => guessVoltage(f) === "33kV").length }))(scope.level === "dt" ? dtFeeders : state.feeders)
        : { kv11: feederRows.filter((f) => f.voltage === "11kV").length, kv33: feederRows.filter((f) => f.voltage === "33kV").length };

    /* Moved BU = old register BU differs from NEW_BU_2026 */
    const moved = hasRegister()
      ? scopeDTs().filter((d) => d.old_bu && d.old_bu !== d.bu).length
      : (state.data.dt_analytics.reassignments || []).reduce((acc, r) => acc + r.count, 0);

    return {
      level: scope.level,
      label: scope.level === "network" ? "All Business Units" : scope.label,
      bus: scope.bus,
      uts: scope.uts,
      buCount: scope.level === "network" ? k.bu_2026 : scope.bus.length,
      utCount: uts.length,
      dtTotal,
      dtPublic,
      dtPrivate,
      dtHint,
      meanAgree,
      feederCount,
      feeders11: feederVolts.kv11,
      feeders33: feederVolts.kv33,
      areaKm2: uts.reduce((acc, u) => acc + (u.area_km2 || 0), 0),
      utDtTotal: sumUts("dt_total"),
      moved,
      iss: stationsInScope(state.data.map.iss || [], scope),
      tcn: stationsInScope(state.data.map.tcn || [], scope),
      areaHint: scope.level === "network" ? null : `inside ${scope.level === "bu" ? scopeBuLabel(scope) : scopeUtLabel(scope)}`,
    };
  }

  function renderKPIs() {
    const k = state.data.kpis;
    const sum = scopeSummary();
    const scope = analyticsScope();

    const items = [
      { label: "Distribution transformers", value: fmt.format(sum.dtTotal), hint: sum.dtHint, open: "dt" },
      { label: "Business Units", value: sum.buCount, hint: scope.level === "network" ? `from ${k.bu_existing} previous` : scope.bus.join(", ") || "—", open: "bu" },
      { label: "Undertakings", value: sum.utCount, hint: scope.level === "network" ? `from ${k.ut_existing} previous` : (scope.level === "bu" ? "in selected BU(s)" : scope.uts.join(", ") || "—"), open: "ut" },
      { label: "Mean register agreement", value: pct(sum.meanAgree), hint: scope.level === "feeder" || scope.level === "dt" ? `DT register vs polygon · ${scopeUtLabel(scope)}` : "DT register vs 2026 UT polygon" },
      { label: "Feeders", value: fmt.format(sum.feederCount), hint: `${sum.feeders11 || "—"} × 11 kV · ${sum.feeders33 || "—"} × 33 kV`, open: "feeder" },
      { label: "Injection substations", value: sum.iss, hint: sum.areaHint || `${fmt.format(k.loads_33kv)} 33 kV loads in TOC` },
      { label: "TCN stations", value: sum.tcn, hint: sum.areaHint || "transmission stations" },
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
    /* Count only the DTs inside the active filters (e.g. one feeder's DTs in its UT), not the whole UT */
    const inFilter = {};
    if (hasRegister()) {
      scopeDTs().forEach((d) => {
        const c = inFilter[d.ut] || (inFilter[d.ut] = { total: 0, priv: 0 });
        c.total += 1;
        if (isPrivateOwn(d.own)) c.priv += 1;
      });
    }
    const counts = (u) => {
      const c = inFilter[u.ut_name];
      if (!hasRegister()) return { total: u.dt_total, pub: u.dt_public, priv: u.dt_private };
      return { total: c?.total || 0, pub: (c?.total || 0) - (c?.priv || 0), priv: c?.priv || 0 };
    };
    const rows = filteredUTs().slice().sort((a, b) => counts(b).total - counts(a).total || b.dt_total - a.dt_total);
    tbody.innerHTML = rows
      .map((u) => {
        const c = counts(u);
        const ofUt = c.total !== u.dt_total ? ` <span class="cell-sub">of ${fmt.format(u.dt_total)}</span>` : "";
        return `<tr data-ut="${u.ut_name}" data-bu="${u.bu_name}" class="${state.uts.includes(u.ut_name) ? "active" : ""}">
        <td>${u.ut_name}</td>
        <td><span class="legend-swatch" style="background:${u.bu_hex || buColor(u.bu_name)}"></span>${u.bu_name}</td>
        <td>${fmt.format(c.total)}${ofUt}</td>
        <td>${fmt.format(c.pub)} / ${fmt.format(c.priv)}</td>
        <td>${pct(u.agreement_pct)}</td>
        <td>${u.area_km2.toFixed(1)}</td>
      </tr>`;
      })
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
      .map((f) => {
        const fullName = feederDisplayName(f.name, f.voltage);
        return `<tr data-feeder="${encodeURIComponent(f.name)}" data-bu="${f.bu.split(",")[0].trim()}" class="${state.feeders.includes(f.name) ? "active" : ""}">
        <td class="feeder-name-cell" title="${fullName}">${fullName}</td>
        <td>${String(f.voltage).replace("kV", "")}</td>
        <td>${f.bu}</td>
        <td>${f.ut}</td>
        <td>${fmt.format(f.dts)}</td>
        <td>${Number(f.len_km).toFixed(1)}</td>
        <td>${pct(Number(f.in_own_bu) * (Number(f.in_own_bu) <= 1 ? 100 : 1))}</td>
        <td>${pct(Number(f.in_own_ut) * (Number(f.in_own_ut) <= 1 ? 100 : 1))}</td>
      </tr>`;
      })
      .join("");
    tbody.querySelectorAll("tr[data-feeder]").forEach((tr) => {
      tr.addEventListener("click", () => {
        const name = decodeURIComponent(tr.dataset.feeder || "");
        const bu = tr.dataset.bu;
        if (state.feeders.length === 1 && state.feeders[0] === name) {
          state.feeders = [];
        } else {
          state.feeders = [name];
          if (bu && bu !== "—") state.bus = [bu];
        }
        state.dts = [];
        refreshAll({ zoom: true });
      });
    });
  }

  /** Merge register spellings (POLE / Pole Mounted, GROUND / GROUND MOUNTED, NIL …) into one class */
  function normaliseClass(field, raw) {
    const v = String(raw || "").trim().toUpperCase();
    if (!v || v === "UNKNOWN" || v === "NIL" || v === "N/A") return "Unknown";
    if (field === "install_pos") {
      if (v.startsWith("POLE")) return "POLE MOUNTED";
      if (v.startsWith("GROUND")) return "GROUND MOUNTED";
      return "Unknown";
    }
    return v;
  }

  /** Register class counts for the BUs in scope (published per BU only) */
  function countsFor(field, bus) {
    const merged = {};
    const add = (rows) => (rows || []).forEach((row) => {
      const name = normaliseClass(field, row.name);
      merged[name] = (merged[name] || 0) + row.count;
    });
    if (!bus || bus.length === state.data.business_units.length) add(state.data.dt_analytics.counts[field]);
    else bus.forEach((bu) => add(state.data.dt_analytics.by_bu[bu]?.[field]));
    return Object.entries(merged)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  /** Ownership per DT from the register; UT public / private totals until it loads */
  function ownershipFor(scope) {
    if (hasRegister() || scope.level === "dt") {
      const rows = hasRegister() ? scopeDTs() : (state.data.map.dt_sample || []).filter((d) => state.dts.includes(d.name));
      const merged = {};
      rows.forEach((d) => {
        const name = normaliseClass("ownership", d.own);
        merged[name] = (merged[name] || 0) + 1;
      });
      return { rows: Object.entries(merged).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count), note: "" };
    }
    /* Same public / private totals as the KPI strip and UT table, so every view adds up */
    const uts = filteredUTs();
    const rows = [
      { name: "PUBLIC", count: uts.reduce((acc, u) => acc + u.dt_public, 0) },
      { name: "PRIVATE", count: uts.reduce((acc, u) => acc + u.dt_private, 0) },
    ];
    const note = scope.level === "feeder"
      ? `Ownership isn't recorded per feeder in the published register — showing ${scopeUtLabel(scope)} served by the selection.`
      : "";
    return { rows, note };
  }

  const OWN_COLORS = { PUBLIC: "#1f6fb2", PRIVATE: "#c8452c", "PRIVATE MULTIPLE": "#6b7c90", "PRIVATE-PUBLIC": "#7a4fb5", Unknown: "#a3adb8" };
  const INSTALL_COLORS = { "POLE MOUNTED": "#2e8b57", "GROUND MOUNTED": "#d99a1e", Unknown: "#a3adb8" };
  const EXTRA_COLORS = ["#7a4fb5", "#0f8b8d", "#b5487a", "#6b7c90"];
  const classColors = (rows, map) => rows.map((r, i) => map[r.name] || EXTRA_COLORS[i % EXTRA_COLORS.length]);

  function renderOverviewCharts() {
    const scope = analyticsScope();
    /* BU / network: published BU totals. UT and finer: sum the UTs in scope per BU */
    const registerRows = hasRegister() && scope.level !== "network" && scope.level !== "bu" ? scopeDTs() : null;
    const bus = scope.level === "network" || scope.level === "bu"
      ? filteredBUs()
      : registerRows
        ? filteredBUs().map((b) => {
          const rows = registerRows.filter((d) => d.bu === b.bu_name);
          const priv = rows.filter((d) => isPrivateOwn(d.own)).length;
          return { bu_name: b.bu_name, dt_public: rows.length - priv, dt_private: priv };
        })
        : filteredBUs().map((b) => {
        const uts = filteredUTs().filter((u) => u.bu_name === b.bu_name);
        return {
          bu_name: b.bu_name,
          dt_public: uts.reduce((acc, u) => acc + u.dt_public, 0),
          dt_private: uts.reduce((acc, u) => acc + u.dt_private, 0),
        };
      });
    barChart("buDt", "chart-bu-dt", bus.map((b) => b.bu_name), [
      { label: "Public", data: bus.map((b) => b.dt_public), backgroundColor: "#1f6fb2", borderRadius: 6 },
      { label: "Private", data: bus.map((b) => b.dt_private), backgroundColor: "#c8452c", borderRadius: 6 },
    ], { stacked: true, labelDecimals: 0 });
    setScopeNote("scope-workload",
      registerRows ? `${scope.label} only`
        : scope.level === "ut" ? `${scopeUtLabel(scope)} only`
        : scope.level === "feeder" ? `Ownership isn't recorded per feeder — showing ${scopeUtLabel(scope)} served by the selection`
          : scope.level === "dt" ? `UT(s) of the selected DT(s): ${scopeUtLabel(scope)}` : "");

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

    const scope = analyticsScope();
    /* UT and finer filters: per-UT density (published per UT) instead of the parent BU */
    const dens = scope.level === "network" || scope.level === "bu"
      ? bus.map((b) => ({
        name: b.bu_name,
        value: b.dt_per_km2 ?? (b.area_km2 ? +(b.dt_total / b.area_km2).toFixed(1) : 0),
        fill: b.fill_hex,
      }))
      : filteredUTs().slice().sort((a, b) => b.dt_per_km2 - a.dt_per_km2).slice(0, 18).map((u) => ({
        name: u.ut_name,
        value: u.dt_per_km2 ?? (u.area_km2 ? +(u.dt_total / u.area_km2).toFixed(1) : 0),
        fill: u.fill_hex || buColor(u.bu_name),
      }));
    setScopeNote("scope-density", scope.level === "network" || scope.level === "bu" ? "" : `Per Undertaking · ${scopeUtLabel(scope)}`);
    barChart("dens", "chart-density", dens.map((d) => d.name), [
      { label: "DTs / km²", data: dens.map((d) => d.value), backgroundColor: dens.map((d) => d.fill || buColor(d.name)), borderRadius: 6 },
    ], { legend: false, valueLabels: true, labelDecimals: 1 });

    const ownership = ownershipFor(scope);
    const own = ownership.rows.filter((d) => d.count > 0);
    doughnut("own", "chart-ownership", own.map((d) => d.name), own.map((d) => d.count), classColors(own, OWN_COLORS), {
      onClick: (_e, elems) => {
        if (!elems.length) return;
        const label = own[elems[0].index]?.name;
        state.dtOwn = state.dtOwn === label ? null : label;
        state.dts = [];
        refreshAll({ zoom: true });
        setStatus(state.dtOwn ? `Filtered DTs · ownership: ${state.dtOwn}` : "Ownership filter cleared");
      },
    });
    const install = countsFor("install_pos", scope.bus).filter((d) => d.count > 0);
    const installNote = scope.level === "network" || scope.level === "bu"
      ? ""
      : `Install position is published per Business Unit only — right chart shows ${scopeBuLabel(scope)}.`;
    const ownTotal = own.reduce((acc, d) => acc + d.count, 0);
    setScopeNote("scope-ownership-label", `${scope.level === "feeder" && !hasRegister() ? scopeUtLabel(scope) : scope.label} · ${fmt.format(ownTotal)} DTs`);
    setScopeNote("scope-ownership", [ownership.note, installNote].filter(Boolean).join(" "));
    doughnut("install", "chart-install", install.map((d) => d.name), install.map((d) => d.count), classColors(install, INSTALL_COLORS), {
      onClick: (_e, elems) => {
        if (!elems.length) return;
        const label = install[elems[0].index]?.name;
        state.installPos = state.installPos === label ? null : label;
        state.dts = [];
        refreshAll({ zoom: true });
        setStatus(state.installPos ? `Filtered DTs · install: ${state.installPos}` : "Install-position filter cleared");
      },
    });

    let re = state.data.dt_analytics.reassignments || [];
    if (hasRegister()) {
      /* Old register BU → NEW_BU_2026 for exactly the DTs in the filter */
      const flows = {};
      scopeDTs().forEach((d) => {
        if (!d.old_bu || d.old_bu === d.bu) return;
        const key = `${d.old_bu} → ${d.bu}`;
        flows[key] = (flows[key] || 0) + 1;
      });
      re = Object.entries(flows).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    } else if (scope.level !== "network") re = re.filter((r) => scope.bus.some((b) => r.name.includes(b)));
    re = re.slice(0, 12);
    setScopeNote("scope-reassign",
      scope.level === "network" || scope.level === "bu" ? ""
        : hasRegister() ? (re.length ? "" : `No DTs in ${scope.label} changed BU.`)
        : re.length ? `Reassignments are published per BU flow — showing flows touching ${scopeBuLabel(scope)}.` : `No BU reassignments touch ${scopeBuLabel(scope)}.`);
    barChart("re", "chart-reassign", re.map((r) => r.name), [
      { label: "DTs moved", data: re.map((r) => r.count), backgroundColor: "#c8452c", borderRadius: 5 },
    ], {
      legend: false,
      labelDecimals: 0,
      filterBu: false,
      onClick: (_e, elems) => {
        if (!elems.length) return;
        const name = re[elems[0].index]?.name || "";
        const buHit = state.data.business_units.find((b) => name.toUpperCase().includes(b.bu_name));
        if (buHit) applyBuFilterFromLabel(buHit.bu_name);
        else setStatus(`Reassignment flow: ${name}`);
      },
      scales: {
        x: { ticks: { maxRotation: 45, minRotation: 30, font: { size: 9 } }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { callback: (v) => fmt.format(v) } },
      },
    });

    const binsOrder = ["≤50", "51–100", "101–200", "201–300", "301–500", ">500", "Unknown"];
    let bins = (state.data.dt_analytics.capacity.bins || []).slice();
    if (hasRegister() || scope.level === "dt") {
      /* Every register DT carries its own kVA rating */
      const rows = hasRegister() ? scopeDTs() : (state.data.map.dt_sample || []).filter((d) => state.dts.includes(d.name));
      bins = binsOrder
        .map((name) => ({ name, count: rows.filter((d) => capacityMatch(d.cap, name)).length }))
        .filter((b) => b.count > 0);
    }
    bins.sort((a, b) => binsOrder.indexOf(a.name) - binsOrder.indexOf(b.name));
    setScopeNote("scope-capacity",
      scope.level === "network" || scope.level === "dt" || hasRegister() ? ""
        : `Capacity classes are published network-wide only — showing all ${fmt.format(state.data.kpis.dt_total)} DTs, not ${scope.label}.`);
    barChart("cap", "chart-capacity", bins.map((b) => b.name), [
      { label: "DTs", data: bins.map((b) => b.count), backgroundColor: "#d99a1e", borderRadius: 6 },
    ], {
      legend: false,
      labelDecimals: 0,
      filterBu: false,
      onClick: (_e, elems) => {
        if (!elems.length) return;
        const label = bins[elems[0].index]?.name;
        if (!label) return;
        state.capacityBand = state.capacityBand === label ? null : label;
        state.dts = [];
        refreshAll({ zoom: true });
        setStatus(state.capacityBand ? `Filtered DTs · capacity: ${state.capacityBand}` : "Capacity filter cleared");
      },
    });

    state.rendered.assets = true;
  }

  function renderFeederCharts() {
    let byBu;
    if (empty(state.uts) && empty(state.feeders) && empty(state.dts) && !state.fidelityBand) {
      byBu = empty(state.bus)
        ? state.data.feeders_by_bu
        : state.data.feeders_by_bu.filter((r) => state.bus.includes(r.bu_name));
    } else {
      /* UT / feeder / fidelity filters: count the matching feeders per BU */
      const grouped = {};
      filteredFeedersMeta().forEach((f) => {
        const bu = f.new_bu || "Unassigned (no DTs linked)";
        if (!grouped[bu]) grouped[bu] = { bu_name: bu, feeder_count: 0, len_km: 0 };
        grouped[bu].feeder_count += 1;
        grouped[bu].len_km += Number(f.len_km) || 0;
      });
      byBu = Object.values(grouped).sort((a, b) => b.feeder_count - a.feeder_count);
    }

    /* Feeders with no DTs linked have no 2026 BU: show them on two lines and don't treat a click as a BU filter */
    const isUnassigned = (name) => !name || name === "Unknown" || name.startsWith("Unassigned");
    barChart("fbu", "chart-feeder-bu", byBu.map((r) => (isUnassigned(r.bu_name) ? ["Unassigned", "(no DTs linked)"] : r.bu_name)), [
      { label: "Feeders", data: byBu.map((r) => r.feeder_count), backgroundColor: "#1f6fb2", borderRadius: 6 },
      { label: "Length (km)", data: byBu.map((r) => Math.round(r.len_km)), backgroundColor: "#d99a1e", borderRadius: 6 },
    ], {
      labelDecimals: 0,
      scales: {
        x: { grid: { display: false }, ticks: { maxRotation: 0, minRotation: 0, autoSkip: false, font: { size: 11 } } },
        y: { beginAtZero: true, ticks: { callback: (v) => fmt.format(v) } },
      },
      onClick: (_evt, elems) => {
        if (!elems.length) return;
        const row = byBu[elems[0].index];
        if (row && !isUnassigned(row.bu_name)) applyBuFilterFromLabel(row.bu_name);
      },
    });

    const sample = filteredFeedersMeta().slice(0, 180);
    const toPts = (rows) => rows.map((f) => ({
      x: f.len_km, y: registerDtCount(f) ?? f.dt_count, feeder: f.feeder, bu: f.new_bu, ut: f.new_ut,
    }));
    destroyChart("scatter");
    state.charts.scatter = new Chart(document.getElementById("chart-feeder-scatter"), {
      type: "scatter",
      data: {
        datasets: [
          {
            label: "11 kV",
            data: toPts(sample.filter((f) => f.voltage === "11kV")),
            backgroundColor: "rgba(31,111,178,0.75)",
          },
          {
            label: "33 kV",
            data: toPts(sample.filter((f) => f.voltage === "33kV")),
            backgroundColor: "rgba(200,69,44,0.8)",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        onClick: (_evt, elems) => {
          if (!elems.length) return;
          const el = elems[0];
          const pt = state.charts.scatter.data.datasets[el.datasetIndex].data[el.index];
          if (!pt?.feeder) return;
          if (state.feeders.length === 1 && state.feeders[0] === pt.feeder) {
            state.feeders = [];
          } else {
            state.feeders = [pt.feeder];
            if (pt.bu) state.bus = [pt.bu];
            if (pt.ut) state.uts = [pt.ut];
          }
          state.dts = [];
          refreshAll({ zoom: true });
          setStatus(`Feeder focus · ${pt.feeder}`);
        },
        plugins: {
          legend: { position: "bottom" },
          valueLabels: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const p = ctx.raw || {};
                return `${p.feeder || "Feeder"} · ${p.x?.toFixed?.(1) ?? p.x} km · ${p.y} DTs`;
              },
            },
          },
        },
        scales: {
          x: { title: { display: true, text: "Length (km)" }, beginAtZero: true },
          y: { title: { display: true, text: "DT count" }, beginAtZero: true },
        },
      },
    });

    const fidelity = filteredFeedersMeta();
    const buckets = [
      { name: "≥95% in-own BU", count: fidelity.filter((f) => f.in_own_bu >= 0.95).length, key: "high" },
      { name: "80–95%", count: fidelity.filter((f) => f.in_own_bu >= 0.8 && f.in_own_bu < 0.95).length, key: "mid-high" },
      { name: "50–80%", count: fidelity.filter((f) => f.in_own_bu >= 0.5 && f.in_own_bu < 0.8).length, key: "mid" },
      { name: "<50%", count: fidelity.filter((f) => f.in_own_bu < 0.5).length, key: "low" },
    ];
    barChart("fid", "chart-fidelity", buckets.map((b) => b.name), [
      { label: "Feeders", data: buckets.map((b) => b.count), backgroundColor: ["#2e8b57", "#d99a1e", "#c8452c", "#6b7c90"], borderRadius: 6 },
    ], {
      legend: false,
      labelDecimals: 0,
      filterBu: false,
      onClick: (_e, elems) => {
        if (!elems.length) return;
        const key = buckets[elems[0].index]?.key;
        state.fidelityBand = state.fidelityBand === key ? null : key;
        state.feeders = [];
        refreshAll({ zoom: true });
        setStatus(state.fidelityBand ? `Fidelity band · ${buckets[elems[0].index].name}` : "Fidelity filter cleared");
      },
    });

    renderFeederTable();
    state.rendered.feeders = true;
  }

  /** Boundary rings are one polygon: the outer ring first, then any holes (Leaflet draws them as holes) */
  function ringsToLatLngs(rings) {
    return rings.map((ring) => ring.map(([lon, lat]) => [lat, lon]));
  }

  /**
   * BU / UT symbology from the 2026 KMZ exports (outline colour and width, fill opacity).
   * "dim" and "focus" vary it for maps that highlight part of the franchise.
   */
  function boundaryStyle(p, mode = "normal") {
    const base = {
      color: p.stroke || p.fill_hex,
      weight: p.stroke_width || 2,
      opacity: 1,
      fillColor: p.fill_hex,
      fillOpacity: p.fill_opacity ?? 0.4,
    };
    if (mode === "dim") return { ...base, opacity: 0.35, weight: Math.max(1, base.weight / 2), fillOpacity: base.fillOpacity * 0.25 };
    if (mode === "focus") return { ...base, weight: base.weight + 1, fillOpacity: Math.min(0.8, base.fillOpacity + 0.15) };
    return base;
  }

  const LABEL_ZOOM = { bu: 9, ut: 11 };

  function labelIcon(text, kind, color) {
    const size = kind === "bu" ? 12 : 10;
    return L.divIcon({
      className: kind === "bu" ? "map-label-bu" : "map-label-ut",
      html: `<div style="transform:translate(-50%,-50%);padding:${kind === "bu" ? "3px 9px" : "2px 6px"};border-radius:999px;font:700 ${size}px Sora,sans-serif;color:#fff;background:${color || "#334"};border:1px solid rgba(255,255,255,.35);white-space:nowrap;box-shadow:0 2px 10px rgba(0,0,0,.45);letter-spacing:0.02em">${text}</div>`,
      iconSize: [0, 0],
    });
  }

  function updateLabelVisibility() {
    if (!state.map) return;
    const z = state.map.getZoom();
    if (state.layers.buLabels) {
      if (z >= LABEL_ZOOM.bu) state.map.addLayer(state.layers.buLabels);
      else state.map.removeLayer(state.layers.buLabels);
    }
    if (state.layers.utLabels) {
      if (z >= LABEL_ZOOM.ut) state.map.addLayer(state.layers.utLabels);
      else state.map.removeLayer(state.layers.utLabels);
    }
  }

  function ensureAssetLayerGroups() {
    const keys = ["lagos", "bu", "ut", "feeders11", "feeders33", "dtsPublic", "dtsPrivate", "iss", "tcn", "buLabels", "utLabels", "uploads"];
    keys.forEach((k) => {
      if (!state.layers[k]) state.layers[k] = L.layerGroup();
    });
    if (!state.dtRenderer) state.dtRenderer = L.canvas({ padding: 0.5 });
    /* SVG renderer so CSS stroke-dashoffset animation can energize feeder paths */
    if (!state.feederRenderer) state.feederRenderer = L.svg({ padding: 0.35 });
  }

  function clearLayerGroup(group) {
    if (group) group.clearLayers();
  }

  function isOverlayOnMap(group) {
    return !!(state.map && group && state.map.hasLayer(group));
  }

  function syncOverlayOnMap(key, preferOn) {
    const group = state.layers[key];
    if (!state.map || !group) return;
    const on = preferOn == null ? isOverlayOnMap(group) : !!preferOn;
    if (on) {
      if (!state.map.hasLayer(group)) group.addTo(state.map);
    } else if (state.map.hasLayer(group)) {
      state.map.removeLayer(group);
    }
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
    /* Hidden map (filters changed from Summary / Story): fly when Operations is shown again */
    const size = state.map.getSize();
    if (!size.x || !size.y) {
      state.flyPending = true;
      return;
    }
    state.flyPending = false;
    const bounds = collectFilterBounds();
    if (bounds.length) {
      state.map.flyToBounds(bounds, { padding: [36, 36], maxZoom: 14, duration: 1.1 });
    }
  }

  function makeHybridBasemap() {
    return makeBasemaps()[DEFAULT_BASEMAP];
  }

  function setMapTheme(_theme) {
    if (!state.map) return;
    // Default remains hybrid satellite; theme no longer swaps the basemap away from imagery.
    if (!state.baseTile) {
      state.baseTile = makeHybridBasemap();
      state.baseTile.addTo(state.map);
      state.baseTile.bringToBack();
    }
  }

  /**
   * Mount Leaflet layers control into a title-area host.
   * Collapsed by default behind a "Filter Layers" toggle.
   */
  function attachTitleLayerFilter(map, bases, overlays, host, existingControl) {
    if (!map || !host) return existingControl || null;
    if (existingControl) {
      try { map.removeControl(existingControl); } catch (_) { /* ignore */ }
    }
    host.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "map-layer-filter";
    wrap.innerHTML = `
      <button type="button" class="map-layer-filter-btn" aria-expanded="false" aria-controls="">
        <span class="map-layer-filter-heading">Filter Layers</span>
        <span class="map-layer-filter-chevron" aria-hidden="true">▾</span>
      </button>
      <div class="map-layer-filter-panel" hidden></div>`;
    host.appendChild(wrap);
    const btn = wrap.querySelector(".map-layer-filter-btn");
    const panel = wrap.querySelector(".map-layer-filter-panel");
    const panelId = `map-layers-panel-${Math.random().toString(36).slice(2, 9)}`;
    panel.id = panelId;
    btn.setAttribute("aria-controls", panelId);

    const closePanel = () => {
      panel.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      wrap.classList.remove("open");
    };
    const openPanel = () => {
      panel.hidden = false;
      btn.setAttribute("aria-expanded", "true");
      wrap.classList.add("open");
    };
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (panel.hidden) openPanel();
      else closePanel();
    });
    const onDocClick = (e) => {
      if (!wrap.isConnected) {
        document.removeEventListener("click", onDocClick);
        return;
      }
      if (!wrap.contains(e.target) && !panel.hidden) closePanel();
    };
    document.addEventListener("click", onDocClick);

    const overlayLayers = Object.values(overlays || {}).filter(Boolean);
    const actions = document.createElement("div");
    actions.className = "map-layer-filter-actions";
    actions.innerHTML = `
      <button type="button" class="map-layer-filter-action" data-layers-all>Select all</button>
      <button type="button" class="map-layer-filter-action" data-layers-none>Clear all</button>`;
    panel.appendChild(actions);

    const setAllOverlays = (on) => {
      overlayLayers.forEach((layer) => {
        if (!layer || typeof map.hasLayer !== "function") return;
        if (on) {
          if (!map.hasLayer(layer)) map.addLayer(layer);
        } else if (map.hasLayer(layer)) {
          map.removeLayer(layer);
        }
      });
    };
    actions.querySelector("[data-layers-all]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      setAllOverlays(true);
    });
    actions.querySelector("[data-layers-none]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      setAllOverlays(false);
    });

    const ctrl = L.control.layers(bases, overlays, {
      position: "topright",
      collapsed: false,
    }).addTo(map);
    const box = ctrl.getContainer();
    box.classList.add("map-layer-filter-leaflet");
    /* Keep out of the map corner — live in the title dropdown */
    panel.appendChild(box);
    return ctrl;
  }

  function initMap() {
    if (state.map) return;
    state.map = L.map("map", { zoomControl: true }).setView([6.6, 3.45], 11);
    const bases = makeBasemaps();
    state.baseTile = bases[DEFAULT_BASEMAP];
    state.baseTile.addTo(state.map);
    ensureAssetLayerGroups();

    Object.keys(LAYER_DEFAULTS).forEach((key) => {
      if (LAYER_DEFAULTS[key] && state.layers[key]) state.layers[key].addTo(state.map);
    });

    state.layerControl = attachTitleLayerFilter(
      state.map,
      bases,
      {
        "Lagos boundary": state.layers.lagos,
        "Business Units": state.layers.bu,
        "Undertakings": state.layers.ut,
        "Feeders 11 kV": state.layers.feeders11,
        "Feeders 33 kV": state.layers.feeders33,
        "Public DTs": state.layers.dtsPublic,
        "Private DTs": state.layers.dtsPrivate,
        "Injection substations (ISS)": state.layers.iss,
        "TCN stations": state.layers.tcn,
        "Uploaded layers": state.layers.uploads,
      },
      document.getElementById("intel-map-layers"),
      state.layerControl
    );

    state.map.on("zoomend", updateLabelVisibility);
    state.map.on("baselayerchange", (e) => {
      state.baseTile = e.layer;
    });
    addMapTools(state.map, bases, { storageKey: "intel" });
    redrawMapLayers({ zoom: true });
  }

  function redrawMapLayers(opts = {}) {
    if (!state.map || !state.data) return;
    ensureAssetLayerGroups();

    /* Remember which overlays the user currently has checked */
    const wasOn = {};
    Object.keys(state.layers).forEach((k) => {
      wasOn[k] = isOverlayOnMap(state.layers[k]);
    });
    const firstPaint = !Object.values(wasOn).some(Boolean);

    clearLayerGroup(state.layers.lagos);
    clearLayerGroup(state.layers.bu);
    clearLayerGroup(state.layers.ut);
    clearLayerGroup(state.layers.feeders11);
    clearLayerGroup(state.layers.feeders33);
    clearLayerGroup(state.layers.dtsPublic);
    clearLayerGroup(state.layers.dtsPrivate);
    clearLayerGroup(state.layers.iss);
    clearLayerGroup(state.layers.tcn);
    clearLayerGroup(state.layers.buLabels);
    clearLayerGroup(state.layers.utLabels);
    clearLayerGroup(state.layers.uploads);

    if (state.lagos?.features?.length) {
      L.geoJSON(state.lagos, {
        style: { color: "#e8a317", weight: 2.2, fillOpacity: 0.02 },
        onEachFeature: (f, lyr) => lyr.bindPopup(`<strong>${f.properties?.name || "Lagos State"}</strong>`),
      }).addTo(state.layers.lagos);
    }

    const buPolys = state.data.map.bu_polygons.filter((b) => inSet(state.bus, b.bu_name));
    const utPolys = state.data.map.ut_polygons.filter((u) => {
      if (!inSet(state.bus, u.bu_name)) return false;
      if (!inSet(state.uts, u.ut_name)) return false;
      return true;
    });

    buPolys.forEach((b) => {
      L.polygon(ringsToLatLngs(b.rings), boundaryStyle(b))
        .bindPopup(buPopupHtml(b), popupOpts)
        .addTo(state.layers.bu);
    });

    utPolys.forEach((u) => {
      L.polygon(ringsToLatLngs(u.rings), boundaryStyle(u))
        .bindPopup(utPopupHtml(u), popupOpts)
        .addTo(state.layers.ut);
    });

    (state.feedersGeo?.features || []).forEach((feat) => {
      const p = feat.properties || {};
      if (!inSet(state.bus, p.new_bu) && p.new_bu) return;
      if (!inSet(state.uts, p.new_ut) && p.new_ut && !empty(state.uts)) return;
      if (!matchFeederLine(p.feeder, state.feeders)) return;
      const is33 = p.voltage === "33kV" || String(p.voltage || "").includes("33");
      const focusedFeeder = !empty(state.feeders) && matchFeederLine(p.feeder, state.feeders);
      const style = focusedFeeder
        ? { color: "#ff4d4d", weight: 3.6, opacity: 1, className: "feeder-line feeder-focus", lineCap: "round" }
        : (is33 ? { ...FEEDER_STYLE_33 } : { ...FEEDER_STYLE_11 });
      L.geoJSON(feat, {
        renderer: state.feederRenderer,
        style,
        onEachFeature: (_f, lyr) => {
          lyr.bindPopup(feederPopupHtml(p), popupOpts);
        },
      }).addTo(is33 ? state.layers.feeders33 : state.layers.feeders11);
    });

    const dts = filteredDTs();
    const focused = !empty(state.dts) || dts.length <= 500;
    const renderer = state.dtRenderer;
    dts.forEach((p) => {
      const priv = isPrivateOwn(p.own);
      const target = priv ? state.layers.dtsPrivate : state.layers.dtsPublic;
      /* Built on open so 20k register DTs stay cheap to draw */
      const popup = () => dtPopupHtml(p);
      if (focused && dts.length <= 800) {
        L.marker([p.lat, p.lon], { icon: dtDivIcon(p.own, !empty(state.dts)) })
          .bindPopup(popup, popupOpts)
          .addTo(target);
      } else {
        L.circleMarker([p.lat, p.lon], dtMarkerOptions(p.own, !empty(state.dts), renderer))
          .bindPopup(popup, popupOpts)
          .addTo(target);
      }
    });

    (state.data.map.iss || []).forEach((p) => {
      L.circleMarker([p.lat, p.lon], {
        radius: 5, color: "#e8a317", weight: 2, fillColor: "#e8a317", fillOpacity: 0.85,
      })
        .bindPopup(issPopupHtml(p), popupOpts)
        .addTo(state.layers.iss);
    });

    (state.data.map.tcn || []).forEach((p) => {
      L.marker([p.lat, p.lon], {
        icon: L.divIcon({
          className: "",
          html: `<div style="width:10px;height:10px;background:#fff;border:2px solid #c8452c;transform:rotate(45deg)"></div>`,
          iconSize: [10, 10],
        }),
      })
        .bindPopup(tcnPopupHtml(p), popupOpts)
        .addTo(state.layers.tcn);
    });

    ((state.labels && state.labels.bu) || []).forEach((lab) => {
      if (!inSet(state.bus, lab.name)) return;
      L.marker([lab.lat, lab.lon], { icon: labelIcon(lab.name, "bu", lab.fill), interactive: false })
        .addTo(state.layers.buLabels);
    });

    ((state.labels && state.labels.ut) || []).forEach((lab) => {
      if (!inSet(state.bus, lab.bu)) return;
      if (!inSet(state.uts, lab.name)) return;
      L.marker([lab.lat, lab.lon], { icon: labelIcon(lab.name, "ut", lab.fill), interactive: false })
        .addTo(state.layers.utLabels);
    });

    if (state.uploads.length) {
      state.uploads.forEach((fc) => {
        L.geoJSON(fc, {
          style: { color: "#e8a317", weight: 2, fillOpacity: 0.15 },
          pointToLayer: (_f, latlng) => L.circleMarker(latlng, {
            radius: 4, color: "#e8a317", fillOpacity: 0.8,
          }),
          onEachFeature: (f, lyr) => {
            const name = f.properties?.name || f.properties?.NAME || "Upload";
            lyr.bindPopup(`<strong>${name}</strong><br><em>Uploaded layer</em>`);
          },
        }).addTo(state.layers.uploads);
      });
    }

    /* Restore overlay visibility (or apply defaults on first paint) */
    Object.keys(LAYER_DEFAULTS).forEach((key) => {
      const prefer = firstPaint ? LAYER_DEFAULTS[key] : wasOn[key];
      syncOverlayOnMap(key, prefer);
    });

    updateLabelVisibility();

    const legend = document.getElementById("map-legend");
    if (legend) {
      legend.innerHTML = `
      <span><i class="legend-swatch" style="background:transparent;outline:2px solid #e8a317"></i>Lagos State</span>
      ${buPolys.map((b) => `<span><i class="legend-swatch legend-bu" style="background:${b.fill_hex};border-color:${b.stroke || "#222"}"></i>${b.bu_name}</span>`).join("")}
      <span><i class="legend-swatch legend-ut" style="background:linear-gradient(90deg,#d89880 0 50%,#801a19 50%)"></i>Undertakings (white outline)</span>
      <span><i class="legend-swatch" style="background:#5ec8ff"></i>11 kV (live)</span>
      <span><i class="legend-swatch" style="background:#ff7a3d"></i>33 kV (live)</span>
      <span><i class="legend-swatch" style="background:#3d9cf0;border-radius:50%"></i>Public DT</span>
      <span><i class="legend-swatch" style="background:#e4572e;clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)"></i>Private DT</span>
      <span><i class="legend-swatch" style="background:#e8a317"></i>ISS</span>
      <span><i class="legend-swatch" style="background:#fff;outline:2px solid #c8452c"></i>TCN</span>
      <span>Layers · checklist (top-right) · labels ≥ z${LABEL_ZOOM.bu}/${LABEL_ZOOM.ut}</span>`;
    }

    if (opts.zoom !== false) flyToSelection();
  }

  function scheduleMapRedraw(opts = {}) {
    if (state.mapRedrawRaf) cancelAnimationFrame(state.mapRedrawRaf);
    state.mapRedrawRaf = requestAnimationFrame(() => {
      state.mapRedrawRaf = 0;
      redrawMapLayers(opts);
    });
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

  /** Tell the Summary / Story views the filters (or the data behind them) changed */
  const announceFilters = () => window.dispatchEvent(new CustomEvent("ikedc:filters", { detail: getFilters() }));

  function refreshAll(opts = {}) {
    /* Charts + KPIs immediately; map rebuild on next frame so UI stays snappy */
    state.rendered = { overview: false, assets: false, feeders: false };
    renderKPIs();
    renderCompare();
    renderUTTable();
    renderActiveTabCharts(true);
    populateCombos();
    syncComboLabels();
    announceFilters();
    if (opts.mapOnly) {
      scheduleMapRedraw({ zoom: opts.zoom !== false });
      return;
    }
    scheduleMapRedraw({ zoom: opts.zoom !== false });
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
    return items.sort((a, b) => a.label.localeCompare(b.label));
  }

  const COMBO_LIST_MAX = 800;

  /** Search first, then cap the list, so every DT in the register can be found by typing */
  function visibleComboItems(kind, query) {
    const q = (query || "").trim().toLowerCase();
    let items = comboItems(kind);
    if (q) items = items.filter((i) => i.label.toLowerCase().includes(q) || i.value.toLowerCase().includes(q));
    return { items: items.slice(0, COMBO_LIST_MAX), total: items.length };
  }

  let _dtFeeder = null;
  /** Register feeder of a DT name */
  function dtFeederOf(name) {
    if (!_dtFeeder || _dtFeeder.size === 0) {
      _dtFeeder = new Map();
      (state.data.map.dt_sample || []).forEach((d) => {
        if (d.name && !_dtFeeder.has(d.name)) _dtFeeder.set(d.name, d.feeder);
      });
    }
    return _dtFeeder.get(name) || "";
  }

  /* Filter hierarchy, top → bottom: the state key and the register field each level reads */
  const FILTER_LEVELS = [
    { kind: "bu", key: "bus", field: "bu" },
    { kind: "ut", key: "uts", field: "ut" },
    { kind: "feeder", key: "feeders", field: "feeder" },
    { kind: "dt", key: "dts", field: "name" },
  ];
  /** Parent picks the cascade filled in (key → value it set); a value the user changed since is theirs */
  const autoFilled = new Map();
  const isAutoFilled = (key) => autoFilled.has(key) && autoFilled.get(key) === JSON.stringify(state[key]);

  /** Register rows (UTs map to their BU even before the register loads) */
  function rowsFor(field, values) {
    const set = new Set(values);
    if (field === "ut") {
      return state.data.undertakings.filter((u) => set.has(u.ut_name)).map((u) => ({ bu: u.bu_name, ut: u.ut_name }));
    }
    return (state.data.map.dt_sample || []).filter((d) => set.has(d[field]));
  }

  /**
   * Keep the BU → UT → feeder → DT pickers in step:
   * a pick narrows every level below it (dropping picks outside it) and fills in the
   * empty levels above it, e.g. a DT selects its own feeder, UT and BU.
   * Filled-in parents follow later picks and clear when nothing below is picked.
   */
  function cascadeSelection(kind, arr) {
    const idx = FILTER_LEVELS.findIndex((l) => l.kind === kind);
    autoFilled.delete(FILTER_LEVELS[idx].key);

    FILTER_LEVELS.slice(0, idx).reverse().forEach((parent) => {
      if (!empty(state[parent.key]) && !isAutoFilled(parent.key)) return; // the user's own pick
      /* Nearest level below that still has picks decides the parent */
      const source = FILTER_LEVELS.slice(FILTER_LEVELS.indexOf(parent) + 1).find((l) => !empty(state[l.key]));
      if (!source) {
        if (isAutoFilled(parent.key)) state[parent.key] = [];
        autoFilled.delete(parent.key);
        return;
      }
      const values = uniq(rowsFor(source.field, state[source.key]).map((r) => r[parent.field]));
      if (!values.length) return;
      state[parent.key] = values;
      autoFilled.set(parent.key, JSON.stringify(values));
    });

    if (!arr.length) return;
    FILTER_LEVELS.slice(idx + 1).forEach((child) => {
      if (empty(state[child.key])) return;
      const above = FILTER_LEVELS.slice(0, FILTER_LEVELS.indexOf(child)).filter((l) => !empty(state[l.key]));
      const fits = (r) => above.every((l) => state[l.key].includes(r[l.field]));
      const kept = new Set(rowsFor(child.field, state[child.key]).filter(fits).map((r) => r[child.field]));
      state[child.key] = state[child.key].filter((v) => kept.has(v));
    });
  }

  function fillComboList(kind, query) {
    const root = comboRoot(kind);
    const list = root.querySelector(".combo-list");
    const { items, total } = visibleComboItems(kind, query);
    const selected = new Set(selectedArr(kind));
    if (!items.length) {
      list.innerHTML = `<li class="empty">No matches</li>`;
      return;
    }
    const more = total > items.length
      ? `<li class="empty">Showing ${fmt.format(items.length)} of ${fmt.format(total)} — type to search</li>`
      : "";
    list.innerHTML = more + items
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
        cascadeSelection(kind, arr);
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
    const dtsOnFeeders = empty(state.feeders) ? 0 : state.feeders.reduce((acc, f) => acc + feederDtCount(f), 0);
    set("dt", dtsOnFeeders ? `All ${fmt.format(dtsOnFeeders)} DTs on ${state.feeders.length === 1 ? "feeder" : "feeders"}` : "All DTs", "DTs");
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
            cascadeSelection(kind, []);
          } else if (btn.dataset.action === "select-all") {
            const { items } = visibleComboItems(kind, search.value || "");
            setSelectedArr(kind, items.map((i) => i.value));
            cascadeSelection(kind, selectedArr(kind));
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

  /* ---------- Owner-only upload ----------
   * The Upload button stays hidden for every visitor. The owner unlocks it once per browser by
   * opening the dashboard with ?owner in the address (or pressing Ctrl+Shift+U) and entering the
   * owner passcode, which /api/owner checks against a salted hash. ?owner=signout locks it again. */
  const OWNER_KEY = "ie-dashboard-owner-key";
  state.isOwner = false;

  function setOwnerUI(on) {
    state.isOwner = !!on;
    const btn = document.getElementById("upload-btn");
    if (btn) btn.hidden = !state.isOwner;
  }

  async function checkOwnerKey(key) {
    try {
      const r = await fetch("/api/owner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key }),
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  async function ownerSignIn() {
    const key = window.prompt("Owner passcode to enable uploads on this browser:");
    if (!key) return;
    if (await checkOwnerKey(key)) {
      try { localStorage.setItem(OWNER_KEY, key); } catch { /* private mode: unlock for this visit only */ }
      setOwnerUI(true);
      setStatus("Upload enabled for the dashboard owner on this browser.");
    } else {
      setOwnerUI(false);
      setStatus("Passcode not recognised. Upload stays locked.", true);
    }
  }

  function ownerSignOut() {
    try { localStorage.removeItem(OWNER_KEY); } catch { /* ignore */ }
    setOwnerUI(false);
    setStatus("Upload locked on this browser.");
  }

  async function initOwner() {
    setOwnerUI(false);
    document.addEventListener("keydown", (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "U" || e.key === "u")) {
        e.preventDefault();
        if (state.isOwner) ownerSignOut(); else ownerSignIn();
      }
    });
    const params = new URLSearchParams(location.search);
    const flag = params.has("owner") ? (params.get("owner") || "").toLowerCase() : null;
    if (flag !== null) {
      params.delete("owner");
      const q = params.toString();
      history.replaceState(null, "", location.pathname + (q ? "?" + q : "") + location.hash);
      if (flag === "signout" || flag === "logout") { ownerSignOut(); return; }
    }
    let saved = null;
    try { saved = localStorage.getItem(OWNER_KEY); } catch { /* ignore */ }
    if (saved && await checkOwnerKey(saved)) { setOwnerUI(true); return; }
    if (saved) { try { localStorage.removeItem(OWNER_KEY); } catch { /* ignore */ } }
    if (flag !== null) await ownerSignIn();
  }

  function wireUploadExport() {
    const input = document.getElementById("upload-input");
    input.addEventListener("change", async () => {
      const files = [...input.files];
      if (!files.length) return;
      if (!state.isOwner) {
        input.value = "";
        setStatus("Uploading is restricted to the dashboard owner.", true);
        return;
      }
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
      const scope = document.getElementById("export-scope");
      if (!menu.hidden && scope) scope.textContent = `Scope: ${window.IKEDCReports?.scopeLabel?.() || "current filters"}`;
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

  /** Exports live in js/reports.js (branded Excel workbooks and single sheets, plain CSV, GeoJSON / KML built from the active filters) */
  function runExport(kind) {
    const reports = window.IKEDCReports;
    if (!reports) {
      setStatus("Export tools are still loading — try again in a moment.", true);
      return;
    }
    if (kind === "xlsx") reports.excel({ both: false });
    else if (kind.startsWith("sheet-")) reports.sheet(kind.slice(6));
    else if (kind.startsWith("csv-")) reports.csv(kind.slice(4));
    else if (kind === "geojson") reports.geojson();
    else if (kind === "kml") reports.kml();
  }

  function resetFilters() {
    state.bus = [];
    state.uts = [];
    state.feeders = [];
    state.dts = [];
    state.dtOwn = null;
    state.installPos = null;
    state.fidelityBand = null;
    state.capacityBand = null;
    refreshAll({ zoom: true });
    setStatus("All filters cleared");
  }

  function setFilters(partial = {}) {
    if (partial.bus !== undefined) state.bus = Array.isArray(partial.bus) ? partial.bus.slice() : [];
    if (partial.uts !== undefined) state.uts = Array.isArray(partial.uts) ? partial.uts.slice() : [];
    if (partial.feeders !== undefined) state.feeders = Array.isArray(partial.feeders) ? partial.feeders.slice() : [];
    if (partial.dts !== undefined) state.dts = Array.isArray(partial.dts) ? partial.dts.slice() : [];
    if (partial.dtOwn !== undefined) state.dtOwn = partial.dtOwn;
    if (partial.installPos !== undefined) state.installPos = partial.installPos;
    if (partial.fidelityBand !== undefined) state.fidelityBand = partial.fidelityBand;
    if (partial.capacityBand !== undefined) state.capacityBand = partial.capacityBand;
    refreshAll({ zoom: partial.zoom !== false });
  }

  function getFilters() {
    return {
      bus: state.bus.slice(),
      uts: state.uts.slice(),
      feeders: state.feeders.slice(),
      dts: state.dts.slice(),
      dtOwn: state.dtOwn,
      installPos: state.installPos,
      fidelityBand: state.fidelityBand,
      capacityBand: state.capacityBand,
    };
  }

  window.IKEDC = {
    getData: () => state.data,
    getFeedersGeo: () => state.feedersGeo,
    getLabels: () => state.labels,
    setLagos: (fc) => { state.lagos = fc; if (state.map) redrawMapLayers(); },
    getLagos: () => state.lagos,
    boundaryStyle,
    setMapTheme,
    refreshChartTheme,
    resetFilters,
    setFilters,
    getFilters,
    /** Apply a picker-style choice (with the BU → UT → feeder → DT cascade) from another view */
    pickFilter: (kind, values) => {
      const key = comboStateKey[kind];
      if (!key) return;
      state[key] = (values || []).slice();
      cascadeSelection(kind, state[key]);
      syncComboLabels();
      refreshAll({ zoom: true });
    },
    getScopeSummary: () => scopeSummary(),
    /** Register feeder names for a feeder layer / meta name + voltage */
    feederRegisterNames: (name, voltage) => uniq(state.data.feeders
      .filter((f) => String(f.feeder).toLowerCase() === String(name || "").toLowerCase() && (!voltage || f.voltage === voltage))
      .flatMap(registerNamesForMeta)),
    getScopeDTs: () => scopeDTs(),
    /** Feeders in the active filters with register DT counts and their register names */
    getScopeFeeders: () => filteredFeedersMeta().map((f) => ({
      ...f,
      dt_count: registerDtCount(f) ?? f.dt_count,
      register_names: registerNamesForMeta(f),
    })),
    applyBuFilterFromLabel,
    feederDisplayName,
    buDisplayName,
    utDisplayName,
    attachTitleLayerFilter,
    makeBasemaps,
    addMapTools,
    popupHtml: {
      bu: buPopupHtml,
      ut: utPopupHtml,
      feeder: feederPopupHtml,
      dt: dtPopupHtml,
      iss: issPopupHtml,
      tcn: tcnPopupHtml,
    },
    popupOpts,
    LABEL_ZOOM,
    resize: () => {
      if (state.map) state.map.invalidateSize();
      resizeVisibleCharts();
      if (state.flyPending) requestAnimationFrame(flyToSelection);
    },
  };

  async function boot() {
    chartDefaults();
    wireTabs();
    wireCombos();
    wireUploadExport();
    initOwner();

    // Full DT register streams in alongside; charts upgrade to per-DT figures when it lands
    const registerPromise = fetch("data/dt_register.json")
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);

    // Critical path: dashboard JSON first so KPIs/filters paint ASAP
    const dashRes = await fetch("data/dashboard.json");
    if (!dashRes.ok) throw new Error("Failed to load dashboard.json");
    state.data = await dashRes.json();

    const meta = document.getElementById("footer-meta");
    if (meta) {
      meta.textContent = "Designed & Developed by Collins Anyanwu";
    }

    // Light UI first (no map yet)
    renderKPIs();
    renderCompare();
    populateCombos();
    renderUTTable();
    renderActiveTabCharts(true);

    const registerReady = registerPromise.then((reg) => {
      if (!reg?.rows) return;
      applyRegister(reg);
      state.rendered = { overview: false, assets: false, feeders: false };
      renderKPIs();
      renderUTTable();
      renderActiveTabCharts(true);
      populateCombos();
      announceFilters();
    });

    // Defer heavy geo + map to next frames (keeps clicks/filters snappy during load)
    const schedule = (fn, timeout = 1200) => {
      if (typeof requestIdleCallback === "function") requestIdleCallback(() => fn(), { timeout });
      else setTimeout(fn, 0);
    };

    schedule(async () => {
      const [feedRes, labelRes, lagosRes] = await Promise.all([
        fetch("data/feeders.geojson"),
        fetch("data/map_labels.json"),
        fetch("data/lagos_boundary.geojson"),
      ]);
      state.feedersGeo = feedRes.ok ? await feedRes.json() : { type: "FeatureCollection", features: [] };
      state.labels = labelRes.ok ? await labelRes.json() : { bu: [], ut: [] };
      state.lagos = lagosRes.ok ? await lagosRes.json() : null;
      await registerReady;
      requestAnimationFrame(() => {
        initMap();
        if (state.activeTab === "feeders") renderFeederCharts();
        /* Story / Coverage maps may have opened before geo arrived — refill assets */
        window.IKEDCExperience?.refreshStoryMapAssets?.();
        window.IKEDCExperience?.refreshCoverageAssets?.();
      });
    }, 800);
  }

  boot().catch((err) => {
    const meta = document.getElementById("footer-meta");
    if (meta) meta.textContent = `Error: ${err.message}`;
    console.error(err);
  });
})();
