import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const BUCKET = "patient-verification-documents";

const GMAIL_CLIENT_ID = Deno.env.get("GMAIL_CLIENT_ID") || "";
const GMAIL_CLIENT_SECRET = Deno.env.get("GMAIL_CLIENT_SECRET") || "";
const GMAIL_REFRESH_TOKEN = Deno.env.get("GMAIL_REFRESH_TOKEN") || "";
const GMAIL_FROM = Deno.env.get("GMAIL_FROM") || "";
const PATIENT_PORTAL_URL = Deno.env.get("PATIENT_PORTAL_URL") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

async function caller(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return null;

  const { data: allowed, error: allowedError } = await userClient.rpc("can_manage_patient_identity_verification");
  if (allowedError || !allowed) return null;

  const { data: adminId } = await userClient.rpc("my_admin_id");
  return { user, userClient, adminId: adminId || null };
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function activationCode() {
  const max = 100000000;
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  let n = 0;
  do {
    crypto.getRandomValues(buf);
    n = buf[0];
  } while (n >= limit);
  return String(n % max).padStart(8, "0");
}

function utf8Base64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64Url(value: string) {
  return utf8Base64(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function esc(v: unknown) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function gmailAccessToken() {
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN || !GMAIL_FROM) {
    throw new Error("GMAIL_NOT_CONFIGURED");
  }
  const body = new URLSearchParams({
    client_id: GMAIL_CLIENT_ID,
    client_secret: GMAIL_CLIENT_SECRET,
    refresh_token: GMAIL_REFRESH_TOKEN,
    grant_type: "refresh_token",
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const data = await r.json();
  if (!r.ok || !data.access_token) throw new Error(data.error_description || data.error || "GMAIL_TOKEN_FAILED");
  return String(data.access_token);
}

async function sendSwnwEmail(to: string, subject: string, html: string) {
  try {
    const token = await gmailAccessToken();
    const encodedSubject = "=?UTF-8?B?" + utf8Base64(subject) + "?=";
    const message = [
      "From: Swnw <" + GMAIL_FROM + ">",
      "To: " + to,
      "Subject: " + encodedSubject,
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      utf8Base64(html),
    ].join("\r\n");

    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: base64Url(message) }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data?.error?.message || "GMAIL_SEND_FAILED");
    return { ok: true, id: data.id || null };
  } catch (e) {
    return { ok: false, error: String((e as Error).message || e) };
  }
}

async function listItems(admin: ReturnType<typeof createClient>, status: string) {
  let q = admin
    .from("patient_identity_verifications")
    .select("id, account_id, requested_patient_id, requested_email, verification_type, requested_relationship, status, submitted_at, reviewed_at, reviewed_by, rejection_reason, expires_at")
    .order("submitted_at", { ascending: false })
    .limit(250);
  if (status && status !== "all") q = q.eq("status", status);

  const { data: verifications, error } = await q;
  if (error) throw error;
  if (!verifications?.length) return [];

  const verificationIds = verifications.map((v: any) => v.id);
  const accountIds = Array.from(new Set(verifications.map((v: any) => v.account_id).filter(Boolean)));
  const patientIds = Array.from(new Set(verifications.map((v: any) => v.requested_patient_id).filter(Boolean)));

  const [{ data: accounts, error: accErr }, { data: patients, error: patErr }, { data: docs, error: docErr }, { data: access, error: accessErr }] = await Promise.all([
    admin.from("patient_accounts")
      .select("id, auth_user_id, status, login_email, email_verified, activation_completed_at")
      .in("id", accountIds),
    admin.from("patients")
      .select("id, patient_code, full_name, phone, email")
      .in("id", patientIds),
    admin.from("patient_verification_documents")
      .select("id, verification_id, document_type, created_at")
      .in("verification_id", verificationIds)
      .order("created_at", { ascending: true }),
    admin.from("patient_account_access")
      .select("id, verification_id, account_id, patient_id, verification_status, verified_at, revoked_at, rejection_reason")
      .in("verification_id", verificationIds),
  ]);

  if (accErr) throw accErr;
  if (patErr) throw patErr;
  if (docErr) throw docErr;
  if (accessErr) throw accessErr;

  const accountMap = Object.fromEntries((accounts || []).map((a: any) => [a.id, a]));
  const patientMap = Object.fromEntries((patients || []).map((p: any) => [p.id, p]));
  const docsByVerification: Record<string, any[]> = {};
  for (const d of docs || []) (docsByVerification[d.verification_id] ||= []).push(d);
  const accessByVerification = Object.fromEntries((access || []).map((r: any) => [r.verification_id, r]));

  return verifications.map((v: any) => ({
    ...v,
    account: accountMap[v.account_id] || null,
    patient: v.requested_patient_id ? patientMap[v.requested_patient_id] || null : null,
    documents: docsByVerification[v.id] || [],
    access: accessByVerification[v.id] || null,
  }));
}

async function getVerificationContext(admin: ReturnType<typeof createClient>, id: string) {
  const { data: verification, error } = await admin
    .from("patient_identity_verifications")
    .select("id, account_id, requested_patient_id, status, verification_type, requested_relationship, requested_email")
    .eq("id", id)
    .maybeSingle();
  if (error || !verification) throw new Error("VERIFICATION_NOT_FOUND");

  const [{ data: account, error: aErr }, { data: patient, error: pErr }] = await Promise.all([
    admin.from("patient_accounts")
      .select("id, auth_user_id, status, login_email, activation_completed_at")
      .eq("id", verification.account_id)
      .maybeSingle(),
    admin.from("patients")
      .select("id, patient_code, full_name, email")
      .eq("id", verification.requested_patient_id)
      .maybeSingle(),
  ]);
  if (aErr || !account) throw new Error(aErr?.message || "ACCOUNT_NOT_FOUND");
  if (pErr || !patient) throw new Error(pErr?.message || "PATIENT_NOT_FOUND");
  return { verification, account, patient };
}

async function issueActivationCode(
  admin: ReturnType<typeof createClient>,
  account: any,
  verificationId: string,
  adminId: string | null,
) {
  const code = activationCode();
  const codeHash = await sha256(code);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  await admin.from("patient_activation_codes")
    .update({ used_at: now })
    .eq("account_id", account.id)
    .is("used_at", null);

  const { data: row, error } = await admin
    .from("patient_activation_codes")
    .insert({
      account_id: account.id,
      verification_id: verificationId,
      code_hash: codeHash,
      expires_at: expiresAt,
      created_by: adminId,
    })
    .select("id")
    .single();
  if (error) throw error;
  return { code, codeId: row.id, expiresAt };
}

function activationEmailHtml(name: string, code: string) {
  const link = PATIENT_PORTAL_URL
    ? '<p><a href="' + esc(PATIENT_PORTAL_URL) + '" style="display:inline-block;background:#0F369D;color:#fff;text-decoration:none;padding:12px 18px;border-radius:10px">فتح بوابة المريض</a></p>'
    : "";
  return '<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.8;color:#16212E">' +
    '<h2 style="color:#0F369D">تفعيل حساب Swnw Patient Portal</h2>' +
    '<p>أهلًا ' + esc(name || "") + '، تمت مراجعة مستندات التحقق واعتماد الطلب.</p>' +
    '<p>كود التفعيل الخاص بك:</p>' +
    '<div dir="ltr" style="font-size:30px;font-weight:700;letter-spacing:5px;padding:14px;background:#f3f6fb;border-radius:12px;display:inline-block">' + esc(code) + '</div>' +
    '<p>الكود صالح لمدة <b>15 دقيقة</b> ويُستخدم مرة واحدة فقط. بعد إدخاله ستحدد كلمة سر جديدة للحساب.</p>' +
    link +
    '<p style="font-size:12px;color:#687386">إذا لم تطلب تفعيل الحساب، تواصل مع مركز Swnw ولا تشارك الكود مع أي شخص.</p>' +
    '</div>';
}

function rejectionEmailHtml(name: string, reason: string) {
  return '<div dir="rtl" style="font-family:Arial,sans-serif;line-height:1.8;color:#16212E">' +
    '<h2 style="color:#0F369D">تحديث طلب التحقق — Swnw</h2>' +
    '<p>أهلًا ' + esc(name || "") + '، تعذر اعتماد طلب التحقق الحالي.</p>' +
    '<p><b>سبب الرفض:</b> ' + esc(reason || "يرجى التواصل مع المركز للمراجعة.") + '</p>' +
    '<p>يمكنك تصحيح السبب وإرسال طلب جديد.</p>' +
    '</div>';
}

async function sendActivation(
  admin: ReturnType<typeof createClient>,
  account: any,
  patient: any,
  verificationId: string,
  adminId: string | null,
) {
  if (!account.login_email) return { email_sent: false, email_error: "ACCOUNT_EMAIL_MISSING" };
  const issued = await issueActivationCode(admin, account, verificationId, adminId);
  const sent = await sendSwnwEmail(
    account.login_email,
    "كود تفعيل حساب Swnw Patient Portal",
    activationEmailHtml(patient.full_name || "", issued.code),
  );

  await admin.from("patient_portal_audit_log").insert({
    account_id: account.id,
    patient_id: patient.id,
    actor_admin_id: adminId,
    action: sent.ok ? "activation_email_sent" : "activation_email_failed",
    entity_type: "patient_activation_codes",
    entity_id: issued.codeId,
    metadata: sent.ok ? { expires_at: issued.expiresAt } : { error: sent.error || "unknown" },
  });

  return sent.ok
    ? { email_sent: true, activation_expires_at: issued.expiresAt }
    : { email_sent: false, email_error: sent.error || "GMAIL_SEND_FAILED" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = await caller(req);
  if (!auth) return json({ error: "FORBIDDEN" }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "INVALID_JSON" }, 400); }

  const op = String(body.op || "list");
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  if (op === "list") {
    try { return json({ items: await listItems(admin, String(body.status || "pending")) }); }
    catch (e) { return json({ error: String((e as Error).message || e) }, 500); }
  }

  if (op === "approve") {
    const id = String(body.verification_id || "");
    if (!id) return json({ error: "verification_id required" }, 400);

    try {
      const ctx = await getVerificationContext(admin, id);
      const accountEmail = String(ctx.account.login_email || "").trim().toLowerCase();
      const patientEmail = String(ctx.patient.email || "").trim().toLowerCase();
      if (!accountEmail || !patientEmail || accountEmail !== patientEmail) {
        return json({ error: "PATIENT_EMAIL_NOT_VERIFIED_OR_MISMATCHED" }, 400);
      }

      const { data: access, error } = await auth.userClient.rpc("approve_patient_identity_verification", {
        p_verification_id: id,
      });
      if (error) return json({ error: error.message }, 400);

      if (ctx.account.activation_completed_at) {
        return json({ access, email_sent: false, activation_not_required: true });
      }

      const mail = await sendActivation(admin, ctx.account, ctx.patient, id, auth.adminId);
      return json({ access, ...mail });
    } catch (e) {
      return json({ error: String((e as Error).message || e) }, 500);
    }
  }

  if (op === "resend_activation") {
    const id = String(body.verification_id || "");
    if (!id) return json({ error: "verification_id required" }, 400);
    try {
      const ctx = await getVerificationContext(admin, id);
      if (ctx.account.activation_completed_at) return json({ error: "ACCOUNT_ALREADY_ACTIVATED" }, 409);

      const { count, error: countError } = await admin
        .from("patient_account_access")
        .select("id", { count: "exact", head: true })
        .eq("account_id", ctx.account.id)
        .eq("verification_status", "approved");
      if (countError) throw countError;
      if (!count) return json({ error: "NO_APPROVED_ACCESS" }, 403);

      return json(await sendActivation(admin, ctx.account, ctx.patient, id, auth.adminId));
    } catch (e) {
      return json({ error: String((e as Error).message || e) }, 500);
    }
  }

  if (op === "reject") {
    const id = String(body.verification_id || "");
    const reason = body.reason ? String(body.reason).trim().slice(0, 500) : "";
    if (!id) return json({ error: "verification_id required" }, 400);
    if (!reason) return json({ error: "REJECTION_REASON_REQUIRED" }, 400);

    try {
      const ctx = await getVerificationContext(admin, id);
      const { data, error } = await auth.userClient.rpc("reject_patient_identity_verification", {
        p_verification_id: id,
        p_reason: reason,
      });
      if (error) return json({ error: error.message }, 400);

      const sent = ctx.account.login_email
        ? await sendSwnwEmail(ctx.account.login_email, "تحديث طلب التحقق — Swnw", rejectionEmailHtml(ctx.patient.full_name || "", reason))
        : { ok: false, error: "ACCOUNT_EMAIL_MISSING" };

      await admin.from("patient_portal_audit_log").insert({
        account_id: ctx.account.id,
        patient_id: ctx.patient.id,
        actor_admin_id: auth.adminId,
        action: sent.ok ? "rejection_email_sent" : "rejection_email_failed",
        entity_type: "patient_identity_verifications",
        entity_id: id,
        metadata: sent.ok ? { reason } : { reason, error: sent.error || "unknown" },
      });

      return json({ verification: data, email_sent: sent.ok, email_error: sent.ok ? null : sent.error });
    } catch (e) {
      return json({ error: String((e as Error).message || e) }, 500);
    }
  }

  if (op === "revoke") {
    const id = String(body.access_id || "");
    if (!id) return json({ error: "access_id required" }, 400);
    const { data, error } = await auth.userClient.rpc("revoke_patient_account_access", {
      p_access_id: id,
      p_reason: body.reason ? String(body.reason).slice(0, 500) : null,
      p_new_status: "revoked",
    });
    if (error) return json({ error: error.message }, 400);
    return json({ access: data });
  }

  if (op === "document_url") {
    const documentId = String(body.document_id || "");
    if (!documentId) return json({ error: "document_id required" }, 400);

    const { data: doc, error: docError } = await admin
      .from("patient_verification_documents")
      .select("id, storage_ref")
      .eq("id", documentId)
      .maybeSingle();
    if (docError || !doc) return json({ error: "DOCUMENT_NOT_FOUND" }, 404);

    const { error: logError } = await auth.userClient.rpc("log_verification_document_access", {
      p_document_id: documentId,
      p_action: "viewed",
    });
    if (logError) return json({ error: logError.message }, 403);

    const { data: signed, error: signedError } = await admin.storage.from(BUCKET).createSignedUrl(doc.storage_ref, 120);
    if (signedError || !signed?.signedUrl) {
      return json({ error: signedError?.message || "SIGNED_URL_FAILED" }, 500);
    }
    return json({ url: signed.signedUrl, expires_in: 120 });
  }

  return json({ error: "UNKNOWN_OPERATION" }, 400);
});
