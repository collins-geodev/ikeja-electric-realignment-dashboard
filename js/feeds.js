/* Shared live feeds client — Intelligence, Coverage, Story + in-dashboard mini browser */
(() => {
  const REFRESH_MS = 3 * 60 * 1000;
  const ENDPOINTS = ["/api/feeds", "/api/feeds.js"];
  let cache = null;
  let inflight = null;
  let timer = 0;
  /** @type {string|null} shared source filter id; null = all */
  let activeSourceId = null;
  const mounts = new Map();
  let viewerWired = false;

  /** Unified green-tab filter bar (source ids + display labels). No second white-tab row. */
  const TAB_ORDER = [
    { id: null, label: "ALL" },
    { id: "ikeja", label: "Ikeja Electric" },
    { id: "nerc", label: "NERC" },
    { id: "laserc", label: "LASERC" },
    { id: "nairametrics", label: "Nairametrics · Power" },
    { id: "google-power", label: "Electricity News" },
    { id: "google-policy", label: "FG Power Policy" },
    { id: "google-disco-ai", label: "DisCo AI / ML" },
    { id: "google-gis", label: "GIS News" },
    { id: "google-geoai", label: "GeoAI News" },
  ];

  function itemMatchesSource(it, sourceId) {
    if (!sourceId) return true;
    const sid = String(it.source || it.sourceId || "").toLowerCase();
    const name = String(it.sourceName || "").toLowerCase();
    const topic = String(it.topic || "").toLowerCase();
    if (sid === sourceId || it.sourceId === sourceId) return true;
    if (sourceId === "ikeja" && name.includes("ikeja")) return true;
    if (sourceId === "nerc" && name.includes("nerc")) return true;
    if (sourceId === "laserc" && name.includes("laserc")) return true;
    if (sourceId === "nairametrics" && name.includes("naira")) return true;
    if (sourceId === "google-power" && (topic === "electricity" || name.includes("electricity"))) return true;
    if (sourceId === "google-policy" && (topic === "policy" || name.includes("policy") || name.includes("fg power"))) return true;
    if (sourceId === "google-disco-ai" && (topic === "disco-ai" || name.includes("disco ai") || name.includes("ai / ml"))) return true;
    if (sourceId === "google-gis" && (topic === "gis" || name.includes("gis"))) return true;
    if (sourceId === "google-geoai" && (topic === "geoai" || name.includes("geoai"))) return true;
    if (sourceId === "google-geo" && (topic === "gis" || name.includes("geospatial") || name.includes("gis"))) return true;
    return false;
  }

  const fmtWhen = (iso) => {
    if (!iso) return "";
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return "";
    const d = new Date(t);
    const diff = Date.now() - t;
    if (diff < 60e3) return "just now";
    if (diff < 3600e3) return `${Math.floor(diff / 60e3)}m ago`;
    if (diff < 86400e3) return `${Math.floor(diff / 3600e3)}h ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };

  const escapeHtml = (s) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  function scheduleTask(fn) {
    if (typeof requestIdleCallback === "function") requestIdleCallback(() => fn(), { timeout: 1200 });
    else setTimeout(fn, 0);
  }

  function ensureViewer() {
    let root = document.getElementById("feed-reader");
    if (root) return root;
    root = document.createElement("div");
    root.id = "feed-reader";
    root.className = "feed-reader";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "feed-reader-title");
    root.innerHTML = `
      <div class="feed-reader-backdrop" data-feed-close></div>
      <div class="feed-reader-panel">
        <header class="feed-reader-head">
          <div class="feed-reader-head-text">
            <p class="feed-reader-source" id="feed-reader-source"></p>
            <h2 id="feed-reader-title">Article</h2>
          </div>
          <div class="feed-reader-actions">
            <a class="btn btn-ghost" id="feed-reader-external" href="#" target="_blank" rel="noopener noreferrer">Open externally</a>
            <button type="button" class="btn btn-secondary" data-feed-close aria-label="Close">Close</button>
          </div>
        </header>
        <div class="feed-reader-body">
          <div class="feed-reader-frame-wrap" id="feed-reader-frame-wrap">
            <iframe id="feed-reader-frame" title="Article preview" sandbox="allow-scripts allow-same-origin allow-popups allow-forms" referrerpolicy="no-referrer"></iframe>
          </div>
          <article class="feed-reader-fallback" id="feed-reader-fallback" hidden>
            <p class="feed-reader-fallback-note">This source blocks in-dashboard embedding (X-Frame-Options / CSP). Read the briefing below, or open externally.</p>
            <h3 id="feed-reader-fallback-title"></h3>
            <p class="feed-reader-fallback-meta" id="feed-reader-fallback-meta"></p>
            <p class="feed-reader-fallback-summary" id="feed-reader-fallback-summary"></p>
            <a class="btn btn-primary" id="feed-reader-fallback-link" href="#" target="_blank" rel="noopener noreferrer">Open full article</a>
          </article>
        </div>
      </div>`;
    document.body.appendChild(root);
    return root;
  }

  function closeViewer() {
    const root = document.getElementById("feed-reader");
    if (!root) return;
    root.hidden = true;
    document.body.classList.remove("feed-reader-open");
    const frame = document.getElementById("feed-reader-frame");
    if (frame) frame.src = "about:blank";
  }

  function showFallback(item) {
    const wrap = document.getElementById("feed-reader-frame-wrap");
    const fallback = document.getElementById("feed-reader-fallback");
    if (wrap) wrap.hidden = true;
    if (fallback) fallback.hidden = false;
    const t = document.getElementById("feed-reader-fallback-title");
    const m = document.getElementById("feed-reader-fallback-meta");
    const s = document.getElementById("feed-reader-fallback-summary");
    const a = document.getElementById("feed-reader-fallback-link");
    if (t) t.textContent = item.title || "Article";
    if (m) m.textContent = [item.sourceName || item.source, fmtWhen(item.publishedAt)].filter(Boolean).join(" · ");
    if (s) s.textContent = item.summary || item.snippet || "No summary available for this item.";
    if (a) {
      a.href = item.url || "#";
      a.hidden = !item.url;
    }
  }

  function showFrame(url) {
    const wrap = document.getElementById("feed-reader-frame-wrap");
    const fallback = document.getElementById("feed-reader-fallback");
    if (wrap) wrap.hidden = false;
    if (fallback) fallback.hidden = true;
    const frame = document.getElementById("feed-reader-frame");
    if (!frame) return;
    let settled = false;
    const toFallback = () => {
      if (settled) return;
      settled = true;
      /* Parent cannot always detect XFO; timed probe + blank check */
      try {
        const href = frame.contentWindow?.location?.href;
        if (!href || href === "about:blank") return;
      } catch (_) {
        /* cross-origin access denied usually means the frame loaded a foreign page — keep iframe */
        settled = false;
        return;
      }
    };
    frame.onload = () => {
      try {
        const doc = frame.contentDocument;
        if (doc && (!doc.body || !doc.body.innerHTML.trim())) {
          /* empty — likely blocked */
        }
      } catch (_) {
        /* cross-origin: treat as success (page rendered) */
        settled = true;
      }
    };
    frame.src = url;
    /* Many XFO sites show browser error page inside iframe; after delay offer reader card if still blank-looking */
    window.setTimeout(() => {
      if (settled) return;
      try {
        const doc = frame.contentDocument;
        if (doc && doc.body && doc.body.innerText.trim().length < 40) {
          /* likely blocked stub */
        }
      } catch (_) {
        settled = true;
      }
    }, 1800);
    void toFallback;
  }

  function openViewer(item) {
    const root = ensureViewer();
    wireViewerOnce();
    const title = document.getElementById("feed-reader-title");
    const source = document.getElementById("feed-reader-source");
    const ext = document.getElementById("feed-reader-external");
    if (title) title.textContent = item.title || "Article";
    if (source) source.textContent = item.sourceName || item.source || "Live feed";
    if (ext) {
      ext.href = item.url || "#";
      ext.hidden = !item.url;
    }
    root.hidden = false;
    document.body.classList.add("feed-reader-open");
    if (!item.url) {
      showFallback(item);
      return;
    }
    showFrame(item.url);
    /* Always prepare fallback content; user can switch if embed fails */
    const ft = document.getElementById("feed-reader-fallback-title");
    const fm = document.getElementById("feed-reader-fallback-meta");
    const fs = document.getElementById("feed-reader-fallback-summary");
    const fl = document.getElementById("feed-reader-fallback-link");
    if (ft) ft.textContent = item.title || "Article";
    if (fm) fm.textContent = [item.sourceName || item.source, fmtWhen(item.publishedAt)].filter(Boolean).join(" · ");
    if (fs) fs.textContent = item.summary || item.snippet || "Summary unavailable. Use Open externally if the preview is blank.";
    if (fl) fl.href = item.url;
    /* Heuristic: known-hard embeds → reader card first */
    const hard = /twitter\.com|x\.com|facebook\.com|linkedin\.com|instagram\.com/i.test(item.url);
    if (hard || !(item.summary || item.snippet)) {
      /* still try iframe; show note in fallback */
    }
    window.setTimeout(() => {
      const frame = document.getElementById("feed-reader-frame");
      const wrap = document.getElementById("feed-reader-frame-wrap");
      if (!frame || !wrap || wrap.hidden) return;
      try {
        const doc = frame.contentDocument;
        if (doc && doc.URL === "about:blank") showFallback(item);
      } catch (_) {
        /* cross-origin loaded OK */
      }
    }, 2200);
  }

  function wireViewerOnce() {
    if (viewerWired) return;
    viewerWired = true;
    const root = ensureViewer();
    root.addEventListener("click", (e) => {
      if (e.target.closest("[data-feed-close]")) closeViewer();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !root.hidden) closeViewer();
    });
  }

  function renderFilterTabs(sources) {
    const byId = Object.fromEntries((sources || []).map((s) => [s.id, s]));
    /* Prefer live source names when present; keep TAB_ORDER for stable ALL + merge coverage */
    const tabs = TAB_ORDER.map((tab) => {
      const src = tab.id ? byId[tab.id] : null;
      return {
        id: tab.id,
        label: tab.id == null ? "ALL" : (src?.name || tab.label),
        ok: tab.id == null ? true : src ? !!src.ok : true,
        err: src?.error || "",
      };
    });
    /* Append any unexpected API sources not already in TAB_ORDER */
    (sources || []).forEach((s) => {
      if (!TAB_ORDER.some((t) => t.id === s.id)) {
        tabs.push({ id: s.id, label: s.name || s.id, ok: !!s.ok, err: s.error || "" });
      }
    });
    return `<div class="feed-badges feed-filter-bar" role="tablist" aria-label="Feed sources">
      ${tabs.map((tab) => {
        const isAll = tab.id == null;
        const active = (isAll ? activeSourceId == null : activeSourceId === tab.id) ? " active" : "";
        const tone = isAll || tab.ok ? "ok" : "err";
        const title = tab.err ? escapeHtml(tab.err) : (isAll ? "Show all feed sources" : escapeHtml(tab.label));
        return `<button type="button" class="feed-badge ${tone}${active}${isAll ? " feed-badge-all" : ""}" role="tab"
          data-source="${isAll ? "all" : escapeHtml(tab.id)}"
          aria-selected="${isAll ? activeSourceId == null : activeSourceId === tab.id ? "true" : "false"}"
          title="${title}">${escapeHtml(tab.label)}</button>`;
      }).join("")}
    </div>`;
  }

  function wireTabs(el) {
    el.querySelectorAll(".feed-filter-bar .feed-badge").forEach((badge) => {
      badge.addEventListener("click", () => {
        const raw = badge.getAttribute("data-source");
        /* ALL tab → clear filter (show every source); other tabs toggle */
        if (raw == null || raw === "" || raw === "all") {
          setSourceFilter(null);
          return;
        }
        setSourceFilter(activeSourceId === raw ? null : raw);
      });
    });
    el.querySelectorAll(".live-feed-list a[data-feed-item]").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        let item = null;
        try { item = JSON.parse(decodeURIComponent(a.dataset.feedItem || "")); } catch (_) { /* ignore */ }
        if (!item) {
          item = {
            url: a.getAttribute("href"),
            title: a.querySelector(".feed-title")?.textContent || "Article",
            sourceName: a.querySelector(".feed-src")?.textContent || "",
            summary: a.getAttribute("title") || "",
          };
        }
        openViewer(item);
      });
    });
  }

  function renderInto(el, data, opts = {}) {
    if (!el) return;
    const limit = opts.limit || 10;
    const sources = data?.sources || [];
    const allItems = data?.items || [];
    const filtered = allItems.filter((it) => itemMatchesSource(it, activeSourceId));
    const items = filtered.slice(0, limit);
    const okCount = sources.filter((s) => s.ok).length;
    const stamp = data?.generatedAt ? fmtWhen(data.generatedAt) : "";
    const filterLabel = activeSourceId
      ? TAB_ORDER.find((t) => t.id === activeSourceId)?.label || activeSourceId
      : "ALL";

    if (!allItems.length) {
      el.innerHTML = `${renderFilterTabs(sources)}
        <div class="live-feed-empty">Live feeds unavailable right now. Retrying…</div>`;
      wireTabs(el);
      return;
    }

    el.innerHTML = `
      ${renderFilterTabs(sources)}
      <div class="live-feed-meta">
        <span>Live · ${okCount}/${sources.length || "—"} sources${stamp ? ` · refreshed ${stamp}` : ""} · showing ${escapeHtml(filterLabel)}</span>
      </div>
      ${
        items.length
          ? `<ul class="live-feed-list">
        ${items
          .map((it) => {
            const href = it.url || "#";
            const tip = it.summary ? ` title="${escapeHtml(it.summary)}"` : "";
            const payload = encodeURIComponent(JSON.stringify({
              url: it.url || "",
              title: it.title || "",
              sourceName: it.sourceName || it.source || "",
              summary: it.summary || it.snippet || "",
              publishedAt: it.publishedAt || "",
              source: it.source || "",
            }));
            return `<li>
            <a href="${escapeHtml(href)}" data-feed-item="${payload}"${tip}>
              <span class="feed-src">${escapeHtml(it.sourceName || it.source)}</span>
              <span class="feed-title">${escapeHtml(it.title)}</span>
              <span class="feed-time">${escapeHtml(fmtWhen(it.publishedAt))}</span>
            </a>
          </li>`;
          })
          .join("")}
      </ul>`
          : `<div class="live-feed-empty">No updates from ${escapeHtml(filterLabel)} right now. Try another tab.</div>`
      }`;
    wireTabs(el);
  }

  function setSourceFilter(id) {
    activeSourceId = id || null;
    if (cache?.data) {
      mounts.forEach((opts, mountId) => {
        renderInto(document.getElementById(mountId), cache.data, opts);
      });
    } else {
      refreshAll(false);
    }
  }

  async function fetchFeeds(force) {
    if (!force && cache && Date.now() - cache.at < REFRESH_MS) return cache.data;
    if (inflight) return inflight;
    inflight = (async () => {
      let lastErr = null;
      for (const url of ENDPOINTS) {
        try {
          const res = await fetch(`${url}${force ? "?refresh=1" : ""}`, {
            headers: { Accept: "application/json" },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          cache = { at: Date.now(), data };
          return data;
        } catch (err) {
          lastErr = err;
        }
      }
      if (cache?.data) return cache.data;
      throw lastErr || new Error("Feeds failed");
    })();
    try {
      return await inflight;
    } finally {
      inflight = null;
    }
  }

  async function refreshAll(force) {
    try {
      const data = await fetchFeeds(force);
      mounts.forEach((opts, id) => {
        renderInto(document.getElementById(id), data, opts);
      });
    } catch (err) {
      mounts.forEach((_, id) => {
        const el = document.getElementById(id);
        if (el && !el.querySelector(".live-feed-list")) {
          el.innerHTML = `${renderFilterTabs([])}<div class="live-feed-empty">Waiting for live feeds…</div>`;
          wireTabs(el);
        }
      });
      console.warn("[feeds]", err);
    }
  }

  function mount(id, opts = {}) {
    mounts.set(id, opts);
    const el = document.getElementById(id);
    if (el && !el.dataset.ready) {
      el.dataset.ready = "1";
      /* Show green filter bar (ALL first) immediately on every feed host */
      el.innerHTML = `${renderFilterTabs(cache?.data?.sources || [])}<div class="live-feed-empty">Loading live feeds…</div>`;
      wireTabs(el);
    }
    scheduleTask(() => refreshAll(false));
    if (!timer) {
      timer = window.setInterval(() => refreshAll(false), REFRESH_MS);
    }
  }

  window.IKEDCFeeds = {
    mount,
    refresh: () => refreshAll(true),
    setSourceFilter,
    getSourceFilter: () => activeSourceId,
    openViewer,
    closeViewer,
  };
})();
