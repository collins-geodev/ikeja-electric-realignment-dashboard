/**
 * Live industry feeds for IKEDC dashboard (Vercel serverless).
 * Aggregates RSS + LASERC API with per-source fallbacks and short cache.
 * Each tab also merges broader channels: Nigerian outlets / Bing News / X for the
 * Nigeria power tabs, and worldwide news, specialist publishers / X for GIS, GeoAI and AI/ML.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;
let memoryCache = { at: 0, body: null };
/* X API reads are scarce on the lower tiers: share one search per pool for 15 minutes */
const X_CACHE_TTL_MS = 15 * 60 * 1000;
const xCache = new Map();

const NG_EDITION = "hl=en-NG&gl=NG&ceid=NG:en";
const GLOBAL_EDITION = "hl=en-US&gl=US&ceid=US:en";
const gnews = (q, edition = NG_EDITION) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${edition}`;
const bing = (q, market) => `https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setmkt=${market}`;

/** Major Nigerian outlets: Nigerian by origin, so only a keyword match is needed */
const NG_OUTLETS = [
  { label: "Punch", url: "https://punchng.com/feed/" },
  { label: "Premium Times", url: "https://www.premiumtimesng.com/feed" },
  { label: "Vanguard", url: "https://www.vanguardngr.com/feed/" },
  { label: "BusinessDay", url: "https://businessday.ng/feed/" },
  { label: "The Guardian NG", url: "https://guardian.ng/feed/" },
  { label: "Channels TV", url: "https://www.channelstv.com/feed/" },
  { label: "TheCable", url: "https://www.thecable.ng/feed" },
];
const ngOutlets = (match) => NG_OUTLETS.map((o) => ({ ...o, region: "ng", match }));

/** Worldwide GIS / geospatial publishers for the GIS and GeoAI tabs */
const GEO_PUBLISHERS = [
  { label: "Esri Blog", url: "https://www.esri.com/arcgis-blog/feed/" },
  { label: "Geospatial World", url: "https://www.geospatialworld.net/feed/" },
  { label: "GIM International", url: "https://www.gim-international.com/rss" },
  { label: "Directions Magazine", url: "https://www.directionsmag.com/rss" },
  { label: "GIS Lounge", url: "https://www.gislounge.com/feed/" },
  { label: "Spatial Source", url: "https://www.spatialsource.com.au/feed/" },
].map((o) => ({ ...o, region: "global" }));

/** Mentions that place a story in Nigeria (for worldwide aggregators on Nigeria-only tabs) */
const NIGERIA_SIGNALS = [
  "nigeria", "nigerian", "lagos", "abuja", "ikeja", "ikedc", "ekedc", "aedc", "ibedc", "phed",
  "bedc", "eedc", "kaedco", "kedco", "jed ", "nerc", "laserc", "tcn", "niger delta", "naira",
  "₦", "tinubu", "federal government", "kano", "ibadan", "port harcourt", "enugu", "kaduna",
];

const SOURCES = [
  {
    id: "ikeja",
    name: "Ikeja Electric",
    kind: "rss",
    topic: "electricity",
    url: "https://www.ikejaelectric.com/feed/",
    urls: [
      "https://www.ikejaelectric.com/category/news/feed/",
      "https://www.ikejaelectric.com/feed/",
      "https://ikejaelectric.com/feed/",
    ],
    channels: [
      ...ngOutlets(["ikeja electric", "ikedc"]),
      { label: "Bing News", url: bing('"Ikeja Electric" OR IKEDC', "en-NG") },
      { label: "X", kind: "x", pool: "ng", match: ["ikeja electric", "ikedc", "@ikejaelectric"] },
    ],
  },
  {
    id: "nerc",
    name: "NERC",
    kind: "rss",
    topic: "electricity",
    url: "https://nerc.gov.ng/media-category/news/feed/",
    urls: [
      "https://nerc.gov.ng/media-category/news/feed/",
      "https://nerc.gov.ng/feed/",
    ],
    channels: [
      ...ngOutlets(["nerc", "nigerian electricity regulatory"]),
      { label: "Bing News", url: bing('NERC "Nigerian Electricity Regulatory Commission"', "en-NG") },
      { label: "X", kind: "x", pool: "ng", match: ["nerc", "@nercng"] },
    ],
  },
  {
    id: "nairametrics",
    name: "Nairametrics · Power",
    kind: "rss",
    topic: "electricity",
    url: "https://nairametrics.com/tag/electricity/feed/",
    urls: [
      "https://nairametrics.com/tag/electricity/feed/",
      "https://nairametrics.com/tag/power/feed/",
      "https://nairametrics.com/tag/nerc/feed/",
    ],
    channels: [
      { label: "Bing News", url: bing("site:nairametrics.com electricity OR power OR DisCo", "en-NG") },
    ],
  },
  {
    id: "google-power",
    name: "Electricity News",
    kind: "rss",
    topic: "electricity",
    url: "https://news.google.com/rss/search?q=%22Ikeja+Electric%22+OR+IKEDC+OR+EKEDC+OR+DisCo+OR+DisCos+OR+%22electricity+distribution%22+OR+%22power+sector%22+Nigeria+OR+TCN+OR+NBET+OR+%22grid+collapse%22&hl=en-NG&gl=NG&ceid=NG:en",
    channels: [
      ...ngOutlets(["electricity", "disco", "power sector", "national grid", "grid collapse", "transmission company", "tcn", "megawatt", "power supply", "nerc"]),
      { label: "Bing News", url: bing("Nigeria electricity OR DisCo OR \"power sector\" OR \"national grid\"", "en-NG") },
      { label: "X", kind: "x", pool: "ng", match: ["electricity", "disco", "power sector", "grid", "tcn", "nerc", "power supply"] },
    ],
  },
  {
    id: "google-policy",
    name: "FG Power Policy",
    kind: "rss",
    topic: "policy",
    url: "https://news.google.com/rss/search?q=(NERC+OR+%22Federal+Government%22+OR+FG+OR+BPE+OR+NBET+OR+%22Ministry+of+Power%22+OR+%22electricity+act%22+OR+tariff+OR+Band+A)+(%22power+sector%22+OR+electricity+OR+DisCo+OR+DisCos)+Nigeria&hl=en-NG&gl=NG&ceid=NG:en",
    channels: [
      ...ngOutlets(["ministry of power", "minister of power", "electricity act", "tariff", "band a", "power sector reform", "bpe", "nbet", "electricity subsidy"]),
      { label: "Bing News", url: bing('Nigeria "Ministry of Power" OR "electricity tariff" OR "Electricity Act" OR "power sector reform"', "en-NG") },
      { label: "X", kind: "x", pool: "ng", match: ["ministry of power", "minister of power", "electricity act", "tariff", "band a", "power sector"] },
    ],
  },
  {
    id: "google-disco-ai",
    name: "DisCo AI / ML",
    kind: "rss",
    topic: "disco-ai",
    region: "global",
    url: "https://news.google.com/rss/search?q=(%22artificial+intelligence%22+OR+AI+OR+%22machine+learning%22+OR+%22smart+meter%22+OR+predictive+OR+%22data+analytics%22)+(DisCo+OR+DisCos+OR+%22Ikeja+Electric%22+OR+IKEDC+OR+%22electricity+distribution%22+OR+%22power+distribution%22)+Nigeria&hl=en-NG&gl=NG&ceid=NG:en",
    /* AI / ML in power utilities worldwide, not only Nigeria */
    channels: [
      { label: "Google News", url: gnews('("artificial intelligence" OR "machine learning" OR "AI") ("power grid" OR "electric utility" OR "utilities" OR "power distribution" OR "smart grid" OR "grid operator")', GLOBAL_EDITION), region: "global" },
      { label: "Bing News", url: bing('"machine learning" OR "artificial intelligence" "electric utility" OR "power grid" OR "smart grid"', "en-US"), region: "global" },
      { label: "X", kind: "x", pool: "global" },
    ],
  },
  {
    id: "google-gis",
    name: "GIS News",
    kind: "rss",
    topic: "gis",
    region: "global",
    url: "https://news.google.com/rss/search?q=GIS+OR+geospatial+OR+ArcGIS+OR+QGIS+OR+%22utility+network%22+OR+%22distribution+network+mapping%22+OR+%22spatial+analytics%22+(electricity+OR+utility+OR+power+OR+DisCo+OR+Nigeria+OR+Lagos)&hl=en-NG&gl=NG&ceid=NG:en",
    /* GIS knowledge and practice worldwide */
    channels: [
      { label: "Google News", url: gnews('GIS OR geospatial OR ArcGIS OR QGIS OR "spatial analysis" OR "digital twin" OR "utility network"', GLOBAL_EDITION), region: "global" },
      { label: "Bing News", url: bing("GIS OR geospatial OR ArcGIS OR QGIS mapping", "en-US"), region: "global" },
      ...GEO_PUBLISHERS,
      { label: "X", kind: "x", pool: "global" },
    ],
  },
  {
    id: "google-geoai",
    name: "GeoAI News",
    kind: "rss",
    topic: "geoai",
    region: "global",
    url: "https://news.google.com/rss/search?q=GeoAI+OR+%22geospatial+AI%22+OR+%22AI+for+GIS%22+OR+%22machine+learning%22+geospatial+OR+%22remote+sensing%22+AI+(utility+OR+grid+OR+DisCo+OR+electricity+OR+infrastructure+OR+mapping)&hl=en-NG&gl=NG&ceid=NG:en",
    /* GeoAI research and industry worldwide */
    channels: [
      { label: "Google News", url: gnews('GeoAI OR "geospatial AI" OR "AI for GIS" OR "earth observation" AI OR "satellite imagery" "machine learning"', GLOBAL_EDITION), region: "global" },
      { label: "Bing News", url: bing('GeoAI OR "geospatial AI" OR "earth observation" "machine learning"', "en-US"), region: "global" },
      ...GEO_PUBLISHERS,
      { label: "X", kind: "x", pool: "global" },
    ],
  },
  {
    id: "laserc",
    name: "LASERC",
    kind: "laserc",
    topic: "electricity",
    urls: [
      "https://larsec-bk-epeak.ondigitalocean.app/api/content/media",
      "https://larsec-bk-epeak.ondigitalocean.app/api/content/media/published",
      "https://larsec-bk-epeak.ondigitalocean.app/api/content/medias",
      "https://larsec-bk-epeak.ondigitalocean.app/api/content/posts",
      "https://larsec-bk-epeak.ondigitalocean.app/api/content/news",
      "https://larsec-bk-epeak.ondigitalocean.app/api/Media",
      "https://larsec-bk-epeak.ondigitalocean.app/api/media",
    ],
    channels: [
      ...ngOutlets(["laserc", "lagos state electricity", "lagos electricity market"]),
      { label: "Bing News", url: bing('LASERC OR "Lagos State Electricity Regulatory Commission"', "en-NG") },
      { label: "X", kind: "x", pool: "ng", match: ["laserc", "lagos state electricity"] },
    ],
  },
];

/* One shared X search per pool; each tab then keeps the posts that match its topic */
const X_QUERIES = {
  ng: '(NERC OR DisCo OR DisCos OR "Ikeja Electric" OR IKEDC OR LASERC OR "Ministry of Power" OR "national grid" OR "electricity tariff" OR "power sector") (Nigeria OR Lagos OR Abuja) lang:en -is:retweet',
  global: '(GeoAI OR "geospatial AI" OR GIS OR geospatial OR ArcGIS OR QGIS OR "remote sensing" OR "earth observation" OR "AI for utilities" OR "smart grid AI") lang:en -is:retweet',
};

/** Keep feeds on electricity / policy / DisCo AI / GIS / GeoAI — drop unrelated news. */
const TOPIC_KEYWORDS = {
  electricity: [
    "electric", "electricity", "power", "grid", "disco", "discos", "ikedc", "ekedc", "ikeja",
    "nerc", "laserc", "feeder", "transformer", "transmission", "tcn", "distribution", "outage",
    "tariff", "megawatt", "kwh", "utility", "energy", "genco", "substation", "load", "nbet",
    "band a", "band b", "prepaid", "smart meter",
  ],
  policy: [
    "nerc", "federal government", " fg ", "ministry of power", "bpe", "nbet", "electricity act",
    "policy", "regulation", "tariff", "licence", "license", "disco", "discos", "power sector",
    "privatization", "privatisation", "subsidy", "reform", "presidential", "national assembly",
    "electricity", "power",
  ],
  "disco-ai": [
    "artificial intelligence", " machine learning", " ml ", " ai ", "smart meter", "predictive",
    "analytics", "data-driven", "automation", "digital twin", "scada", "ami", "disco", "discos",
    "ikedc", "ikeja electric", "electricity distribution", "outage prediction", "load forecast",
  ],
  gis: [
    "gis", "geospatial", "arcgis", "qgis", "mapping", "spatial", "cartograph", "geodata",
    "remote sensing", "satellite", "lidar", "utility network", "esri", "openstreetmap",
    "geoserver", "parcel", "cadastr",
  ],
  geoai: [
    "geoai", "geospatial ai", "ai for gis", "machine learning", "deep learning",
    "computer vision", "earth observation", "remote sensing", "satellite ai",
    "neural", "foundation model", "geospatial analytics", "artificial intelligence",
  ],
};

const BLOCK_KEYWORDS = [
  "waec", "hotel", "football", "premier league", "celebrity", "naira redesign",
  "crypto pump", "betting", "nollywood", "transfer window",
];

function textBlob(it) {
  return `${it.title || ""} ${it.summary || ""} ${it.sourceName || ""}`.toLowerCase();
}

function isOnTopic(it, topic) {
  const blob = textBlob(it);
  if (BLOCK_KEYWORDS.some((k) => blob.includes(k))) return false;
  // Official electricity sources stay unless clearly off-topic junk
  if (topic === "electricity" && ["ikeja", "nerc", "laserc"].includes(it.sourceId)) {
    return !BLOCK_KEYWORDS.some((k) => blob.includes(k));
  }
  const keys = TOPIC_KEYWORDS[topic] || [
    ...TOPIC_KEYWORDS.electricity,
    ...TOPIC_KEYWORDS.policy,
    ...TOPIC_KEYWORDS["disco-ai"],
    ...TOPIC_KEYWORDS.gis,
    ...TOPIC_KEYWORDS.geoai,
  ];
  // For AI/ML DisCo news, require an AI/ML signal AND a power/DisCo signal
  if (topic === "disco-ai") {
    const aiHit = ["artificial intelligence", "machine learning", " ai ", " ml ", "smart meter", "predictive", "analytics", "digital twin"].some((k) => blob.includes(k.trim()) || blob.includes(k));
    const powerHit = ["disco", "ikedc", "ikeja", "electric", "power", "distribution", "grid", "nerc", "tariff"].some((k) => blob.includes(k));
    return aiHit && powerHit;
  }
  return keys.some((k) => blob.includes(k.trim()));
}

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

function stripHtml(html) {
  let s = String(html || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1");
  /* Decode first so escaped markup (&lt;a…&gt;) becomes real tags, then strip */
  for (let i = 0; i < 2; i += 1) {
    s = decodeEntities(s);
    s = s.replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ");
  }
  /* Drop leftover bare URLs that were the only “summary” from Google News RSS */
  s = s.replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ").trim();
  return s;
}

function pickTag(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  return m ? stripHtml(m[1]) : "";
}

function pickLink(block) {
  // Links are URLs, not summary text: stripHtml deliberately removes URLs.
  const atomLinks = [...block.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)];
  const atom = atomLinks.find((m) => !/\brel=["'](?:self|enclosure)["']/i.test(m[0]));
  const rss = block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
  const raw = atom?.[1] || rss?.[1] || "";
  const link = decodeEntities(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")).trim();
  try {
    const url = new URL(link);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

function parseRss(xml, source, limit = 8) {
  const items = [];
  const chunks = xml.split(/<item[\s>]/i).slice(1);
  const entries = chunks.length ? chunks : xml.split(/<entry[\s>]/i).slice(1);
  for (const chunk of entries.slice(0, limit)) {
    const title = pickTag(chunk, "title");
    if (!title) continue;
    const link = pickLink(chunk);
    if (!link) continue; // Never substitute the feed listing for an article.
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
      sourceName: source.name,
      title,
      url: link,
      publishedAt: Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : null,
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
      sourceName: source.name,
      title: stripHtml(title),
      url,
      publishedAt: date ? new Date(date).toISOString() : null,
      summary: summary.slice(0, 220),
    };
  });
}

async function fetchText(url, timeoutMs = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; IKEDC-Dashboard-Feeds/1.1; +https://ikedc-2026-realignment-dashboard.vercel.app)",
        Accept: "application/rss+xml, application/xml, text/xml, application/json, */*",
        "Accept-Language": "en-NG,en;q=0.9",
      },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ok: true, text: await res.text(), contentType: res.headers.get("content-type") || "" };
  } finally {
    clearTimeout(t);
  }
}

/** Bing News wraps links in a click tracker: keep the publisher URL */
function unwrapLink(url) {
  try {
    const u = new URL(url);
    if (/(^|\.)bing\.com$/i.test(u.hostname) && u.searchParams.get("url")) {
      const inner = new URL(u.searchParams.get("url"));
      if (["http:", "https:"].includes(inner.protocol)) return inner.href;
    }
  } catch { /* keep original */ }
  return url;
}

const hasNigeriaSignal = (it) => {
  const blob = ` ${textBlob(it)} `;
  return NIGERIA_SIGNALS.some((k) => blob.includes(k));
};

/** Channel items must match the tab's keywords (if any), its topic, and Nigeria for Nigeria-only tabs */
function channelKeeps(it, source, channel) {
  /* Judge the story itself — the tab name it was filed under must not count as a match */
  it = { ...it, sourceName: "", sourceId: null };
  const blob = ` ${textBlob(it)} `;
  if (BLOCK_KEYWORDS.some((k) => blob.includes(k))) return false;
  if (channel.match?.length && !channel.match.some((k) => blob.includes(k))) return false;
  if (source.region !== "global" && channel.region !== "ng" && !hasNigeriaSignal(it)) return false;
  return isOnTopic(it, source.topic);
}

function titleKey(title) {
  return String(title || "").toLowerCase().replace(/\s+[-–|]\s+[^-–|]+$/, "").replace(/[^a-z0-9]+/g, " ").trim().slice(0, 90);
}

/** Recent posts from the official X API v2 (needs X_BEARER_TOKEN on the deployment) */
async function loadXPool(pool) {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) return { configured: false, items: [] };
  const hit = xCache.get(pool);
  if (hit && Date.now() - hit.at < X_CACHE_TTL_MS) return hit.value;
  const params = new URLSearchParams({
    query: X_QUERIES[pool],
    max_results: "50",
    "tweet.fields": "created_at,lang",
    expansions: "author_id",
    "user.fields": "username,name,verified",
  });
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(`https://api.x.com/2/tweets/search/recent?${params}`, {
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`X API HTTP ${res.status}`);
    const data = await res.json();
    const users = new Map((data.includes?.users || []).map((u) => [u.id, u]));
    const items = (data.data || []).map((tw) => {
      const user = users.get(tw.author_id) || {};
      const text = stripHtml(tw.text);
      return {
        id: `x-${tw.id}`,
        title: text.length > 180 ? `${text.slice(0, 177)}…` : text,
        url: `https://x.com/${user.username || "i"}/status/${tw.id}`,
        publishedAt: tw.created_at || null,
        summary: text.slice(0, 220),
        handle: user.username ? `@${user.username}` : "",
      };
    }).filter((it) => it.title);
    const value = { configured: true, items };
    xCache.set(pool, { at: Date.now(), value });
    return value;
  } catch (err) {
    return { configured: true, items: [], error: String(err.message || err) };
  } finally {
    clearTimeout(t);
  }
}

/** Fetch every broader channel of a tab; one outlet feed is fetched once per build and shared */
async function loadChannels(source, ctx) {
  const results = await Promise.all((source.channels || []).map(async (channel) => {
    try {
      let raw;
      if (channel.kind === "x") {
        const pool = await (ctx.x[channel.pool] ||= loadXPool(channel.pool));
        raw = pool.items.map((it) => ({ ...it, channelLabel: `X ${it.handle}`.trim() }));
      } else {
        const text = await (ctx.text[channel.url] ||= fetchText(channel.url, 9000).then((r) => r.text));
        raw = parseRss(text, source, 25).map((it) => ({ ...it, url: unwrapLink(it.url), channelLabel: channel.label }));
      }
      return raw.filter((it) => channelKeeps(it, source, channel)).map((it) => ({
        ...it,
        id: `${source.id}-${it.id}`,
        sourceId: source.id,
        source: source.name,
        sourceName: `${source.name} · ${it.channelLabel}`,
        topic: source.topic || null,
      }));
    } catch {
      return [];
    }
  }));
  return results.flat();
}

/** Primary source plus its broader channels, de-duplicated and newest first */
async function loadSource(source, ctx = { text: {}, x: {} }) {
  const [primary, extra] = await Promise.all([loadPrimary(source), loadChannels(source, ctx)]);
  const seen = new Set();
  const items = primary.items.concat(extra)
    .sort((a, b) => (b.publishedAt ? Date.parse(b.publishedAt) : 0) - (a.publishedAt ? Date.parse(a.publishedAt) : 0))
    .filter((it) => {
      const key = titleKey(it.title);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 16);
  return {
    ...primary,
    ok: primary.ok || extra.length > 0,
    items,
    channels: extra.length,
  };
}

async function loadPrimary(source) {
  if (source.kind === "rss") {
    const urls = source.urls?.length ? source.urls : [source.url];
    const errors = [];
    for (const url of urls) {
      try {
        const { text } = await fetchText(url);
        const items = parseRss(text, source, 12)
          .map((it) => ({ ...it, sourceName: source.name, topic: source.topic || null }))
          .filter((it) => isOnTopic(it, source.topic));
        if (items.length) {
          return {
            id: source.id,
            name: source.name,
            ok: true,
            error: null,
            items,
            via: url,
          };
        }
        errors.push(`${url}: no items`);
      } catch (err) {
        errors.push(`${url}: ${err.message || err}`);
      }
    }
    // Soft fallback: Google News query scoped to Ikeja Electric
    if (source.id === "ikeja") {
      try {
        const gUrl =
          "https://news.google.com/rss/search?q=%22Ikeja+Electric%22+OR+IKEDC&hl=en-NG&gl=NG&ceid=NG:en";
        const { text } = await fetchText(gUrl);
        const items = parseRss(text, { ...source, name: "Ikeja Electric · News" }, 8)
          .map((it) => ({
            ...it,
            source: "Ikeja Electric · News",
            sourceName: "Ikeja Electric · News",
            sourceId: "ikeja",
            topic: "electricity",
          }))
          .filter((it) => isOnTopic(it, "electricity"));
        if (items.length) {
          return {
            id: source.id,
            name: source.name,
            ok: true,
            error: `Direct RSS blocked; news fallback (${errors[0] || "fetch failed"})`,
            items,
            via: "google-news-fallback",
          };
        }
      } catch (err) {
        errors.push(`news-fallback: ${err.message || err}`);
      }
    }
    return {
      id: source.id,
      name: source.name,
      ok: false,
      error: errors.slice(0, 3).join(" | ") || "Unavailable",
      items: [],
    };
  }

  // LASERC JSON API — try known routes, then HTML media page scrape fallback
  const errors = [];
  for (const url of source.urls) {
    try {
      const { text, contentType } = await fetchText(url, 8000);
      if (/json/i.test(contentType) || text.trim().startsWith("{") || text.trim().startsWith("[")) {
        const data = JSON.parse(text);
        const items = normalizeLasercPayload(data, source)
          .map((it) => ({ ...it, topic: "electricity" }))
          .filter((it) => isOnTopic(it, "electricity"));
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
    const items = parseRss(text, { ...source, name: "LASERC · News" }, 8)
      .map((it) => ({
        ...it,
        source: "LASERC · News",
        sourceId: "laserc",
        topic: "electricity",
      }))
      .filter((it) => isOnTopic(it, "electricity"));
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
  const ctx = { text: {}, x: {} };
  const settled = await Promise.all(SOURCES.map((s) => loadSource(s, ctx)));
  const items = settled
    .flatMap((s) => s.items.map((it) => ({ ...it, topic: it.topic || s.topic || null })))
    .filter((it) => it.title)
    .filter((it) => {
      const topic = it.topic || "electricity";
      return isOnTopic(it, topic) || isOnTopic(it, null);
    })
    .sort((a, b) => {
      const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
      const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
      return tb - ta;
    })
    .slice(0, 144);

  const xPools = await Promise.all(Object.values(ctx.x));
  return {
    generatedAt: new Date().toISOString(),
    focus: ["electricity", "policy", "disco-ai", "gis", "geoai"],
    cacheTtlSec: Math.round(CACHE_TTL_MS / 1000),
    x: { configured: !!process.env.X_BEARER_TOKEN, error: xPools.find((p) => p.error)?.error || null },
    sources: settled.map(({ id, name, ok, error, via, channels }) => ({ id, name, ok, error, via: via || null, channels: channels || 0 })),
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
