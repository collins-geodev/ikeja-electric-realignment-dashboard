/**
 * In-dashboard article viewer for live feeds.
 * Resolves Google News destinations and serves isolated publisher previews,
 * with a simplified article reader and explicit failure responses.
 */

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.end(JSON.stringify(body));
}

function sendHtml(res, status, html) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "private, max-age=120");
  /* Allow embedding in our dashboard iframe */
  res.setHeader("Content-Security-Policy", "frame-ancestors 'self'; sandbox allow-popups allow-popups-to-escape-sandbox");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(html);
}

function isHttpUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
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

function pickMeta(html, names) {
  for (const name of names) {
    const reProp = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["']`,
      "i"
    );
    const reProp2 = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["']`,
      "i"
    );
    const m = html.match(reProp) || html.match(reProp2);
    if (m?.[1]) return decodeEntities(m[1]).trim();
  }
  return "";
}

function absolutize(url, base) {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

const { lookup } = require("node:dns/promises");
const { isIP } = require("node:net");

function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)));
  }
  // Public IPv6 global unicast only; exclude mapped/local/transition ranges.
  return isIP(address) === 6 && /^[23]/i.test(address) &&
    !/^2001:(?:0:|db8:)/i.test(address) && !/^2002:/i.test(address);
}

async function validateTarget(value) {
  const url = new URL(value);
  if (!isHttpUrl(value) || url.username || url.password ||
      (url.port && !["80", "443"].includes(url.port))) throw new Error("Invalid publisher URL");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("Publisher URL must be a public website");
  }
}

async function fetchPage(url) {
  let current = url;
  const signal = AbortSignal.timeout(15000);
  for (let hop = 0; hop < 6; hop += 1) {
    await validateTarget(current);
    const res = await fetch(current, {
      redirect: "manual", signal,
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-NG,en;q=0.9" },
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel();
      current = absolutize(location, current);
      continue;
    }
    if (!res.ok) { await res.body?.cancel(); throw new Error("Publisher returned HTTP " + res.status); }
    const contentType = res.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      await res.body?.cancel();
      throw new Error("The publisher did not return a web page");
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of res.body) {
      bytes += chunk.length;
      if (bytes > 4 * 1024 * 1024) throw new Error("Publisher page is too large for preview");
      chunks.push(Buffer.from(chunk));
    }
    return { html: Buffer.concat(chunks).toString("utf8"), finalUrl: current, contentType };
  }
  throw new Error("Too many publisher redirects");
}

function decodedPublisher(value) {
  if (Array.isArray(value)) {
    if (value[0] === "garturlres" && isHttpUrl(value[1])) return value[1];
    for (const entry of value) {
      const url = decodedPublisher(entry);
      if (url) return url;
    }
  } else if (typeof value === "string" && value.startsWith("[")) {
    try { return decodedPublisher(JSON.parse(value)); } catch { /* not a data frame */ }
  }
  return "";
}

async function resolveGoogleArticle(id, html) {
  const timestamp = html.match(/data-n-a-ts=["'](\d+)["']/)?.[1];
  const signature = html.match(/data-n-a-sg=["']([^"']+)["']/)?.[1];
  if (!timestamp || !signature) return "";
  // Google News' redirect page provides a signed destination-resolution request.
  const context = [["en-NG", "NG", ["X", "X"], null, null, 1, 1, "NG:en", null, 1,
    null, null, null, null, null, 0, 1], "en-NG", "NG", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0];
  const payload = ["garturlreq", context, id, Number(timestamp), signature];
  const response = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je", {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(8000),
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": UA },
    body: new URLSearchParams({ "f.req": JSON.stringify([[["Fbv4je", JSON.stringify(payload), null, "generic"]]]) }),
  });
  if (!response.ok) throw new Error("Google News destination unavailable");
  const text = await response.text();
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("[")) continue;
    try {
      const publisher = decodedPublisher(JSON.parse(line));
      if (publisher && new URL(publisher).hostname !== "news.google.com") return publisher;
    } catch { /* skip framing lines */ }
  }
  return "";
}

/** Resolve only explicit publisher destinations, never unrelated links in Google navigation. */
async function resolvePublisherUrl(inputUrl) {
  const page = await fetchPage(inputUrl);
  if (new URL(page.finalUrl).hostname !== "news.google.com") return page;
  const match = page.html.match(/data-n-au=["'](https?:\/\/[^"']+)["']/i);
  if (match) return fetchPage(decodeEntities(match[1]));
  // Older Google News RSS IDs include the publisher URL directly.
  const id = new URL(inputUrl).pathname.match(/\/articles\/([^/]+)/)?.[1];
  if (id) {
    const decoded = Buffer.from(id, "base64url").toString("utf8");
    const legacy = decoded.match(/https?:\/\/[^\s<>"\x00-\x20\x7f-\uffff]+/);
    if (legacy && new URL(legacy[0]).hostname !== "news.google.com") return fetchPage(legacy[0]);
    const publisher = await resolveGoogleArticle(id, page.html);
    if (publisher) return fetchPage(publisher);
  }
  throw new Error("Google News requires opening this story on the publisher site");
}

function stripChrome(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<(nav|footer|aside|form|svg|button)[\s\S]*?<\/\1>/gi, "");
}

function extractBlocks(html) {
  const cleaned = stripChrome(html);
  const chunks = [];
  const re = /<(p|h1|h2|h3|li|blockquote)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(cleaned))) {
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    if (text.length < 40 && m[1] === "p") continue;
    if (text.length < 2) continue;
    chunks.push({ tag: m[1].toLowerCase(), text });
    if (chunks.length > 80) break;
  }
  return chunks;
}

function extractArticle(html, pageUrl) {
  const title =
    pickMeta(html, ["og:title", "twitter:title"]) ||
    (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
      .replace(/\s+/g, " ")
      .trim();
  const description = pickMeta(html, ["og:description", "twitter:description", "description"]);
  const siteName = pickMeta(html, ["og:site_name"]) || (() => {
    try { return new URL(pageUrl).hostname.replace(/^www\./, ""); } catch { return ""; }
  })();
  const byline = pickMeta(html, ["author", "article:author", "byl"]);

  let bodyHtml = "";
  const articleMatch =
    html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
    html.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
    html.match(/<(div|section)[^>]*(?:article-body|entry-content|post-content|story-body|article__body)[^>]*>([\s\S]*?)<\/\1>/i);

  if (articleMatch) {
    const raw = articleMatch[2] || articleMatch[1] || "";
    const blocks = extractBlocks(raw);
    if (blocks.length >= 2) {
      bodyHtml = blocks
        .map((b) => {
          if (b.tag === "li") return `<li>${escapeHtml(b.text)}</li>`;
          if (b.tag.startsWith("h")) return `<${b.tag}>${escapeHtml(b.text)}</${b.tag}>`;
          if (b.tag === "blockquote") return `<blockquote>${escapeHtml(b.text)}</blockquote>`;
          return `<p>${escapeHtml(b.text)}</p>`;
        })
        .join("\n");
    }
  }

  if (!bodyHtml) {
    const blocks = extractBlocks(html);
    bodyHtml = blocks
      .filter((b) => b.tag === "p" || b.tag.startsWith("h"))
      .slice(0, 40)
      .map((b) =>
        b.tag.startsWith("h")
          ? `<${b.tag}>${escapeHtml(b.text)}</${b.tag}>`
          : `<p>${escapeHtml(b.text)}</p>`
      )
      .join("\n");
  }

  if (!bodyHtml && description) {
    bodyHtml = `<p>${escapeHtml(description)}</p>`;
  }

  return {
    title: decodeEntities(title).replace(/<[^>]+>/g, "").trim() || "Article",
    byline: decodeEntities(byline).replace(/<[^>]+>/g, "").trim(),
    siteName,
    description: decodeEntities(description).replace(/<[^>]+>/g, "").trim(),
    bodyHtml,
    pageUrl,
  };
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function readerDocument(article, originalUrl) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <base href="${escapeHtml(article.pageUrl)}" />
  <title>${escapeHtml(article.title)}</title>
  <style>
    :root { color-scheme: light; }
    body {
      margin: 0;
      font: 17px/1.65 Georgia, "Times New Roman", serif;
      color: #152033;
      background: #f7f5f1;
    }
    .bar {
      position: sticky; top: 0; z-index: 2;
      display: flex; gap: 0.75rem; align-items: center; justify-content: space-between;
      padding: 0.55rem 1rem;
      background: #0f1c2e; color: #e8eef7;
      font: 600 12px/1.3 system-ui, sans-serif;
      letter-spacing: 0.04em; text-transform: uppercase;
    }
    .bar a { color: #f0b429; text-decoration: none; }
    .wrap { max-width: 720px; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; }
    .kicker { font: 600 12px/1.3 system-ui, sans-serif; letter-spacing: 0.08em;
      text-transform: uppercase; color: #6b7c90; margin: 0 0 0.5rem; }
    h1 { font: 700 1.85rem/1.25 Georgia, serif; margin: 0 0 0.65rem; }
    .meta { font: 14px/1.4 system-ui, sans-serif; color: #4a5b6e; margin: 0 0 1.4rem; }
    .body p { margin: 0 0 1rem; }
    .body h2, .body h3 { font-family: system-ui, sans-serif; margin: 1.4rem 0 0.6rem; }
    .body li { margin: 0.35rem 0; }
    .body blockquote {
      margin: 1rem 0; padding: 0.2rem 0 0.2rem 1rem;
      border-left: 3px solid #e8a317; color: #334155;
    }
    .empty { color: #6b7c90; font-family: system-ui, sans-serif; }
  </style>
</head>
<body>
  <div class="bar">
    <span>In-dashboard reader</span>
    <a href="${escapeHtml(originalUrl || article.pageUrl)}" target="_blank" rel="noopener noreferrer">Publisher site ↗</a>
  </div>
  <article class="wrap">
    <p class="kicker">${escapeHtml(article.siteName || "Live feed")}</p>
    <h1>${escapeHtml(article.title)}</h1>
    <p class="meta">${escapeHtml([article.byline, article.pageUrl].filter(Boolean).join(" · "))}</p>
    <div class="body">
      ${article.bodyHtml || `<p class="empty">Full text could not be extracted. Use Publisher site to continue reading.</p>`}
    </div>
  </article>
</body>
</html>`;
}

function prepareProxiedHtml(html, pageUrl) {
  let out = String(html || "");
  /* Kill frame-busting / CSP meta */
  out = out
    .replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, "")
    .replace(/<meta[^>]+http-equiv=["']X-Frame-Options["'][^>]*>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?(?:top\.location|frameElement|X-Frame-Options)[\s\S]*?<\/script>/gi, "");

  const baseTag = `<base href="${pageUrl.replace(/"/g, "&quot;")}">`;
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/<head[^>]*>/i, (m) => `${m}\n${baseTag}\n`);
  } else {
    out = `<!doctype html><html><head>${baseTag}</head><body>${out}</body></html>`;
  }
  return out;
}

function looksLikeArticlePage(html) {
  const textLen = stripChrome(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
  const hasPaywall = /subscribe to continue|enable cookies|verify you are human|attention required|cf-browser-verification/i.test(html);
  return textLen > 800 && !hasPaywall;
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.end();
    return;
  }
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const rawUrl = String(req.query?.url || "").trim();
  const mode = String(req.query?.view || "page").toLowerCase(); /* page | reader | json */
  if (!rawUrl || !isHttpUrl(rawUrl)) {
    sendJson(res, 400, { error: "Missing or invalid url" });
    return;
  }

  try {
    const page = new URL(rawUrl).hostname === "news.google.com"
      ? await resolvePublisherUrl(rawUrl)
      : await fetchPage(rawUrl);
    if (/subscribe to continue|verify you are human|cf-browser-verification/i.test(page.html)) {
      throw new Error("This publisher requires opening its website");
    }
    const article = extractArticle(page.html, page.finalUrl);
    res.setHeader("X-Article-Publisher", page.finalUrl);

    if (mode === "json") {
      sendJson(res, 200, {
        ok: true,
        originalUrl: rawUrl,
        publisherUrl: page.finalUrl,
        article,
      });
      return;
    }

    /* Prefer full proxied page when it looks usable; else reader document */
    const useProxy = mode === "page" && looksLikeArticlePage(page.html) && !/news\.google\.com/i.test(page.finalUrl);
    if (useProxy) {
      sendHtml(res, 200, prepareProxiedHtml(page.html, page.finalUrl));
      return;
    }

    sendHtml(res, 200, readerDocument(article, rawUrl));
  } catch (err) {
    if (mode === "json") {
      sendJson(res, 502, { ok: false, error: String(err.message || err) });
      return;
    }
    sendJson(res, 502, { ok: false, error: "Publisher preview unavailable. Open the publisher directly." });
  }
};
