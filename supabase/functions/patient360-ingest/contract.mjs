// Pure, testable event-contract validation. No network or patient lookups.
// This parses Windows' EXACT stored JSON strings. It never reserializes them to verify digests.
const IDENT = /^[a-zA-Z0-9._-]{1,64}$/;
const ACCOUNT = /^[a-zA-Z0-9._-]{1,128}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const META = /^[a-zA-Z0-9._:-]{4,255}$/;
const ATTEMPT = /^[0-9a-f]{32}$/;
const KIND = new Set(["inbound", "outbound_attempt", "outbound_outcome", "status"]);
const STATUS = new Set(["sent", "delivered", "read", "failed"]);
const OUTCOME = new Set(["accepted", "unconfirmed", "uncertain_or_rejected"]);

export class ContractError extends Error {
  constructor(code, http = 422) { super(code); this.code = code; this.http = http; }
}
export async function digestUtf8(s) {
  const bytes = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, "0")).join("");
}
export function constantTimeHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !HEX64.test(a) || !HEX64.test(b)) return false;
  let diff = 0;
  for (let i = 0; i < 64; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
function isObj(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
function validString(v, max) { return typeof v === "string" && v.length > 0 && v.length <= max; }
function fail(c) { throw new ContractError(c); }
function epoch(v) {
  if (v === null || v === undefined) return null;
  if (!(typeof v === "string" || typeof v === "number")) fail("INVALID_TIME");
  if (typeof v === "string" && !/^[0-9]+(?:\.[0-9]+)?$/.test(v)) fail("INVALID_TIME");
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 253402300799) fail("INVALID_TIME");
  return new Date(n * 1000).toISOString();
}
export async function prepareEnvelope(raw, scope) {
  if (!isObj(raw) || Object.keys(raw).sort().join(",") !== "digest,event_json,event_key,identity_json,schema_version") fail("INVALID_ENVELOPE");
  if (raw.schema_version !== 1) fail("UNSUPPORTED_VERSION");
  if (!HEX64.test(raw.event_key) || !HEX64.test(raw.digest) ||
      !validString(raw.identity_json, 1024) || !validString(raw.event_json, 48000)) fail("INVALID_ENVELOPE");
  if (!constantTimeHex(await digestUtf8(raw.identity_json), raw.event_key)) fail("INVALID_IDENTITY_DIGEST");
  if (!constantTimeHex(await digestUtf8(raw.event_json), raw.digest)) fail("INVALID_EVENT_DIGEST");
  let identity, e;
  try { identity = JSON.parse(raw.identity_json); e = JSON.parse(raw.event_json); } catch { fail("INVALID_JSON_PAYLOAD"); }
  if (!Array.isArray(identity) || identity.length !== 3 || !identity.every(v => typeof v === "string") || !isObj(e)) fail("INVALID_IDENTITY");
  const [tenant, account, eventKey] = identity;
  if (!IDENT.test(tenant) || !ACCOUNT.test(account) || !validString(eventKey, 400)) fail("INVALID_SCOPE");
  if (!scope || scope.tenant !== tenant || scope.account !== account) throw new ContractError("SCOPE_DENIED", 403);
  if (e.tenant !== tenant || e.account !== account || e.key !== eventKey || !KIND.has(e.kind)) fail("INVALID_EVENT_FIELDS");
  const metaId = e.meta_id;
  if (metaId !== undefined && metaId !== null && !META.test(metaId)) fail("INVALID_META_ID");
  const attempt = e.attempt_id ?? null;
  if (attempt !== null && (typeof attempt !== "string" || !ATTEMPT.test(attempt))) fail("INVALID_ATTEMPT");
  if (e.kind === "inbound" && (eventKey !== "in:" + metaId || !validString(e.contact, 128))) fail("INVALID_INBOUND");
  if (e.kind === "outbound_attempt" && (!ATTEMPT.test(attempt || "") || eventKey !== "attempt:" + attempt || !validString(e.contact, 128))) fail("INVALID_OUTBOUND_ATTEMPT");
  if (e.kind === "outbound_outcome" && (!ATTEMPT.test(attempt || "") || eventKey !== "outcome:" + attempt || !validString(e.contact, 128) || !OUTCOME.has(e.outcome) || (e.outcome === "accepted" && !META.test(metaId || "")))) fail("INVALID_OUTBOUND_OUTCOME");
  if (e.kind === "status" && (!META.test(metaId || "") || !STATUS.has(e.status) ||
      !eventKey.startsWith("status:" + metaId + ":" + e.status + ":") ||
      e.contact !== undefined || e.content !== undefined)) fail("INVALID_STATUS");
  if (e.kind !== "status" && (!isObj(e.content) || JSON.stringify(e.content).length > 32000)) fail("INVALID_CONTENT");
  if (e.kind === "status" && e.error_codes !== undefined && (!Array.isArray(e.error_codes) || e.error_codes.length > 20 || !e.error_codes.every(v => v === null || Number.isSafeInteger(v)))) fail("INVALID_ERROR_CODES");
  const occurredAt = epoch(e.at);
  const normalized = e.kind === "inbound" || (e.kind === "outbound_outcome" && e.outcome === "accepted");
  const direction = normalized ? (e.kind === "inbound" ? "inbound" : "outbound") : null;
  const content = normalized ? e.content : null;
  let body = "";
  if (content) {
    if (typeof content.text === "string") body = content.text;
    else if (typeof content.text?.body === "string") body = content.text.body;
    else if (typeof content.caption === "string") body = content.caption;
    if ([...body].length > 8000) fail("BODY_TOO_LONG");
  }
  let sourceKey = null, contactHash = null;
  if (normalized) {
    sourceKey = "p360:v1:" + await digestUtf8(JSON.stringify([tenant, account, direction, metaId]));
    contactHash = await digestUtf8(JSON.stringify([tenant, account, e.contact]));
  }
  return {
    p_event_key: raw.event_key, p_digest: raw.digest,
    p_tenant: tenant, p_account: account, p_kind: e.kind,
    p_meta_id: metaId ?? null, p_contact_hash: contactHash,
    p_source_key: sourceKey, p_direction: direction,
    p_message_type: content?.type ?? null, p_structured_content: content,
    p_body: body, p_attempt_id: attempt, p_outcome: e.outcome ?? null,
    p_status: e.status ?? null, p_error_codes: e.error_codes ?? [],
    p_occurred_at: occurredAt
  };
}
