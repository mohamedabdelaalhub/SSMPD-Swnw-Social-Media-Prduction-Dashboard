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
    } catch { /* legacy secret layout */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function safeName(v: unknown, fallback = "SWNW-Partnership.pdf") {
  const s = String(v || fallback).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
  return (s || fallback).slice(0, 140).replace(/\.pdf$/i, "") + ".pdf";
}

function normalizePhone(v: unknown) {
  let p = String(v || "").replace(/\D/g, "");
  if (/^01[0125]\d{8}$/.test(p)) p = "2" + p;
  if (/^1[0125]\d{8}$/.test(p)) p = "20" + p;
  return p;
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
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return null;
  const key = serviceKey();
  if (!key) return null;
  const admin = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  const { data: row } = await admin.from("admins")
    .select("id,role,active,admin_extra_roles!admin_id(role)")
    .eq("user_id", user.id).eq("active", true).maybeSingle();
  if (!row) return null;
  const extra = (row as unknown as { admin_extra_roles?: { role: string }[] }).admin_extra_roles || [];
  return { id: row.id as string, role: row.role as string, roles: [row.role, ...extra.map((x) => x.role)] };
}

function canSend(c: { roles: string[] }) {
  return c.roles.some((r) => ["contract_manager", "general_manager", "super_admin"].includes(r));
}

function whatsappPhoneNumberId() {
  for (const key of ["WHATSAPP_SONO_PHONE_NUMBER_ID", "WHATSAPP_PHONE_NUMBER_ID", "META_WHATSAPP_PHONE_NUMBER_ID"]) {
    const v = Deno.env.get(key);
    if (v) return v;
  }
  try {
    const brands = JSON.parse(Deno.env.get("WHATSAPP_BRANDS") || "{}");
    const hit = Object.entries(brands).find(([, brand]) => brand === "sono");
    if (hit) return hit[0];
  } catch { /* optional map */ }
  return "";
}

async function sendWhatsapp(pdf: Uint8Array, to: string, filename: string, caption: string) {
  const token = Deno.env.get("WHATSAPP_TOKEN") || "";
  const phoneNumberId = whatsappPhoneNumberId();
  if (!token || !phoneNumberId) return { ok: false, status: 503, code: "WHATSAPP_NOT_CONFIGURED", error: "إعداد إرسال واتساب غير مكتمل" };

  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("type", "application/pdf");
  form.set("file", new Blob([pdf], { type: "application/pdf" }), filename);
  const upload = await fetch(`${GRAPH}${phoneNumberId}/media`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
  const uploaded = await upload.json().catch(() => ({}));
  if (!upload.ok || !uploaded?.id) {
    return { ok: false, status: 502, code: "WHATSAPP_MEDIA_FAILED", error: uploaded?.error?.message || "تعذر رفع ملف PDF إلى واتساب" };
  }

  const send = await fetch(`${GRAPH}${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: { id: uploaded.id, filename, caption: caption.slice(0, 1024) },
    }),
  });
  const sent = await send.json().catch(() => ({}));
  if (!send.ok || sent?.error) {
    return { ok: false, status: 502, code: "WHATSAPP_SEND_FAILED", error: sent?.error?.message || "تعذر إرسال المستند على واتساب" };
  }
  return { ok: true, provider: "meta_whatsapp", messageId: sent?.messages?.[0]?.id || null };
}

async function sendEmail(pdfBase64: string, to: string, filename: string, subject: string, text: string, fromEmail: string) {
  const from = Deno.env.get("CONTRACTING_EMAIL_FROM") || (fromEmail ? `Swnw Clinics <${fromEmail}>` : "");
  if (!from) return { ok: false, status: 503, code: "EMAIL_FROM_NOT_CONFIGURED", error: "بريد الإرسال الخاص بالمركز غير مضبوط" };

  const resend = Deno.env.get("RESEND_API_KEY");
  if (resend) {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resend}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [to], subject, text, attachments: [{ filename, content: pdfBase64 }] }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: 502, code: "EMAIL_SEND_FAILED", error: d?.message || d?.error?.message || "تعذر إرسال البريد" };
    return { ok: true, provider: "resend", messageId: d?.id || null };
  }

  const brevo = Deno.env.get("BREVO_API_KEY");
  if (brevo) {
    const match = from.match(/<([^>]+)>/);
    const senderEmail = match ? match[1] : from;
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": brevo, "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sender: { name: "Swnw Clinics", email: senderEmail }, to: [{ email: to }], subject, textContent: text, attachment: [{ name: filename, content: pdfBase64 }] }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: 502, code: "EMAIL_SEND_FAILED", error: d?.message || "تعذر إرسال البريد" };
    return { ok: true, provider: "brevo", messageId: d?.messageId || null };
  }

  const sendgrid = Deno.env.get("SENDGRID_API_KEY");
  if (sendgrid) {
    const match = from.match(/<([^>]+)>/);
    const senderEmail = match ? match[1] : from;
    const r = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: { Authorization: `Bearer ${sendgrid}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }], from: { email: senderEmail, name: "Swnw Clinics" }, subject,
        content: [{ type: "text/plain", value: text }],
        attachments: [{ content: pdfBase64, type: "application/pdf", filename, disposition: "attachment" }],
      }),
    });
    if (!r.ok) return { ok: false, status: 502, code: "EMAIL_SEND_FAILED", error: (await r.text().catch(() => "")) || "تعذر إرسال البريد" };
    return { ok: true, provider: "sendgrid", messageId: r.headers.get("x-message-id") };
  }

  return { ok: false, status: 503, code: "EMAIL_NOT_CONFIGURED", error: "خدمة إرسال البريد المباشر غير مهيأة بعد" };
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
  const channel = b?.channel === "whatsapp" ? "whatsapp" : b?.channel === "email" ? "email" : "";
  const recipient = String(b?.recipient || "").trim();
  const subject = String(b?.subject || "").trim().slice(0, 250);
  const message = String(b?.message || "").trim().slice(0, 4000);
  const filename = safeName(b?.filename);
  if (!agreementId || !channel || !recipient || !message) return json({ error: "بيانات الإرسال ناقصة" }, 400);
  if (channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return json({ error: "البريد الإلكتروني غير صالح" }, 400);
  const phone = channel === "whatsapp" ? normalizePhone(recipient) : "";
  if (channel === "whatsapp" && phone.length < 10) return json({ error: "رقم واتساب غير صالح" }, 400);

  const { data: agreement, error: agreementError } = await admin.from("contracting_agreements")
    .select("id,entity_id,document_type,version_no,status")
    .eq("id", agreementId).maybeSingle();
  if (agreementError || !agreement) return json({ error: "المستند غير موجود" }, 404);
  const { data: entity } = await admin.from("contracting_entities").select("id,name,representative_email,representative_phone").eq("id", agreement.entity_id).maybeSingle();
  if (!entity) return json({ error: "جهة التعاقد غير موجودة" }, 404);
  const { data: version } = await admin.from("contracting_agreement_versions")
    .select("id,version_no,file_name,pdf_url,immutable")
    .eq("agreement_id", agreement.id).eq("version_no", agreement.version_no).maybeSingle();
  if (!version) return json({ error: "نسخة المستند غير موجودة" }, 404);

  let pdfBytes: Uint8Array;
  let pdfBase64 = String(b?.pdf_base64 || "").replace(/^data:application\/pdf;base64,/i, "").replace(/\s/g, "");
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
    if (!pdfBase64) {
      let s = "";
      const chunk = 0x8000;
      for (let i = 0; i < pdfBytes.length; i += chunk) s += String.fromCharCode(...pdfBytes.subarray(i, i + chunk));
      pdfBase64 = btoa(s);
    }
  } else {
    if (!pdfBase64) return json({ error: "ملف PDF مطلوب لأول إرسال لهذه النسخة" }, 400);
    try { pdfBytes = base64Bytes(pdfBase64); } catch { return json({ error: "ملف PDF غير صالح" }, 400); }
    if (pdfBytes.length < 500 || pdfBytes.length > 20 * 1024 * 1024) return json({ error: "حجم ملف PDF غير صالح" }, 400);
    const hash = await sha256(pdfBytes);
    storagePath = `${entity.id}/${agreement.id}/V${version.version_no}/${hash.slice(0, 16)}-${filename}`;
    const uploaded = await admin.storage.from(BUCKET).upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: false });
    if (uploaded.error && !/already exists/i.test(uploaded.error.message || "")) return json({ error: "تعذر حفظ نسخة PDF" }, 500);
    await admin.from("contracting_agreement_versions").update({ pdf_url: storagePath, immutable: true }).eq("id", version.id);
  }

  const settingsRes = await admin.from("contracting_partnership_settings").select("clinic_email").order("updated_at", { ascending: false }).limit(1).maybeSingle();
  const clinicEmail = settingsRes.data?.clinic_email || "";
  const sent = channel === "whatsapp"
    ? await sendWhatsapp(pdfBytes!, phone, filename, message)
    : await sendEmail(pdfBase64, recipient, filename, subject || `مستند تعاون مع ${entity.name}`, message, clinicEmail);

  if (!sent.ok) {
    await admin.from("contracting_activity_log").insert({
      entity_id: entity.id, agreement_id: agreement.id, action_key: `${channel}_send_failed`,
      summary: `تعذر إرسال V${agreement.version_no} عبر ${channel === "whatsapp" ? "واتساب" : "البريد"}`,
      metadata: { channel, recipient, file: filename, storage_path: storagePath, error: sent.error, code: sent.code }, created_by: c.id,
    });
    return json({ error: sent.error, code: sent.code, storage_path: storagePath }, sent.status || 500);
  }

  const sentAt = new Date().toISOString();
  await admin.from("contracting_agreements").update({ sent_at: sentAt, status: "sent" }).eq("id", agreement.id);
  await admin.from("contracting_activity_log").insert({
    entity_id: entity.id, agreement_id: agreement.id, action_key: channel === "whatsapp" ? "whatsapp_sent" : "email_sent",
    summary: `تم إرسال ${agreement.document_type === "proposal" ? "الخطاب المبدئي" : "العقد النهائي"} V${agreement.version_no} عبر ${channel === "whatsapp" ? "واتساب" : "البريد"}`,
    metadata: { channel, recipient, file: filename, storage_path: storagePath, provider: sent.provider, provider_message_id: sent.messageId || null }, created_by: c.id,
  });

  return json({ ok: true, channel, provider: sent.provider, message_id: sent.messageId || null, storage_path: storagePath, filename, sent_at: sentAt });
});
