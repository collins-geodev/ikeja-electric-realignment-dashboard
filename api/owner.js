/**
 * Owner check for the dashboard Upload button.
 * Only the dashboard owner holds the passcode; the server keeps a salted PBKDF2 hash, never the passcode.
 * POST { key } -> 200 { owner: true } when the passcode matches, 401 otherwise.
 * The hash can be replaced without a code change by setting OWNER_UPLOAD_KEY_HASH in Vercel
 * (format: pbkdf2-sha256$<iterations>$<salt hex>$<hash hex>).
 */
const crypto = require("crypto");

const DEFAULT_HASH =
  "pbkdf2-sha256$210000$bf1cce716f19c7f8101ffda89b8c443a$0b92b2ec9ddffabd807dba3d6e8f79cb4fa8bb9280fb735847013fe6ffa9197b";

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}

function matches(key) {
  const [scheme, iters, salt, hash] = (process.env.OWNER_UPLOAD_KEY_HASH || DEFAULT_HASH).split("$");
  if (scheme !== "pbkdf2-sha256" || !iters || !salt || !hash) return false;
  const got = crypto.pbkdf2Sync(String(key), Buffer.from(salt, "hex"), Number(iters), 32, "sha256");
  const want = Buffer.from(hash, "hex");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { owner: false, error: "Use POST" });
  const body = await readBody(req);
  const key = typeof body.key === "string" ? body.key.trim() : "";
  if (key && key.length <= 200 && matches(key)) return send(res, 200, { owner: true });
  await new Promise((r) => setTimeout(r, 600));
  return send(res, 401, { owner: false });
};
