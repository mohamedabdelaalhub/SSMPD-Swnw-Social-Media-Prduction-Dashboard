import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const GRAPH = "https://graph.facebook.com/v26.0/";
const BUCKET = "contracting-documents";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function serviceKey(): string | null {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.default === "string" && parsed.default) return parsed.default;
    } catch {}
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function normalizePhone(v: unknown) {
  let p = String(v || "").replace(/\D/g, "");
  if (/^01[0125]\d{8}$/.test(p)) p = "2" + p;
  if (/^1[0125]\d{8}$/.test(p)) p = "20" + p;
  return p;
}

function safeName(v: unknown, fallback = "SWNW-Partnership.pdf") {
  const s = String(v || fallback).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  return (s || fallback).slice(0, 140).replace(/\.pdf$/i, "") + ".pdf";
}

function base64Bytes(value: string) {
  const raw = value.replace(/^data:application\/pdf;base64,/i, "").replace(/\s/g, "");
  const binary = atob(raw);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256(bytes: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function caller(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return null;

  const key = serviceKey();
  if (!key) return null;
  const admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  const { data: row } = await admin.from("admins")
    .select("id,role,active,admin_extra_roles!admin_id(role)")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!row) return null;
  const extra = (row as unknown as { admin_extra_roles?: { role: string }[] }).admin_extra_roles || [];
  return { id: row.id as string, roles: [row.role as string, ...extra.map((x) => x.role)] };
}

function canSend(c: { roles: string[] }) {
  return c.roles.some((r) => ["contract_manager", "general_manager", "super_admin"].includes(r));
}

async function templateInfo(token: string, wabaId: string, name: string) {
  try {
    const r = await fetch(
      `${GRAPH}${encodeURIComponent(wabaId)}/message_templates?name=${encodeURIComponent(name)}&fields=id,name,status,category,language&limit=10`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) },
    );
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { error: d?.error?.message || "تعذر قراءة حالة قالب واتساب" };
    const row = Array.isArray(d?.data) ? d.data.find((x: any) => x?.name === name) : null;
    return row || null;
  } catch {
    return { error: "تعذر الاتصال بـ Meta لقراءة حالة قالب واتساب" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const c = await caller(req);
  if (!c) return json({ error: "غير مصرح — سجّل دخولك تاني" }, 401);
  if (!canSend(c)) return json({ error: "ليس لديك صلاحية إرسال مستندات التعاقدات" }, 403);

  const key = serviceKey();
  if (!key) return json({ error: "إعداد قاعدة البيانات غير مكتمل" }, 500);
  const admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });

  let b: any;
  try { b = await req.json(); } catch { return json({ error: "بيانات غير صالحة" }, 400); }

  const agreementId = String(b?.agreement_id || "");
  const recipient = String(b?.recipient || "").trim();
  const phone = normalizePhone(recipient);
  const filename = safeName(b?.filename);
  let pdfBase64 = String(b?.pdf_base64 || "")
    .replace(/^data:application\/pdf;base64,/i, "")
    .replace(/\s/g, "");

  if (!agreementId || phone.length < 10) return json({ error: "بيانات الإرسال ناقصة أو رقم واتساب غير صالح" }, 400);

  const { data: agreement } = await admin.from("contracting_agreements")
    .select("id,entity_id,document_type,version_no")
    .eq("id", agreementId)
    .maybeSingle();
  if (!agreement) return json({ error: "المستند غير موجود" }, 404);

  const { data: entity } = await admin.from("contracting_entities")
    .select("id,name")
    .eq("id", agreement.entity_id)
    .maybeSingle();
  if (!entity) return json({ error: "جهة التعاقد غير موجودة" }, 404);

  const { data: version } = await admin.from("contracting_agreement_versions")
    .select("id,version_no,file_name,pdf_url,immutable")
    .eq("agreement_id", agreement.id)
    .eq("version_no", agreement.version_no)
    .maybeSingle();
  if (!version) return json({ error: "نسخة المستند غير موجودة" }, 404);

  const { data: settings } = await admin.from("contracting_partnership_settings")
    .select("id,whatsapp_phone_number_id,whatsapp_waba_id,whatsapp_template_id,whatsapp_template_name,whatsapp_template_language")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const phoneNumberId = String(settings?.whatsapp_phone_number_id || "").trim();
  const wabaId = String(settings?.whatsapp_waba_id || "").trim();
  const templateName = String(settings?.whatsapp_template_name || "").trim();
  const templateLanguage = String(settings?.whatsapp_template_language || "ar").trim() || "ar";
  const token = Deno.env.get("WHATSAPP_TOKEN") || "";

  if (!token || !/^\d+$/.test(phoneNumberId) || !/^\d+$/.test(wabaId) || !templateName) {
    return json({ error: "إعداد قالب واتساب للتعاقدات غير مكتمل", code: "WHATSAPP_TEMPLATE_NOT_CONFIGURED" }, 503);
  }

  const info: any = await templateInfo(token, wabaId, templateName);
  if (info?.error) return json({ error: info.error, code: "WHATSAPP_TEMPLATE_LOOKUP_FAILED" }, 502);
  if (!info) return json({ error: "قالب واتساب الخاص بالتعاقدات غير موجود لدى Meta", code: "WHATSAPP_TEMPLATE_MISSING" }, 409);

  const templateStatus = String(info.status || "").toUpperCase();
  if (templateStatus !== "APPROVED") {
    const messages: Record<string, string> = {
      PENDING: "قالب واتساب الخاص بإرسال مستندات التعاقدات قيد المراجعة لدى Meta ولم يعتمد بعد.",
      REJECTED: "Meta رفضت قالب واتساب الخاص بإرسال مستندات التعاقدات ويحتاج مراجعة قبل الإرسال الآلي.",
      PAUSED: "قالب واتساب الخاص بالتعاقدات متوقف مؤقتًا لدى Meta.",
      DISABLED: "قالب واتساب الخاص بالتعاقدات معطل لدى Meta.",
    };
    return json({
      error: messages[templateStatus] || `قالب واتساب غير جاهز للإرسال حاليًا (${templateStatus || "UNKNOWN"})`,
      code: `WHATSAPP_TEMPLATE_${templateStatus || "UNAVAILABLE"}`,
      template_status: templateStatus || null,
      template_id: info.id || settings?.whatsapp_template_id || null,
    }, 409);
  }

  let pdfBytes: Uint8Array;
  let storagePath = String(version.pdf_url || "");
  if (storagePath.startsWith(`${BUCKET}/`)) storagePath = storagePath.slice(BUCKET.length + 1);

  if (version.immutable && storagePath) {
    if (/^https?:\/\//i.test(storagePath)) {
      const r = await fetch(storagePath);
      if (!r.ok) return json({ error: "تعذر قراءة النسخة المحفوظة من PDF" }, 500);
      pdfBytes = new Uint8Array(await r.arrayBuffer());
    } else {
      const { data, error } = await admin.storage.from(BUCKET).download(storagePath);
      if (error || !data) return json({ error: "تعذر قراءة النسخة المحفوظة من PDF" }, 500);
      pdfBytes = new Uint8Array(await data.arrayBuffer());
    }
  } else {
    if (!pdfBase64) return json({ error: "ملف PDF مطلوب لأول إرسال لهذه النسخة" }, 400);
    try { pdfBytes = base64Bytes(pdfBase64); } catch { return json({ error: "ملف PDF غير صالح" }, 400); }
    if (pdfBytes.length < 500 || pdfBytes.length > 20 * 1024 * 1024) return json({ error: "حجم ملف PDF غير صالح" }, 400);

    const hash = await sha256(pdfBytes);
    storagePath = `${entity.id}/${agreement.id}/V${version.version_no}/${hash.slice(0, 16)}-${filename}`;
    const uploaded = await admin.storage.from(BUCKET).upload(storagePath, pdfBytes, {
      contentType: "application/pdf",
      upsert: false,
    });
    if (uploaded.error && !/already exists/i.test(uploaded.error.message || "")) return json({ error: "تعذر حفظ نسخة PDF" }, 500);
    await admin.from("contracting_agreement_versions")
      .update({ pdf_url: storagePath, immutable: true })
      .eq("id", version.id);
  }

  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("type", "application/pdf");
  form.set("file", new Blob([pdfBytes], { type: "application/pdf" }), filename);

  const upload = await fetch(`${GRAPH}${phoneNumberId}/media`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const uploaded = await upload.json().catch(() => ({}));
  if (!upload.ok || !uploaded?.id) {
    return json({
      error: uploaded?.error?.message || "تعذر رفع ملف PDF إلى واتساب",
      code: "WHATSAPP_TEMPLATE_MEDIA_FAILED",
    }, 502);
  }

  const send = await fetch(`${GRAPH}${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: templateName,
        language: { code: templateLanguage },
        components: [
          {
            type: "header",
            parameters: [{ type: "document", document: { id: uploaded.id, filename } }],
          },
          {
            type: "body",
            parameters: [{ type: "text", text: String(entity.name || "الجهة").slice(0, 500) }],
          },
        ],
      },
    }),
  });
  const sent = await send.json().catch(() => ({}));
  if (!send.ok || sent?.error) {
    const error = sent?.error;
    await admin.from("contracting_activity_log").insert({
      entity_id: entity.id,
      agreement_id: agreement.id,
      action_key: "whatsapp_template_send_failed",
      summary: `تعذر إرسال V${agreement.version_no} بقالب واتساب`,
      metadata: {
        channel: "whatsapp",
        recipient,
        file: filename,
        storage_path: storagePath,
        template_name: templateName,
        template_id: info.id || settings?.whatsapp_template_id || null,
        error: error?.message || "تعذر إرسال قالب واتساب",
        error_code: error?.code || null,
        error_details: error?.error_data?.details || null,
      },
      created_by: c.id,
    });
    return json({
      error: error?.message || "تعذر إرسال المستند بقالب واتساب",
      code: "WHATSAPP_TEMPLATE_SEND_FAILED",
      meta_code: error?.code || null,
      details: error?.error_data?.details || null,
    }, 502);
  }

  const acceptedAt = new Date().toISOString();
  const messageId = sent?.messages?.[0]?.id || null;
  await admin.from("contracting_activity_log").insert({
    entity_id: entity.id,
    agreement_id: agreement.id,
    action_key: "whatsapp_template_accepted",
    summary: `قبلت Meta إرسال ${agreement.document_type === "proposal" ? "الخطاب المبدئي" : "العقد النهائي"} V${agreement.version_no} بقالب واتساب وجارٍ انتظار التسليم`,
    metadata: {
      channel: "whatsapp",
      recipient,
      file: filename,
      storage_path: storagePath,
      provider: "meta_whatsapp",
      provider_message_id: messageId,
      delivery_status: "accepted",
      send_mode: "template",
      template_id: info.id || settings?.whatsapp_template_id || null,
      template_name: templateName,
      template_language: templateLanguage,
    },
    created_by: c.id,
  });

  return json({
    ok: true,
    channel: "whatsapp",
    provider: "meta_whatsapp",
    message_id: messageId,
    delivery_status: "accepted",
    send_mode: "template",
    template_status: templateStatus,
    storage_path: storagePath,
    filename,
    accepted_at: acceptedAt,
  });
});
