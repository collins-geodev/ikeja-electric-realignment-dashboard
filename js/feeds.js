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

  function decodeEntities(s) {
    return String(s || "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
        try { return String.fromCodePoint(parseInt(h, 16)); } catch { return " "; }
      })
      .replace(/&#(\d+);/g, (_, n) => {
        try { return String.fromCodePoint(Number(n)); } catch { return " "; }
      })
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&amp;/gi, "&");
  }

  /** Plain-text briefing from RSS HTML / entity-escaped markup */
  function plainSummary(raw, title) {
    let s = String(raw || "");
    for (let i = 0; i < 2; i += 1) {
      s = decodeEntities(s);
      s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ");
    }
    s = s.replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim();
    if (!s || s.length < 12 || /^</.test(s) || /href\s*=/i.test(s)) {
      return title
        ? `${title} — open the publisher for the full story.`
        : "No clean summary available. Open the full article externally.";
    }
    return s.length > 480 ? `${s.slice(0, 477)}…` : s;
  }

  function scheduleTask(fn) {
    if (typeof requestIdleCallback === "function") requestIdleCallback(() => fn(), { timeout: 1200 });
    else setTimeout(fn, 0);
  }

  let activeViewerItem = null;
  let articleRequest = null;
  let viewerTrigger = null;

  function safeArticleUrl(value) {
    try {
      const url = new URL(value);
      return ["https:", "http:"].includes(url.protocol) ? url.href : "";
    } catch { return ""; }
  }

  function ensureViewer() {
    let root = document.getElementById("feed-reader");
    if (root) return root;
    root = document.createElement("dialog");
    root.id = "feed-reader";
    root.className = "feed-reader";
    root.setAttribute("aria-labelledby", "feed-reader-title");
    root.innerHTML = `
      <div class="feed-reader-panel">
        <header class="feed-reader-head">
          <div class="feed-reader-head-text">
            <p class="feed-reader-source" id="feed-reader-source">Live intelligence</p>
            <h2 id="feed-reader-title">Article</h2>
          </div>
          <button type="button" class="btn btn-ghost feed-reader-close" data-feed-close aria-label="Close article" autofocus>✕</button>
        </header>
        <div class="feed-reader-toolbar">
          <span class="feed-reader-address" id="feed-reader-address"></span>
          <div class="feed-reader-actions">
            <button type="button" class="btn btn-ghost" id="feed-reader-reload">Retry</button>
            <button type="button" class="btn btn-ghost" id="feed-reader-reading">Reader view</button>
            <a class="btn btn-primary" id="feed-reader-external" target="_blank" rel="noopener noreferrer">Open publisher ↗</a>
          </div>
        </div>
        <div class="feed-reader-body">
          <div class="feed-reader-loading" id="feed-reader-loading" hidden role="status">
            <div class="feed-reader-spinner" aria-hidden="true"></div>
            <p>Opening your story…</p>
            <small>Preparing the publisher page</small>
          </div>
          <div class="feed-reader-frame-wrap" id="feed-reader-frame-wrap" hidden>
            <iframe id="feed-reader-frame" title="News article preview" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"></iframe>
          </div>
          <article class="feed-reader-fallback" id="feed-reader-fallback" hidden>
            <p class="feed-reader-source">Article preview unavailable</p>
            <h3 id="feed-reader-fallback-title"></h3>
            <p class="feed-reader-fallback-meta" id="feed-reader-fallback-meta"></p>
            <p class="feed-reader-fallback-summary" id="feed-reader-fallback-summary"></p>
            <p class="feed-reader-fallback-note">This publisher could not be displayed here. Use Open publisher above to read the story, or retry.</p>
          </article>
        </div>
        <footer class="feed-reader-footer">
          <span id="feed-reader-status" role="status">Publisher preview</span>
          <span>Some sites require opening the publisher directly.</span>
        </footer>
      </div>`;
    document.body.appendChild(root);
    root.addEventListener("click", (e) => {
      if (e.target === root || e.target.closest("[data-feed-close]")) root.close();
    });
    root.addEventListener("close", closeViewer);
    root.querySelector("#feed-reader-reload").addEventListener("click", () => showArticleBrowser(activeViewerItem));
    root.querySelector("#feed-reader-reading").addEventListener("click", () => showArticleBrowser(activeViewerItem, "reader"));
    return root;
  }

  function closeViewer() {
    articleRequest?.abort();
    articleRequest = null;
    const root = document.getElementById("feed-reader");
    if (root?.open) root.close();
    document.body.classList.remove("feed-reader-open");
    const frame = document.getElementById("feed-reader-frame");
    if (frame) {
      frame.onload = null;
      frame.removeAttribute("srcdoc");
      frame.src = "about:blank";
    }
    activeViewerItem = null;
    if (viewerTrigger?.isConnected) viewerTrigger.focus();
    viewerTrigger = null;
  }

  function showFallback(item, message) {
    document.getElementById("feed-reader-frame-wrap").hidden = true;
    document.getElementById("feed-reader-loading").hidden = true;
    document.getElementById("feed-reader-fallback").hidden = false;
    document.getElementById("feed-reader-fallback-title").textContent = item.title || "Article";
    document.getElementById("feed-reader-fallback-meta").textContent =
      [item.sourceName || item.source, fmtWhen(item.publishedAt)].filter(Boolean).join(" · ");
    document.getElementById("feed-reader-fallback-summary").textContent = plainSummary(item.summary || item.snippet, "");
    document.getElementById("feed-reader-status").textContent = message;
  }

  async function showArticleBrowser(item, mode = "page") {
    if (!item) return;
    articleRequest?.abort();
    const request = new AbortController();
    articleRequest = request;
    const timeout = setTimeout(() => request.abort(), 35000);
    const frame = document.getElementById("feed-reader-frame");
    frame.onload = null;
    frame.removeAttribute("srcdoc");
    frame.src = "about:blank";
    document.getElementById("feed-reader-frame-wrap").hidden = true;
    document.getElementById("feed-reader-fallback").hidden = true;
    document.getElementById("feed-reader-loading").hidden = false;
    document.getElementById("feed-reader-status").textContent = "Connecting to the publisher…";
    try {
      const url = safeArticleUrl(item.url);
      if (!url) throw new Error("This story has no valid publisher link.");
      const response = await fetch("/api/article?url=" + encodeURIComponent(url) + "&view=" + mode, { signal: request.signal });
      if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) {
        throw new Error("The publisher preview is unavailable.");
      }
      const html = await response.text();
      if (!html.trim()) throw new Error("The publisher returned an empty page.");
      if (articleRequest !== request || !document.getElementById("feed-reader").open) return;
      const publisher = safeArticleUrl(response.headers.get("X-Article-Publisher"));
      if (publisher) {
        document.getElementById("feed-reader-external").href = publisher;
        document.getElementById("feed-reader-address").textContent = new URL(publisher).hostname.replace(/^www\./, "");
      }
      // The opaque sandbox prevents publisher markup accessing the dashboard.
      frame.srcdoc = html;
      document.getElementById("feed-reader-frame-wrap").hidden = false;
      document.getElementById("feed-reader-loading").hidden = true;
      document.getElementById("feed-reader-status").textContent =
        mode === "reader" ? "Reader view · simplified article" : "Publisher preview · use Reader view if the layout is incomplete";
    } catch (error) {
      if (articleRequest === request && document.getElementById("feed-reader").open) {
        showFallback(item, request.signal.aborted ? "The publisher took too long to respond." : error.message);
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  function openViewer(item) {
    const root = ensureViewer();
    viewerTrigger = document.activeElement;
    activeViewerItem = item;
    document.getElementById("feed-reader-title").textContent = item.title || "Article";
    document.getElementById("feed-reader-source").textContent = item.sourceName || item.source || "Live intelligence";
    const url = safeArticleUrl(item.url);
    const external = document.getElementById("feed-reader-external");
    external.href = url || "#";
    external.hidden = !url;
    document.getElementById("feed-reader-address").textContent = url ? new URL(url).hostname.replace(/^www\./, "") : "Live feed";
    if (!root.open) root.showModal();
    document.body.classList.add("feed-reader-open");
    showArticleBrowser(item);
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
            const brief = plainSummary(it.summary || it.snippet, it.title);
            const tip = brief ? ` title="${escapeHtml(brief)}"` : "";
            const payload = encodeURIComponent(JSON.stringify({
              url: it.url || "",
              title: it.title || "",
              sourceName: it.sourceName || it.source || "",
              summary: brief,
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
