/* Shared live feeds client — Intelligence, Coverage, Story */
(() => {
  const REFRESH_MS = 3 * 60 * 1000;
  const ENDPOINTS = ["/api/feeds", "/api/feeds.js"];
  let cache = null;
  let inflight = null;
  let timer = 0;
  const mounts = new Map();

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

  function renderInto(el, data, opts = {}) {
    if (!el) return;
    const limit = opts.limit || 10;
    const items = (data?.items || []).slice(0, limit);
    const sources = data?.sources || [];
    const okCount = sources.filter((s) => s.ok).length;
    const stamp = data?.generatedAt ? fmtWhen(data.generatedAt) : "";

    if (!items.length) {
      el.innerHTML = `<div class="live-feed-empty">Live feeds unavailable right now. Retrying…</div>`;
      return;
    }

    const badges = sources
      .map(
        (s) =>
          `<span class="feed-badge ${s.ok ? "ok" : "err"}" title="${escapeHtml(s.error || s.name)}">${escapeHtml(s.name)}</span>`
      )
      .join("");

    el.innerHTML = `
      <div class="live-feed-meta">
        <span>Live · ${okCount}/${sources.length || "—"} sources${stamp ? ` · refreshed ${stamp}` : ""}</span>
        <div class="feed-badges">${badges}</div>
      </div>
      <ul class="live-feed-list">
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
      </ul>`;
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
        const el = document.getElementById(id);
        renderInto(el, data, opts);
      });
    } catch (err) {
      mounts.forEach((_, id) => {
        const el = document.getElementById(id);
        if (el && !el.querySelector(".live-feed-list")) {
          el.innerHTML = `<div class="live-feed-empty">Waiting for live feeds…</div>`;
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
    // Non-blocking
    queueTask(() => refreshAll(false));
    if (!timer) {
      timer = window.setInterval(() => refreshAll(false), REFRESH_MS);
    }
  }

  function scheduleTask(fn) {
    if (typeof requestIdleCallback === "function") requestIdleCallback(() => fn(), { timeout: 1200 });
    else setTimeout(fn, 0);
  }

  window.IKEDCFeeds = { mount, refresh: () => refreshAll(true) };
})();
