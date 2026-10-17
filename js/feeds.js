/* Shared live feeds client — Intelligence, Coverage, Story */
(() => {
  const REFRESH_MS = 3 * 60 * 1000;
  const ENDPOINTS = ["/api/feeds", "/api/feeds.js"];
  let cache = null;
  let inflight = null;
  let timer = 0;
  /** @type {string|null} shared source filter id; null = all */
  let activeSourceId = null;
  const mounts = new Map();

  const TAB_ORDER = [
    { id: null, label: "All" },
    { id: "ikeja", label: "Ikeja Electric" },
    { id: "nerc", label: "NERC" },
    { id: "laserc", label: "LASERC" },
    { id: "google-power", label: "News" },
    { id: "nairametrics", label: "Nairametrics" },
    { id: "google-geo", label: "Geospatial" },
  ];

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

  function itemMatchesSource(it, sourceId) {
    if (!sourceId) return true;
    const sid = String(it.source || it.sourceId || "").toLowerCase();
    const name = String(it.sourceName || "").toLowerCase();
    if (sid === sourceId) return true;
    if (sourceId === "ikeja" && name.includes("ikeja")) return true;
    if (sourceId === "nerc" && name.includes("nerc")) return true;
    if (sourceId === "laserc" && name.includes("laserc")) return true;
    if (sourceId === "nairametrics" && name.includes("naira")) return true;
    if (sourceId === "google-power" && (name.includes("power") || name.includes("google news · power"))) return true;
    if (sourceId === "google-geo" && (name.includes("geospatial") || name.includes("google news · geo"))) return true;
    return false;
  }

  function renderTabsHtml(sources) {
    const byId = Object.fromEntries((sources || []).map((s) => [s.id, s]));
    return `<div class="live-feed-tabs" role="tablist" aria-label="Feed sources">
      ${TAB_ORDER.map((tab) => {
        const src = tab.id ? byId[tab.id] : null;
        const okClass = !tab.id ? "ok" : src?.ok ? "ok" : src ? "err" : "";
        const active = activeSourceId === tab.id ? " active" : "";
        const title = src?.error ? escapeHtml(src.error) : escapeHtml(tab.label);
        return `<button type="button" class="live-feed-tab ${okClass}${active}" role="tab"
          data-source="${tab.id == null ? "" : escapeHtml(tab.id)}"
          aria-selected="${activeSourceId === tab.id ? "true" : "false"}"
          title="${title}">${escapeHtml(tab.label)}</button>`;
      }).join("")}
    </div>`;
  }

  function wireTabs(el) {
    el.querySelectorAll(".live-feed-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.source || null;
        setSourceFilter(id || null);
      });
    });
    el.querySelectorAll(".feed-badge[data-source]").forEach((badge) => {
      badge.addEventListener("click", () => {
        const id = badge.dataset.source || null;
        setSourceFilter(activeSourceId === id ? null : id);
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
      : "all sources";

    if (!allItems.length) {
      el.innerHTML = `${renderTabsHtml(sources)}
        <div class="live-feed-empty">Live feeds unavailable right now. Retrying…</div>`;
      wireTabs(el);
      return;
    }

    const badges = sources
      .map((s) => {
        const active = activeSourceId === s.id ? " active" : "";
        return `<button type="button" class="feed-badge ${s.ok ? "ok" : "err"}${active}" data-source="${escapeHtml(s.id)}" title="${escapeHtml(s.error || s.name)}">${escapeHtml(s.name)}</button>`;
      })
      .join("");

    el.innerHTML = `
      ${renderTabsHtml(sources)}
      <div class="live-feed-meta">
        <span>Live · ${okCount}/${sources.length || "—"} sources${stamp ? ` · refreshed ${stamp}` : ""} · showing ${escapeHtml(filterLabel)}</span>
        <div class="feed-badges">${badges}</div>
      </div>
      ${
        items.length
          ? `<ul class="live-feed-list">
        ${items
          .map((it) => {
            const href = it.url || "#";
            const tip = it.summary ? ` title="${escapeHtml(it.summary)}"` : "";
            return `<li>
            <a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"${tip}>
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
          el.innerHTML = `${renderTabsHtml([])}<div class="live-feed-empty">Waiting for live feeds…</div>`;
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
      el.innerHTML = `<div class="live-feed-empty">Loading live feeds…</div>`;
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
  };
})();
