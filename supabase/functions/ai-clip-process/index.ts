// توليد لقطات فيديو آلياً بـ Gemini (Veo) وحفظها على Google Drive (ماتيريال / لقطات Gemini).
//
// بتتنادى كل دقيقة من pg_cron (X-Cron-Secret) أو من الداشبورد بتوكن سوبر أدمن/مدير عام (action: "probe" | "run").
// كل مرة:
//   1) متابعة الطلبات المبعوتة: لو Veo خلّص → ننزّل الفيديو → نبعته لجسر الدرايف (مع sha256) → نسجّل الرابط.
//   2) طلبات جديدة: نتأكد إن الجسر محدّث، ونتأكد من الميزانية الشهرية بالجنيه، ونكتب الوصف (Gemini نصي)، ونبعت لـ Veo.
// الميزانية: ai_clip_settings.monthly_budget_egp وسعر الصرف usd_to_egp؛ لو الباقي مش كفاية الطلب بيتسجل "skipped_budget" ومفيش أي تكلفة.
// أي فشل بيتسجل على الطلب نفسه ومبيوقفش باقي الطلبات.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { budgetDecision, bytesToBase64, classifyApiError, cleanPrompt, costUsd, extractError, extractVideoUri, fallbackPrompt, pickTextModel, promptRequest } from "./lib.mjs";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const CRON_SECRET = Deno.env.get("META_PUBLISH_CRON_SECRET");
const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY");
const DRIVE_BRIDGE_URL = Deno.env.get("DRIVE_BRIDGE_URL") ||
  "https://script.google.com/macros/s/AKfycbzEs73BE101-gIlSx_qwdF625nSalQ2i6mob7mGqH3oN4x40NlZoowjNta3KtKaXYjTYA/exec";
const API = "https://generativelanguage.googleapis.com/v1beta";
const MAX_BYTES = 34 * 1024 * 1024; // حد جسر الدرايف 35MB
const TIME_BUDGET_MS = 110_000;
const MAX_ATTEMPTS = 3;
const SUBMIT_TIMEOUT_MIN = 25;
const MAX_SUBMITS_PER_RUN = 2;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function isManager(req: Request): Promise<boolean> {
  const authorization = req.headers.get("Authorization");
  if (!authorization) return false;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return false;
  const { data } = await admin.from("admins").select("role, active").eq("user_id", user.id).eq("active", true).maybeSingle();
  return !!data && ["super_admin", "general_manager"].includes((data as { role: string }).role);
}

async function gemini(path: string, init: RequestInit = {}) {
  const res = await fetch(API + path, { ...init, headers: { "x-goog-api-key": GEMINI_KEY!, "Content-Type": "application/json", ...(init.headers || {}) } });
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

let textModel: string | null = null;
async function getTextModel() {
  if (textModel) return textModel;
  const { res, body } = await gemini("/models?pageSize=200");
  textModel = res.ok ? pickTextModel(body.models || []) : "gemini-2.5-flash";
  return textModel;
}

async function bridgeReady(): Promise<boolean> {
  try {
    const r = await fetch(DRIVE_BRIDGE_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "material_library", probe: true }) });
    const j = await r.json().catch(() => null);
    return !!j?.ok && j.probe === true;
  } catch (_) { return false; }
}

async function sha256Hex(bytes: Uint8Array) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Job = { id: string; content_id: string | null; title: string; source: string; status: string; prompt: string | null; model: string; seconds: number; operation_name: string | null; attempts: number; created_at: string; est_cost_usd: number | null };

async function fail(job: Job, text: string, status = "failed") {
  await admin.from("ai_clip_jobs").update({ status, error: text.slice(0, 400), updated_at: new Date().toISOString() }).eq("id", job.id);
}

async function finishDownload(job: Job, uri: string, settings: Record<string, unknown>) {
  const dl = await fetch(uri, { headers: { "x-goog-api-key": GEMINI_KEY! }, redirect: "follow" });
  if (!dl.ok) throw new Error("تعذّر تنزيل الفيديو من جوجل: HTTP " + dl.status);
  const bytes = new Uint8Array(await dl.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error("حجم الفيديو غير مناسب للجسر: " + bytes.length);
  const sha256 = await sha256Hex(bytes);
  const stamp = new Date().toISOString().slice(0, 10);
  const res = await fetch(DRIVE_BRIDGE_URL, {
    method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      action: "material_library", section: "ai_clips", fileName: `clip-${stamp}-${job.id.slice(0, 8)}.mp4`, mimeType: "video/mp4",
      sha256, base64: bytesToBase64(bytes), description: `Gemini ${job.model} | job ${job.id} | content ${job.content_id || "-"} | ${job.title}`,
    }),
  });
  const result = await res.json().catch(() => null);
  if (!res.ok || !result?.ok || typeof result.fileUrl !== "string") throw new Error("جسر الدرايف رفض الملف: " + String(result?.error || res.status).slice(0, 160));
  await admin.from("ai_clip_jobs").update({ status: "done", drive_file_id: result.fileId || null, drive_url: result.fileUrl, error: null, completed_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id);
  void settings;
}

async function poll(job: Job, settings: Record<string, unknown>) {
  const { res, body } = await gemini("/" + job.operation_name);
  if (!res.ok) {
    const c = classifyApiError(res.status, body?.error?.message);
    if (!c.retry) await fail(job, c.text);
    return "pending";
  }
  if (!body.done) {
    if (Date.now() - new Date(job.created_at).getTime() > SUBMIT_TIMEOUT_MIN * 60_000) { await fail(job, "انتهت مهلة التوليد عند جوجل"); return "failed"; }
    return "pending";
  }
  const err = extractError(body);
  if (err) { await fail(job, err); return "failed"; }
  const uri = extractVideoUri(body);
  if (!uri) { await fail(job, "جوجل رجّع نتيجة من غير فيديو"); return "failed"; }
  try { await finishDownload(job, uri, settings); return "done"; }
  catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // الفيديو بيفضل متاح على جوجل يومين: نعيد المحاولة من غير ما نولّد (ومن غير تكلفة جديدة)
    if (Date.now() - new Date(job.created_at).getTime() > 36 * 3600_000) await fail(job, msg); else await admin.from("ai_clip_jobs").update({ error: msg.slice(0, 300), updated_at: new Date().toISOString() }).eq("id", job.id);
    return "retry_download";
  }
}

async function writePrompt(job: Job) {
  if (job.prompt) return job.prompt;
  let item: Record<string, unknown> | null = null;
  if (job.content_id) {
    const r = await admin.from("content_items").select("title, brand, hook_text, script_text, body").eq("id", job.content_id).maybeSingle();
    item = r.data as Record<string, unknown> | null;
  }
  const base = item ?? { title: job.title };
  try {
    const model = await getTextModel();
    const { res, body } = await gemini(`/models/${model}:generateContent`, { method: "POST", body: JSON.stringify({ contents: [{ parts: [{ text: promptRequest(base) }] }] }) });
    if (!res.ok) return fallbackPrompt(base);
    return cleanPrompt(body?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || "").join(" "), base);
  } catch (_) { return fallbackPrompt(base); }
}

async function submit(job: Job, settings: Record<string, unknown>, prices: Record<string, number>) {
  const estUsd = costUsd(prices, job.model, job.seconds);
  const spent = await admin.rpc("ai_clip_month_spent_egp");
  if (spent.error) throw new Error(spent.error.message);
  const decision = budgetDecision({ spentEgp: Number(spent.data), budgetEgp: Number(settings.monthly_budget_egp), estUsd, rate: Number(settings.usd_to_egp) });
  if (!decision.ok) { await fail(job, `الحد الشهري خلص: الباقي ${decision.remaining} ج.م والتكلفة المتوقعة ${decision.estEgp} ج.م`, "skipped_budget"); return "skipped_budget"; }
  const prompt = await writePrompt(job);
  const { res, body } = await gemini(`/models/${job.model}:predictLongRunning`, {
    method: "POST",
    body: JSON.stringify({ instances: [{ prompt }], parameters: { aspectRatio: settings.aspect_ratio, durationSeconds: job.seconds, resolution: settings.resolution } }),
  });
  if (!res.ok || !body?.name) {
    const c = classifyApiError(res.status, body?.error?.message);
    const attempts = job.attempts + 1;
    if (!c.retry || attempts >= MAX_ATTEMPTS) await fail(job, c.text);
    else await admin.from("ai_clip_jobs").update({ attempts, error: c.text.slice(0, 300), next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id);
    return "error";
  }
  await admin.from("ai_clip_jobs").update({
    status: "submitted", prompt, operation_name: body.name, est_cost_usd: estUsd, usd_to_egp_at_submit: Number(settings.usd_to_egp),
    attempts: job.attempts + 1, error: null, updated_at: new Date().toISOString(),
  }).eq("id", job.id);
  return "submitted";
}

async function probe() {
  const out: Record<string, unknown> = { ok: true, key_present: !!GEMINI_KEY };
  if (!GEMINI_KEY) return { ...out, ok: false, error: "GEMINI_API_KEY غير موجود في أسرار Supabase" };
  const { res, body } = await gemini("/models?pageSize=200");
  out.models_status = res.status;
  if (!res.ok) return { ...out, ok: false, error: body?.error?.message || "فشل الاتصال بجوجل" };
  const models = (body.models || []) as { name: string }[];
  out.veo = models.filter((m) => /veo/i.test(m.name)).map((m) => m.name);
  out.text_model = pickTextModel(body.models || []);
  out.bridge_ready = await bridgeReady();
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);
  const cron = !!CRON_SECRET && req.headers.get("X-Cron-Secret") === CRON_SECRET;
  if (!cron && !(await isManager(req))) return json({ ok: false, error: "unauthorized" }, 401);
  const body = await req.json().catch(() => ({})) as { action?: string };
  if (body.action === "probe") return json(await probe());
  if (!GEMINI_KEY) return json({ ok: false, error: "GEMINI_API_KEY غير موجود في أسرار Supabase" }, 500);

  const started = Date.now();
  const left = () => TIME_BUDGET_MS - (Date.now() - started);
  const report = { ok: true, polled: [] as unknown[], submitted: [] as unknown[], skipped: "" };

  const settingsRes = await admin.from("ai_clip_settings").select("*").limit(1).maybeSingle();
  const settings = settingsRes.data as Record<string, unknown> | null;
  if (!settings) return json({ ok: false, error: "لا توجد إعدادات" }, 500);
  const priceRows = await admin.from("ai_clip_prices").select("model, usd_per_second");
  const prices: Record<string, number> = {};
  for (const r of (priceRows.data || []) as { model: string; usd_per_second: number }[]) prices[r.model] = Number(r.usd_per_second);

  // 1) متابعة اللي اتبعت (بتشتغل حتى لو التوليد الجديد متوقف)
  const active = await admin.from("ai_clip_jobs").select("*").eq("status", "submitted").order("updated_at").limit(6);
  for (const job of (active.data || []) as Job[]) {
    if (left() < 30_000) break;
    try { report.polled.push({ id: job.id, result: await poll(job, settings) }); }
    catch (e) { report.polled.push({ id: job.id, error: e instanceof Error ? e.message : String(e) }); }
  }

  // 2) طلبات جديدة
  if (!settings.enabled) { report.skipped = "التوليد متوقف من الإعدادات"; return json(report); }
  const queued = await admin.from("ai_clip_jobs").select("*").eq("status", "queued").lte("next_attempt_at", new Date().toISOString()).order("created_at").limit(MAX_SUBMITS_PER_RUN);
  const list = (queued.data || []) as Job[];
  if (list.length && !(await bridgeReady())) {
    // مفيش توليد (ولا تكلفة) قبل ما نتأكد إن جسر الدرايف قادر يستلم الملف
    report.skipped = "جسر الدرايف محتاج تحديث (material_library) — اللقطات مستنية";
    return json(report);
  }
  for (const job of list) {
    if (left() < 20_000) break;
    try { report.submitted.push({ id: job.id, result: await submit(job, settings, prices) }); }
    catch (e) { report.submitted.push({ id: job.id, error: e instanceof Error ? e.message : String(e) }); await admin.from("ai_clip_jobs").update({ error: String(e).slice(0, 300), attempts: job.attempts + 1, next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString() }).eq("id", job.id); }
  }
  return json(report);
});
