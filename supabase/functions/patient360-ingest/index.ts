import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { ContractError, digestUtf8, constantTimeHex, prepareEnvelope } from "./contract.mjs";

// REVIEW-ONLY: this function is NOT deployed.
// Required deploy settings: verify_jwt=false and P360_INGEST_SCOPES_JSON.
// Secrets JSON: [{"token_sha256":"64lowercasehex","tenant":"swnw","account":"MetaPhoneNumberId","enabled":true,"expires_at":"ISO8601"}]
// Put only token hashes in config. The raw 256-bit bearer secret stays on Windows and is never committed.
const HEX = /^[0-9a-f]{64}$/;
const api = Deno.env.get("SUPABASE_URL");
function serviceKey() {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try { const key = JSON.parse(raw)?.default; if (typeof key === "string" && key) return key; }
    catch {}
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null;
}
function reply(data, status) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}
function readScopes() {
  try {
    const v = JSON.parse(Deno.env.get("P360_INGEST_SCOPES_JSON") || "null");
    if (!Array.isArray(v) || v.length < 1 || v.length > 20) return null;
    if (!v.every(s => s && HEX.test(s.token_sha256) &&
      /^[A-Za-z0-9._-]{1,64}$/.test(s.tenant) &&
      /^[A-Za-z0-9._-]{1,128}$/.test(s.account) &&
      typeof s.enabled === "boolean" && typeof s.expires_at === "string" &&
      Number.isFinite(Date.parse(s.expires_at)))) return null;
    return v;
  } catch { return null; }
}
async function caller(req) {
  const bearer = req.headers.get("Authorization") || "";
  const m = /^Bearer ([A-Za-z0-9._~-]{32,256})$/.exec(bearer);
  if (!m) return null;
  const hash = await digestUtf8(m[1]), configs = readScopes();
  if (!configs) return null;
  const found = configs.filter(s => constantTimeHex(s.token_sha256, hash));
  if (found.length !== 1 || !found[0].enabled || Date.parse(found[0].expires_at) <= Date.now()) return null;
  return { tenant: found[0].tenant, account: found[0].account };
}
Deno.serve(async req => {
  if (req.method !== "POST") return reply({ error: "POST_ONLY" }, 405);
  // Never expose a CORS policy for this server-to-server endpoint.
  const scope = await caller(req);
  if (!scope) return reply({ error: "UNAUTHORIZED" }, 401);
  if (!api || !serviceKey()) return reply({ error: "NOT_CONFIGURED" }, 503);
  const length = Number(req.headers.get("Content-Length") || 0);
  if (!Number.isFinite(length) || length > 65536) return reply({ error: "PAYLOAD_TOO_LARGE" }, 413);
  let body;
  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > 65536) return reply({ error: "PAYLOAD_TOO_LARGE" }, 413);
    body = JSON.parse(raw);
  } catch { return reply({ error: "INVALID_JSON" }, 400); }
  let args;
  try { args = await prepareEnvelope(body, scope); }
  catch (e) {
    if (e instanceof ContractError) return reply({ error: e.code }, e.http);
    return reply({ error: "INVALID_CONTRACT" }, 422);
  }
  try {
    const admin = createClient(api, serviceKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await admin.rpc("patient360_ingest_event", args);
    if (error) {
      const detail = (error.message || "");
      if (/COLLISION/.test(detail)) return reply({ error: "EVENT_CONFLICT" }, 409);
      if (/INVALID_|TOO_LONG/.test(detail)) return reply({ error: "INVALID_EVENT" }, 422);
      // Do not leak SQL, PII or DB errors to the client.
      return reply({ error: "INGEST_UNAVAILABLE" }, 503);
    }
    // The exactly-three-field ACK is part of Windows Store.flush compatibility.
    if (data?.event_key !== body.event_key || data?.digest !== body.digest || data?.committed !== true)
      return reply({ error: "ACK_MISMATCH" }, 503);
    return reply({ event_key: data.event_key, digest: data.digest, committed: true }, 200);
  } catch { return reply({ error: "INGEST_UNAVAILABLE" }, 503); }
});
