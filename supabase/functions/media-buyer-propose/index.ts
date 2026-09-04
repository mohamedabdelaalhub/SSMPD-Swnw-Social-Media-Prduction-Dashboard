import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Media Buyer proposal intake — machine-to-machine ONLY (external Claude Media
// Buyer agent → media_buyer_plans/media_buyer_actions). Auth is a static
// bearer secret (MEDIA_BUYER_AGENT_TOKEN), NOT a dashboard user session —
// there is no human sitting behind this call. This function may ONLY insert
// rows for human review; it never calls Meta, never executes anything, and
// never returns/logs any secret.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AGENT_TOKEN = Deno.env.get("MEDIA_BUYER_AGENT_TOKEN");

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

function isStr(v: unknown): v is string { return typeof v === "string"; }
function strOk(v: unknown, maxLen: number): boolean { return v == null || (isStr(v) && v.length <= maxLen); }
function numOk(v: unknown): boolean { return v == null || (typeof v === "number" && isFinite(v)); }
function dateOk(v: unknown): boolean { return v == null || (isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v)); }

function logSafe(entry: Record<string, unknown>) {
  // بس metadata تشغيلية آمنة — أبدًا التوكن/الـservice_role/أي secret
  console.log(JSON.stringify(entry));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return fail("METHOD_NOT_ALLOWED", "POST only", 405);

  // ---------- Auth: static bearer secret، مش جلسة مستخدم دashboard ----------
  if (!AGENT_TOKEN) {
    // السر مش متظبط في Supabase أصلاً — نرفض بأمان بدل ما نقبل أي حد
    logSafe({ event: "media_buyer_propose_misconfigured" });
    return fail("MISCONFIGURED", "Agent token not configured", 401);
  }
  const authHeader = req.headers.get("Authorization") || "";
  const m = /^Bearer\s+(.+)$/.exec(authHeader);
  if (!m || m[1] !== AGENT_TOKEN) {
    logSafe({ event: "media_buyer_propose_unauthorized" });
    return new Response(null, { status: 401, headers: CORS });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
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

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

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

  // مفيش تخمين — content_item_id لازم يتفحص وجوده فعليًا لو اتبعت، وإلا الخطة ترفض بالكامل
  const contentItemId = body.content_item_id;
  if (contentItemId != null) {
    if (!isStr(contentItemId)) return fail("VALIDATION_ERROR", "content_item_id must be a string uuid");
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

  const targetType = body.target_type;
  if (targetType != null && !TARGET_TYPES.includes(targetType as string)) {
    return fail("VALIDATION_ERROR", "target_type must be campaign/adset/ad");
  }
  const targetPlatformId = body.target_platform_id;
  if (!strOk(targetPlatformId, MAX_SHORT)) return fail("VALIDATION_ERROR", "target_platform_id too long");

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

  const planId = body.plan_id;
  if (planId != null) {
    if (!isStr(planId)) return fail("VALIDATION_ERROR", "plan_id must be a string uuid");
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
