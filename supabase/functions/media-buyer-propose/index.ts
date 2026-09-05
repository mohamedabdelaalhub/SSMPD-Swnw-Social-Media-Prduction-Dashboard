import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Media Buyer proposal intake — machine-to-machine ONLY (external Claude Media
// Buyer agent → media_buyer_plans/media_buyer_actions). Auth is a static
// bearer secret (MEDIA_BUYER_AGENT_TOKEN), NOT a dashboard user session —
// there is no human sitting behind this call, so platform JWT verification
// must be OFF for this function (see supabase/config.toml) and this file's
// own token check is what actually gates access. This function may ONLY
// insert rows for human review; it never calls Meta, never executes
// anything, and never returns/logs any secret.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const AGENT_TOKEN = Deno.env.get("MEDIA_BUYER_AGENT_TOKEN");

// ---------- Phase 2B: مصادقة موقّعة Ed25519 (zero-shared-secret) ----------
// شكل التوقيع القانوني (canonical signing format) — لازم يتوثق هنا حرفيًا
// عشان المشروع الخارجي (Meta/Claude) يقدر يطابقه بالظبط:
//
//   canonical_message = "<timestamp>." + sha256_hex(raw_request_body_bytes)
//
// - <timestamp>: ثانية Unix (integer كـstring)، لازم يكون في نطاق ±300
//   ثانية (٥ دقايق) من وقت السيرفر وقت الاستلام.
// - raw_request_body_bytes: البايتات الخام بالظبط للـbody اللي هيتبعت في
//   الـPOST (نفس الترتيب/المسافات اللي هيتحسب بيها الهاش لازم تتبعت
//   بالظبط، من غير أي إعادة تنسيق JSON بعد الحساب).
// - sha256_hex: هاش SHA-256 لبايتات الـbody، مُمثّل كـhex lowercase (64
//   حرف).
// - التوقيع نفسه: Ed25519 signature على بايتات UTF-8 لنص canonical_message
//   ده بالكامل (النص كنص، مش الهاش وحده)، مُرمّز base64 قياسي في الهيدر.
//
// Headers المطلوبة على الطلب الموقّع (بديل الـBearer، مش بالإضافة له):
//   X-Media-Buyer-Key-Id:    key_id اللي رجع من media-buyer-pair (register_agent)
//   X-Media-Buyer-Timestamp: نفس الـ<timestamp> المستخدم في canonical_message
//   X-Media-Buyer-Signature: التوقيع base64
//
// لو الهيدرز دي التلاتة موجودة، بيتم التحقق بيها (ويتجاهل أي Authorization
// header تماماً). لو مش موجودة، بيرجع للمسار القديم (Bearer token ثابت) —
// التوكن القديم فاضل شغال كـfallback مؤقت زي ما طلب المستخدم، لحد ما
// التوقيع يتثبت في الإنتاج من المشروع الخارجي الحقيقي.
const SIGNATURE_CLOCK_TOLERANCE_SECONDS = 300; // ±5 دقايق

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const bin = atob(b64.trim());
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

// بيتحقق من توقيع Ed25519 لطلب واحد — بيرجع {ok:true, agentId, keyId} أو
// {ok:false, code, error} — أبدًا ميرميش استثناء، عشان الاستدعاء الرئيسي
// يقدر يرجع رد HTTP نضيف في كل الحالات
async function verifySignedRequest(
  req: Request,
  rawBodyBytes: Uint8Array,
  db: ReturnType<typeof createClient>,
): Promise<{ ok: true; agentId: string; keyId: string } | { ok: false; code: string; error: string }> {
  const keyId = req.headers.get("X-Media-Buyer-Key-Id");
  const timestamp = req.headers.get("X-Media-Buyer-Timestamp");
  const signatureB64 = req.headers.get("X-Media-Buyer-Signature");

  if (!keyId || !timestamp || !signatureB64) {
    return { ok: false, code: "MISSING_SIGNATURE_HEADERS", error: "Signature headers incomplete" };
  }

  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum) || !/^\d+$/.test(timestamp)) {
    return { ok: false, code: "INVALID_TIMESTAMP", error: "X-Media-Buyer-Timestamp must be a unix-seconds integer string" };
  }
  const nowSeconds = Date.now() / 1000;
  if (Math.abs(nowSeconds - tsNum) > SIGNATURE_CLOCK_TOLERANCE_SECONDS) {
    return { ok: false, code: "TIMESTAMP_OUT_OF_RANGE", error: "Timestamp outside allowed clock window (±5 minutes)" };
  }

  const signatureBytes = base64ToBytes(signatureB64);
  if (!signatureBytes) {
    return { ok: false, code: "INVALID_SIGNATURE_ENCODING", error: "X-Media-Buyer-Signature must be valid base64" };
  }

  const { data: agent, error: agentErr } = await db
    .from("media_buyer_agents")
    .select("id, public_key, status")
    .eq("key_id", keyId)
    .maybeSingle();
  if (agentErr) return { ok: false, code: "SERVER_ERROR", error: "Agent lookup failed" };
  if (!agent) return { ok: false, code: "UNKNOWN_AGENT", error: "No agent registered for this key_id" };
  if (agent.status !== "active") return { ok: false, code: "AGENT_REVOKED", error: "Agent is not active" };

  const publicKeyBytes = base64ToBytes(agent.public_key as string);
  if (!publicKeyBytes || publicKeyBytes.length !== 32) {
    return { ok: false, code: "SERVER_ERROR", error: "Stored public key is malformed" };
  }
  let publicKey: CryptoKey;
  try {
    publicKey = await crypto.subtle.importKey("raw", publicKeyBytes, { name: "Ed25519" }, false, ["verify"]);
  } catch {
    return { ok: false, code: "SERVER_ERROR", error: "Stored public key could not be imported" };
  }

  const bodyHashHex = await sha256Hex(rawBodyBytes);
  const canonicalMessage = timestamp + "." + bodyHashHex;
  const canonicalBytes = new TextEncoder().encode(canonicalMessage);

  let valid = false;
  try {
    valid = await crypto.subtle.verify("Ed25519", publicKey, signatureBytes, canonicalBytes);
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, code: "INVALID_SIGNATURE", error: "Signature verification failed" };

  // تحديث last_seen_at — best-effort، فشلها ميمنعش الطلب من النجاح
  db.from("media_buyer_agents").update({ last_seen_at: new Date().toISOString() }).eq("id", agent.id)
    .then(() => {}, () => {});

  return { ok: true, agentId: agent.id as string, keyId };
}

// مفتاح الأدمن السيرفري: نفضّل ميكانيزم الـsecret keys الحالي
// (SUPABASE_SECRET_KEYS — JSON فيها {"default": "..."}) لو موجود، ولو مش
// موجود نرجع للمفتاح القديم SUPABASE_SERVICE_ROLE_KEY (توافق قديم). لو
// الاتنين مش موجودين، الدالة تفشل بأمان (fail closed) بدل ما تكسر بغموض.
// السر ده أبدًا ميتسجلش ولا يترجع في أي رد.
function getServiceRoleKey(): string | null {
  const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeysRaw) {
    try {
      const parsed = JSON.parse(secretKeysRaw);
      if (parsed && typeof parsed === "object" && typeof parsed["default"] === "string" && parsed["default"]) {
        return parsed["default"];
      }
    } catch {
      // JSON غير صالح — نتجاهله ونكمل على المفتاح القديم بدل ما نرمي خطأ غامض
    }
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  return null;
}
const SERVICE_ROLE_KEY = getServiceRoleKey();

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function fail(code: string, error: string, status = 400) {
  return json({ ok: false, code, error }, status);
}

const MAX_SHORT = 200;
const MAX_LONG = 4000;
const CONFIDENCE_VALUES = ["low", "medium", "high"];
const ACTION_TYPES = [
  "create_campaign", "create_adset", "create_ad",
  "increase_budget", "decrease_budget",
  "pause_campaign", "pause_adset", "pause_ad",
  "resume_campaign", "resume_adset", "resume_ad",
];
const TARGET_TYPES = ["campaign", "adset", "ad"];
const RECOMMENDATION_TYPES = ["scale", "hold", "retest", "pause", "create"];
// أنواع action_type اللي بتعدّل كائن Meta موجود بالفعل — لازم target_platform_id حقيقي
const REQUIRES_TARGET_ID = [
  "increase_budget", "decrease_budget",
  "pause_campaign", "pause_adset", "pause_ad",
  "resume_campaign", "resume_adset", "resume_ad",
];
const CREATE_TYPES = ["create_campaign", "create_adset", "create_ad"];
// target_type لازم يطابق نوع الكائن اللي action_type بيتحكم فيه فعليًا —
// مفيش تناقض زي pause_ad + target_type=campaign. بالنسبة لـincrease/decrease
// budget مفيش قيمة واحدة ثابتة (ميزانية ممكن تتضبط على مستوى campaign أو
// adset) فهي متعالجة بمنطق منفصل تحت.
const TARGET_TYPE_FOR_ACTION: Record<string, string> = {
  create_campaign: "campaign", create_adset: "adset", create_ad: "ad",
  pause_campaign: "campaign", resume_campaign: "campaign",
  pause_adset: "adset", resume_adset: "adset",
  pause_ad: "ad", resume_ad: "ad",
};
const BUDGET_ACTION_TYPES = ["increase_budget", "decrease_budget"];

// السماحية الصريحة للحقول اللي الوكيل الخارجي يقدر يبعتها — أي حقل تاني
// (بما فيه أي حقل محمي زي status/proposed_by/approved_by/...) بيترفض
// فورًا بـVALIDATION_ERROR قبل حتى ما نوصله. الحقول المحمية أصلاً مش متضمنة
// هنا، فمفيش داعي نستثنيها صراحة.
const ALLOWED_PLAN_KEYS = new Set([
  "type", "external_request_id", "title", "objective", "brand", "specialty",
  "content_item_id", "creative_group_id", "daily_budget", "total_budget",
  "currency", "start_date", "end_date", "targeting_summary", "strategy_summary",
  "rationale", "agent_confidence",
]);
const ALLOWED_ACTION_KEYS = new Set([
  "type", "external_request_id", "action_type", "recommendation_type",
  "target_type", "target_platform_id", "proposed_payload", "reason",
  "metrics_snapshot", "plan_id",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isStr(v: unknown): v is string { return typeof v === "string"; }
function strOk(v: unknown, maxLen: number): boolean { return v == null || (isStr(v) && v.length <= maxLen); }
function numOk(v: unknown): boolean { return v == null || (typeof v === "number" && isFinite(v)); }
function dateOk(v: unknown): boolean { return v == null || (isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v)); }
function isUuid(v: unknown): boolean { return isStr(v) && UUID_RE.test(v); }

function findUnknownKey(body: Record<string, unknown>, allowed: Set<string>): string | null {
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) return k;
  }
  return null;
}

function logSafe(entry: Record<string, unknown>) {
  // بس metadata تشغيلية آمنة — أبدًا التوكن/الـservice_role/أي secret
  console.log(JSON.stringify(entry));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return fail("METHOD_NOT_ALLOWED", "POST only", 405);

  // مفتاح الأدمن السيرفري لازم يكون موجود قبل أي عملية قاعدة بيانات —
  // fail closed لو مفيش، مش نكمل بمفتاح فاضي/undefined
  if (!SERVICE_ROLE_KEY) {
    logSafe({ event: "media_buyer_propose_misconfigured", reason: "no_admin_key" });
    return fail("MISCONFIGURED", "Server database key not configured", 500);
  }
  const db0 = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // ---------- Auth: توقيع Ed25519 (Phase 2B) أو bearer secret ثابت (fallback) ----------
  // ملحوظة نشر: لازم verify_jwt=false على مستوى المنصة لهذه الدالة (راجع
  // supabase/config.toml) — بدون كده Supabase هيرفض الطلب قبل ما يوصل هنا
  // خالص لأنه مش JWT حقيقي. التحقق الفعلي من الهوية لسه بيحصل هنا بالكامل.
  //
  // بنقرا الـbody كـraw text مرة واحدة بس (لازم للتحقق من التوقيع، اللي
  // بيهاش بايتات الـbody الخام بالظبط) — الـJSON.parse بيحصل بعد كده على
  // نفس النص، مش على body تاني.
  let rawBodyText: string;
  try {
    rawBodyText = await req.text();
  } catch {
    return fail("VALIDATION_ERROR", "Could not read request body");
  }
  const rawBodyBytes = new TextEncoder().encode(rawBodyText);

  const hasSignatureHeaders = !!(
    req.headers.get("X-Media-Buyer-Key-Id") &&
    req.headers.get("X-Media-Buyer-Timestamp") &&
    req.headers.get("X-Media-Buyer-Signature")
  );

  if (hasSignatureHeaders) {
    const verified = await verifySignedRequest(req, rawBodyBytes, db0);
    if (!verified.ok) {
      logSafe({ event: "media_buyer_propose_signature_rejected", code: verified.code });
      return fail(verified.code, verified.error, 401);
    }
    logSafe({ event: "media_buyer_propose_signature_ok", key_id: verified.keyId });
  } else {
    if (!AGENT_TOKEN) {
      // السر مش متظبط في Supabase أصلاً — نرفض بأمان بدل ما نقبل أي حد
      logSafe({ event: "media_buyer_propose_misconfigured", reason: "no_agent_token" });
      return fail("MISCONFIGURED", "Agent token not configured", 401);
    }
    const authHeader = req.headers.get("Authorization") || "";
    const m = /^Bearer\s+(.+)$/.exec(authHeader);
    if (!m || m[1] !== AGENT_TOKEN) {
      logSafe({ event: "media_buyer_propose_unauthorized" });
      return new Response(null, { status: 401, headers: CORS });
    }
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBodyText);
  } catch {
    return fail("VALIDATION_ERROR", "Invalid JSON body");
  }

  const type = body.type;
  if (type !== "plan" && type !== "action") {
    return fail("VALIDATION_ERROR", 'type must be "plan" or "action"');
  }

  const externalRequestId = body.external_request_id;
  if (!isStr(externalRequestId) || !externalRequestId.trim() || externalRequestId.length > MAX_SHORT) {
    return fail("VALIDATION_ERROR", "external_request_id is required (non-empty string)");
  }

  // سماحية صريحة لحقول الطلب — أي حقل غير متوقع (بما فيه أي محاولة لبعت
  // حقل محمي زي status/proposed_by/approved_by/...) بيترفض هنا قبل أي شغل تاني
  const badKey = findUnknownKey(body, type === "plan" ? ALLOWED_PLAN_KEYS : ALLOWED_ACTION_KEYS);
  if (badKey) {
    return fail("VALIDATION_ERROR", `Unknown or unsupported field: ${badKey}`);
  }

  const db = db0;

  // نفس الحقل external_request_id بيبقى unique بين النوعين (فهرسين منفصلين
  // على الجدولين) — نتأكد الأول لو الطلب ده اتعمل قبل كده (idempotency)
  const table = type === "plan" ? "media_buyer_plans" : "media_buyer_actions";
  const { data: existing, error: existingErr } = await db
    .from(table).select("id, status").eq("external_request_id", externalRequestId).maybeSingle();
  if (existingErr) {
    logSafe({ event: "media_buyer_propose_lookup_error", type });
    return fail("SERVER_ERROR", "Lookup failed", 500);
  }
  if (existing) {
    logSafe({ event: "media_buyer_propose_duplicate", type, external_request_id: externalRequestId, id: existing.id });
    return json({ ok: true, type, id: existing.id, status: existing.status, duplicate: true });
  }

  if (type === "plan") return handlePlan(db, body, externalRequestId);
  return handleAction(db, body, externalRequestId);
});

async function handlePlan(db: ReturnType<typeof createClient>, body: Record<string, unknown>, externalRequestId: string) {
  const title = body.title;
  if (!isStr(title) || !title.trim() || title.length > MAX_SHORT) {
    return fail("VALIDATION_ERROR", "title is required (non-empty string)");
  }
  const objective = body.objective;
  if (!isStr(objective) || !objective.trim() || objective.length > MAX_SHORT) {
    return fail("VALIDATION_ERROR", "objective is required (non-empty string)");
  }
  if (!strOk(body.brand, MAX_SHORT)) return fail("VALIDATION_ERROR", "brand too long");
  if (!strOk(body.specialty, MAX_SHORT)) return fail("VALIDATION_ERROR", "specialty too long");
  if (!strOk(body.creative_group_id, MAX_SHORT)) return fail("VALIDATION_ERROR", "creative_group_id too long");
  if (!strOk(body.targeting_summary, MAX_LONG)) return fail("VALIDATION_ERROR", "targeting_summary too long");
  if (!strOk(body.strategy_summary, MAX_LONG)) return fail("VALIDATION_ERROR", "strategy_summary too long");
  if (!strOk(body.rationale, MAX_LONG)) return fail("VALIDATION_ERROR", "rationale too long");
  if (!numOk(body.daily_budget) || (typeof body.daily_budget === "number" && body.daily_budget < 0)) {
    return fail("VALIDATION_ERROR", "daily_budget must be a non-negative number");
  }
  if (!numOk(body.total_budget) || (typeof body.total_budget === "number" && body.total_budget < 0)) {
    return fail("VALIDATION_ERROR", "total_budget must be a non-negative number");
  }
  if (!dateOk(body.start_date) || !dateOk(body.end_date)) {
    return fail("VALIDATION_ERROR", "start_date/end_date must be YYYY-MM-DD");
  }
  if (isStr(body.start_date) && isStr(body.end_date) && body.end_date < body.start_date) {
    return fail("VALIDATION_ERROR", "end_date must be >= start_date");
  }
  const currency = strOk(body.currency, 10) && isStr(body.currency) && body.currency.trim() ? body.currency : "EGP";
  const confidence = body.agent_confidence;
  if (confidence != null && !CONFIDENCE_VALUES.includes(confidence as string)) {
    return fail("VALIDATION_ERROR", "agent_confidence must be low/medium/high");
  }

  // مفيش تخمين — content_item_id لازم يكون UUID صالح الشكل ويتفحص وجوده
  // فعليًا لو اتبعت، وإلا الخطة ترفض بالكامل. شكل غلط (مش UUID) بيترفض
  // فورًا بـ400 VALIDATION_ERROR من غير ما نوصل لاستعلام قاعدة بيانات
  // (ده كان ممكن يرمي خطأ Postgres/500 بدل رد واضح).
  const contentItemId = body.content_item_id;
  if (contentItemId != null) {
    if (!isUuid(contentItemId)) return fail("VALIDATION_ERROR", "content_item_id must be a valid UUID");
    const { data: ci, error: ciErr } = await db.from("content_items").select("id").eq("id", contentItemId).maybeSingle();
    if (ciErr) return fail("SERVER_ERROR", "content_item lookup failed", 500);
    if (!ci) return fail("VALIDATION_ERROR", "content_item_id does not exist");
  }

  // القيم دي إجبارية server-side — أي قيمة يبعتها الـcaller ليها بتتجاهل تمامًا (مش حتى بتتقرا هنا)
  const row = {
    external_request_id: externalRequestId,
    title, objective,
    brand: body.brand ?? null,
    specialty: body.specialty ?? null,
    content_item_id: contentItemId ?? null,
    creative_group_id: body.creative_group_id ?? null,
    daily_budget: body.daily_budget ?? null,
    total_budget: body.total_budget ?? null,
    currency,
    start_date: body.start_date ?? null,
    end_date: body.end_date ?? null,
    targeting_summary: body.targeting_summary ?? null,
    strategy_summary: body.strategy_summary ?? null,
    rationale: body.rationale ?? null,
    agent_confidence: confidence ?? null,
    status: "pending_approval",
    proposed_by: "claude_media_buyer",
  };

  const { data, error } = await db.from("media_buyer_plans").insert(row).select("id, status").single();
  if (error) {
    // unique violation على external_request_id يعني سباق (race) مع نداء متزامن — نعامله كـidempotent replay
    if ((error as { code?: string }).code === "23505") {
      const { data: again } = await db.from("media_buyer_plans").select("id, status").eq("external_request_id", externalRequestId).maybeSingle();
      if (again) return json({ ok: true, type: "plan", id: again.id, status: again.status, duplicate: true });
    }
    logSafe({ event: "media_buyer_propose_insert_error", type: "plan" });
    return fail("SERVER_ERROR", "Insert failed", 500);
  }
  logSafe({ event: "media_buyer_propose_inserted", type: "plan", external_request_id: externalRequestId, id: data.id });
  return json({ ok: true, type: "plan", id: data.id, status: data.status, duplicate: false });
}

async function handleAction(db: ReturnType<typeof createClient>, body: Record<string, unknown>, externalRequestId: string) {
  const actionType = body.action_type;
  const recommendationType = body.recommendation_type;
  if (actionType != null && !ACTION_TYPES.includes(actionType as string)) {
    return fail("VALIDATION_ERROR", "invalid action_type");
  }
  if (recommendationType != null && !RECOMMENDATION_TYPES.includes(recommendationType as string)) {
    return fail("VALIDATION_ERROR", "invalid recommendation_type");
  }
  if (actionType == null && recommendationType == null) {
    return fail("VALIDATION_ERROR", "at least one of action_type/recommendation_type is required");
  }
  // HOLD/RETEST توصيات استشارية بس — ممنوع تُمثَّل بـaction_type تنفيذي وهمي
  if ((recommendationType === "hold" || recommendationType === "retest") && actionType != null) {
    return fail("VALIDATION_ERROR", "hold/retest recommendations must not carry an executable action_type");
  }

  let targetType = body.target_type;
  if (targetType != null && !TARGET_TYPES.includes(targetType as string)) {
    return fail("VALIDATION_ERROR", "target_type must be campaign/adset/ad");
  }
  const targetPlatformId = body.target_platform_id;
  if (!strOk(targetPlatformId, MAX_SHORT)) return fail("VALIDATION_ERROR", "target_platform_id too long");

  // كل action_type بيعدّل/بينشئ كائن Meta لازم target_type متسق معاه —
  // مفيش تناقض زي pause_ad + target_type=campaign. لو target_type مش
  // متبعت، نستنتجه سيرفريًا من action_type (create_*/pause_*/resume_*)
  // بدل ما نرفض — لكن لو اتبعت وبيتعارض مع الـaction_type بنرفض فورًا.
  if (actionType != null) {
    if (BUDGET_ACTION_TYPES.includes(actionType as string)) {
      // ميزانية ممكن تتضبط campaign أو adset — مفيش قيمة واحدة تُستنتج
      if (targetType == null) {
        return fail("VALIDATION_ERROR", `${actionType} requires target_type (campaign or adset)`);
      }
      if (targetType !== "campaign" && targetType !== "adset") {
        return fail("VALIDATION_ERROR", `${actionType} target_type must be campaign or adset`);
      }
    } else if (TARGET_TYPE_FOR_ACTION[actionType as string]) {
      const expected = TARGET_TYPE_FOR_ACTION[actionType as string];
      if (targetType == null) {
        targetType = expected; // استنتاج سيرفري (مثال: create_ad → ad)
      } else if (targetType !== expected) {
        return fail("VALIDATION_ERROR", `${actionType} requires target_type=${expected}, got ${targetType}`);
      }
    }
  }

  // كل action_type بيعدّل كائن Meta موجود بالفعل لازم target_platform_id حقيقي —
  // مفيش تنفيذ فعلي هنا خالص، بس لازم نمنع اقتراح "عدّل حاجة" من غير تحديد الحاجة دي
  if (actionType != null && REQUIRES_TARGET_ID.includes(actionType as string)) {
    if (!isStr(targetPlatformId) || !targetPlatformId.trim()) {
      return fail("VALIDATION_ERROR", `${actionType} requires a non-empty target_platform_id`);
    }
  }
  if (actionType != null && CREATE_TYPES.includes(actionType as string)) {
    const payload = body.proposed_payload;
    if (payload == null || typeof payload !== "object" || Array.isArray(payload) || !Object.keys(payload as object).length) {
      return fail("VALIDATION_ERROR", `${actionType} requires a non-empty proposed_payload describing the intended creation`);
    }
  }

  if (!strOk(body.reason, MAX_LONG)) return fail("VALIDATION_ERROR", "reason too long");
  const proposedPayload = body.proposed_payload;
  if (proposedPayload != null && (typeof proposedPayload !== "object" || Array.isArray(proposedPayload))) {
    return fail("VALIDATION_ERROR", "proposed_payload must be a JSON object");
  }
  const metricsSnapshot = body.metrics_snapshot;
  if (metricsSnapshot != null && (typeof metricsSnapshot !== "object" || Array.isArray(metricsSnapshot))) {
    return fail("VALIDATION_ERROR", "metrics_snapshot must be a JSON object");
  }

  // plan_id لازم يكون UUID صالح الشكل قبل ما نستخدمه في استعلام — شكل غلط
  // بيترفض بـ400 VALIDATION_ERROR بدل خطأ Postgres/500
  const planId = body.plan_id;
  if (planId != null) {
    if (!isUuid(planId)) return fail("VALIDATION_ERROR", "plan_id must be a valid UUID");
    const { data: p, error: pErr } = await db.from("media_buyer_plans").select("id").eq("id", planId).maybeSingle();
    if (pErr) return fail("SERVER_ERROR", "plan lookup failed", 500);
    if (!p) return fail("VALIDATION_ERROR", "plan_id does not exist");
  }

  const row = {
    external_request_id: externalRequestId,
    plan_id: planId ?? null,
    action_type: actionType ?? null,
    recommendation_type: recommendationType ?? null,
    target_type: targetType ?? null,
    target_platform_id: targetPlatformId ?? null,
    proposed_payload: proposedPayload ?? null,
    reason: body.reason ?? null,
    metrics_snapshot: metricsSnapshot ?? null,
    status: "proposed",
    proposed_by: "claude_media_buyer",
  };

  const { data, error } = await db.from("media_buyer_actions").insert(row).select("id, status").single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      const { data: again } = await db.from("media_buyer_actions").select("id, status").eq("external_request_id", externalRequestId).maybeSingle();
      if (again) return json({ ok: true, type: "action", id: again.id, status: again.status, duplicate: true });
    }
    logSafe({ event: "media_buyer_propose_insert_error", type: "action" });
    return fail("SERVER_ERROR", "Insert failed", 500);
  }
  logSafe({ event: "media_buyer_propose_inserted", type: "action", external_request_id: externalRequestId, id: data.id });
  return json({ ok: true, type: "action", id: data.id, status: data.status, duplicate: false });
}
