/**
 * Live industry feeds for IKEDC dashboard (Vercel serverless).
 * Aggregates RSS + LASERC API with per-source fallbacks and short cache.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
let memoryCache = { at: 0, body: null };

const SOURCES = [
  {
    id: "ikeja",
    name: "Ikeja Electric",
    kind: "rss",
    url: "https://www.ikejaelectric.com/feed/",
  },
  {
    id: "nerc",
    name: "NERC",
    kind: "rss",
    url: "https://nerc.gov.ng/feed/",
  },
  {
    id: "nairametrics",
    name: "Nairametrics",
    kind: "rss",
    url: "https://nairametrics.com/feed/",
  },
  {
    id: "google-power",
    name: "Google News · Power",
    kind: "rss",
    url: "https://news.google.com/rss/search?q=Ikeja+Electric+OR+%22Lagos+electricity%22+OR+NERC+OR+DisCo+power&hl=en-NG&gl=NG&ceid=NG:en",
  },
  {
    id: "google-geo",
    name: "Google News · Geospatial",
    kind: "rss",
    url: "https://news.google.com/rss/search?q=GIS+utility+OR+%22ArcGIS%22+OR+geospatial+power+Nigeria+OR+%22distribution+network%22+Lagos&hl=en-NG&gl=NG&ceid=NG:en",
  },
  {
    id: "laserc",
    name: "LASERC",
    kind: "laserc",
    urls: [
      "https://larsec-bk-epeak.ondigitalocean.app/api/content/media",
      "https://larsec-bk-epeak.ondigitalocean.app/api/content/media/published",
      "https://larsec-bk-epeak.ondigitalocean.app/api/content/medias",
      "https://larsec-bk-epeak.ondigitalocean.app/api/content/posts",
      "https://larsec-bk-epeak.ondigitalocean.app/api/content/news",
      "https://larsec-bk-epeak.ondigitalocean.app/api/Media",
      "https://larsec-bk-epeak.ondigitalocean.app/api/media",
    ],
  },
];

function stripHtml(html) {
  return String(html || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function pickTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  return m ? stripHtml(m[1]) : "";
}

function pickLink(block) {
  const atom = block.match(/<link[^>]+href=["']([^"']+)["']/i);
  if (atom) return atom[1];
  const rss = pickTag(block, "link");
  return rss || "";
}

function parseRss(xml, source, limit = 8) {
  const items = [];
  const chunks = xml.split(/<item[\s>]/i).slice(1);
  const entries = chunks.length ? chunks : xml.split(/<entry[\s>]/i).slice(1);
  for (const chunk of entries.slice(0, limit)) {
    const title = pickTag(chunk, "title");
    if (!title) continue;
    const link = pickLink(chunk);
    const date =
      pickTag(chunk, "pubDate") ||
      pickTag(chunk, "published") ||
      pickTag(chunk, "updated") ||
      pickTag(chunk, "dc:date") ||
      "";
    const summary =
      pickTag(chunk, "description") ||
      pickTag(chunk, "summary") ||
      pickTag(chunk, "content") ||
      "";
    items.push({
      id: `${source.id}-${items.length}-${title.slice(0, 40)}`,
      sourceId: source.id,
      source: source.name,
      title,
      url: link || source.url,
      publishedAt: date ? new Date(date).toISOString() : null,
      summary: summary.slice(0, 220),
    });
  }
  return items;
}

function normalizeLasercPayload(data, source) {
  const rows = Array.isArray(data)
    ? data
    : data?.data || data?.items || data?.results || data?.medias || data?.media || [];
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, 10).map((row, i) => {
    const title =
      row.title || row.headline || row.name || row.subject || `LASERC update ${i + 1}`;
    const url =
      row.url ||
      row.link ||
      row.slugUrl ||
      (row.slug ? `https://laserc.com.ng/media/${row.slug}` : "https://laserc.com.ng/media");
    const date = row.date || row.publishedAt || row.createdAt || row.updatedAt || null;
    const summary = stripHtml(row.summary || row.description || row.excerpt || row.content || "");
    return {
      id: `laserc-${row.id || i}-${String(title).slice(0, 32)}`,
      sourceId: source.id,
      source: source.name,
      title: stripHtml(title),
      url,
      publishedAt: date ? new Date(date).toISOString() : null,
      summary: summary.slice(0, 220),
    };
  });
}

async function fetchText(url, timeoutMs = 9000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent": "IKEDC-Dashboard-Feeds/1.0",
        Accept: "application/rss+xml, application/xml, text/xml, application/json, */*",
      },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true, text: await res.text(), contentType: res.headers.get("content-type") || "" };
  } finally {
    clearTimeout(t);
  }
}

async function loadSource(source) {
  if (source.kind === "rss") {
    try {
      const { text } = await fetchText(source.url);
      const items = parseRss(text, source);
      return {
        id: source.id,
        name: source.name,
        ok: items.length > 0,
        error: items.length ? null : "No items parsed",
        items,
      };
    } catch (err) {
      return {
        id: source.id,
        name: source.name,
        ok: false,
        error: String(err.message || err),
        items: [],
      };
    }
  }

  // LASERC JSON API — try known routes, then HTML media page scrape fallback
  const errors = [];
  for (const url of source.urls) {
    try {
      const { text, contentType } = await fetchText(url, 8000);
      if (/json/i.test(contentType) || text.trim().startsWith("{") || text.trim().startsWith("[")) {
        const data = JSON.parse(text);
        const items = normalizeLasercPayload(data, source);
        if (items.length) {
          return { id: source.id, name: source.name, ok: true, error: null, items, via: url };
        }
      }
      errors.push(`${url}: empty`);
    } catch (err) {
      errors.push(`${url}: ${err.message || err}`);
    }
  }

  // Fallback: scrape public media listing if SPA left any SSR markers (rare) — also Google News LASERC query
  try {
    const gUrl =
      "https://news.google.com/rss/search?q=LASERC+OR+%22Lagos+State+Electricity+Regulatory%22&hl=en-NG&gl=NG&ceid=NG:en";
    const { text } = await fetchText(gUrl);
    const items = parseRss(text, { ...source, name: "LASERC · News" }, 6).map((it) => ({
      ...it,
      source: "LASERC · News",
      sourceId: "laserc",
    }));
    if (items.length) {
      return {
        id: source.id,
        name: source.name,
        ok: true,
        error: `API unavailable; using news fallback (${errors.slice(0, 2).join("; ")})`,
        items,
        via: "google-news-fallback",
      };
    }
  } catch (err) {
    errors.push(`news-fallback: ${err.message || err}`);
  }

  return {
    id: source.id,
    name: source.name,
    ok: false,
    error: errors.slice(0, 4).join(" | ") || "Unavailable",
    items: [],
  };
}

async function buildFeeds() {
  const settled = await Promise.all(SOURCES.map((s) => loadSource(s)));
  const items = settled
    .flatMap((s) => s.items)
    .filter((it) => it.title)
    .sort((a, b) => {
      const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
      const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
      return tb - ta;
    })
    .slice(0, 48);

  return {
    generatedAt: new Date().toISOString(),
    cacheTtlSec: Math.round(CACHE_TTL_MS / 1000),
    sources: settled.map(({ id, name, ok, error, via }) => ({ id, name, ok, error, via: via || null })),
    items,
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const bust = req.query?.refresh === "1";
  const now = Date.now();
  if (!bust && memoryCache.body && now - memoryCache.at < CACHE_TTL_MS) {
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
    res.setHeader("X-Feed-Cache", "HIT");
    res.status(200).json(memoryCache.body);
    return;
  }

  try {
    const body = await buildFeeds();
    memoryCache = { at: now, body };
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
    res.setHeader("X-Feed-Cache", bust ? "BYPASS" : "MISS");
    res.status(200).json(body);
  } catch (err) {
    res.status(500).json({
      generatedAt: new Date().toISOString(),
      error: String(err.message || err),
      sources: [],
      items: [],
    });
  }
};
