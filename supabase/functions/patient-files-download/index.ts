import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Expose-Headers": "Content-Disposition, Content-Type",
};

const PATIENT_PORTAL_CATEGORIES = new Set([
  "insurance",
  "radiology",
  "lab_result",
  "prescription",
  "physical_therapy",
  "medical_report",
  "eeg",
  "invoice",
  "other",
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return null;
  return user;
}

async function getCallerAdmin(userId: string, admin: ReturnType<typeof createClient>) {
  const { data: row } = await admin
    .from("admins")
    .select("id, role, has_archive_access, has_archive_review_access, has_archive_view_only, active, admin_extra_roles!admin_id(role)")
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();
  if (!row) return null;
  const extra = (row as unknown as { admin_extra_roles?: { role: string }[] }).admin_extra_roles;
  return { ...row, extra_roles: (extra ?? []).map((r: { role: string }) => r.role) };
}

function isSuperAdmin(caller: { role: string; extra_roles?: string[] }): boolean {
  return caller.role === "super_admin" || (caller.extra_roles ?? []).includes("super_admin");
}

function isNursing(caller: { role: string; extra_roles?: string[] }): boolean {
  return caller.role === "nursing" || (caller.extra_roles ?? []).includes("nursing");
}

function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let str = "";
  bytes.forEach((b) => (str += String.fromCharCode(b)));
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const binaryDer = Uint8Array.from(atob(pemContents), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function getDriveAccessToken(): Promise<string> {
  const rawKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");
  if (!rawKey) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY غير مضبوط");
  const key = JSON.parse(rawKey);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claim = {
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  const cryptoKey = await importPrivateKey(key.private_key);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );
  const jwt = `${signingInput}.${base64url(new Uint8Array(signature))}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok) throw new Error("فشل توليد Google access token: " + JSON.stringify(tokenJson));
  return tokenJson.access_token as string;
}

async function hasEffectivePortalAccess(
  admin: ReturnType<typeof createClient>,
  accountId: string,
  patientId: string,
) {
  const { data: rows, error } = await admin
    .from("patient_account_access")
    .select("id, verification_status, revoked_at, expires_at")
    .eq("account_id", accountId)
    .eq("patient_id", patientId)
    .eq("verification_status", "approved");
  if (error) throw error;
  const now = Date.now();
  return (rows || []).some((r: any) =>
    !r.revoked_at && (!r.expires_at || new Date(r.expires_at).getTime() > now)
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const user = await getAuthenticatedUser(req);
  if (!user) return json({ error: "غير مصرح — سجّل دخولك تاني" }, 401);

  const url = new URL(req.url);
  const fileId = url.searchParams.get("file_id");
  const mode = url.searchParams.get("mode") === "preview" ? "preview" : "download";
  if (!fileId) return json({ error: "file_id مطلوب" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: fileRow, error } = await admin
    .from("patient_files")
    .select("id, patient_id, category, drive_file_id, file_name, mime_type")
    .eq("id", fileId)
    .maybeSingle();
  if (error || !fileRow) return json({ error: "الملف غير موجود" }, 404);

  const caller = await getCallerAdmin(user.id, admin);
  let portalAccount: any = null;

  if (caller) {
    const canReviewOrFull = caller.has_archive_access || caller.has_archive_review_access || isSuperAdmin(caller);
    const doctorOnly = caller.has_archive_view_only && !canReviewOrFull;
    const allowed = canReviewOrFull || caller.has_archive_view_only || isNursing(caller);
    if (!allowed) return json({ error: "مفيش صلاحية أرشيف المرضى" }, 403);

    if (doctorOnly) {
      const { data: assignment } = await admin
        .from("patient_doctor_assignments")
        .select("id")
        .eq("patient_id", fileRow.patient_id)
        .eq("doctor_id", caller.id)
        .eq("status", "pending")
        .maybeSingle();
      if (!assignment) return json({ error: "السجل ده مش محال لك" }, 403);
    }
  } else {
    const { data: account, error: accountError } = await admin
      .from("patient_accounts")
      .select("id, status, activation_completed_at")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (accountError) return json({ error: accountError.message }, 500);
    if (!account || account.status !== "active" || !account.activation_completed_at) {
      return json({ error: "PATIENT_ACCOUNT_NOT_ACTIVATED" }, 403);
    }
    if (!PATIENT_PORTAL_CATEGORIES.has(fileRow.category)) {
      return json({ error: "FILE_NOT_AVAILABLE_IN_PORTAL" }, 403);
    }

    let allowed = false;
    try {
      allowed = await hasEffectivePortalAccess(admin, account.id, fileRow.patient_id);
    } catch (e) {
      return json({ error: String((e as Error).message || e) }, 500);
    }
    if (!allowed) return json({ error: "NO_APPROVED_MEDICAL_ACCESS" }, 403);
    portalAccount = account;
  }

  let token: string;
  try {
    token = await getDriveAccessToken();
  } catch (e) {
    return json({ error: "فشل الاتصال بـ Google Drive: " + (e as Error).message }, 502);
  }

  const driveRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileRow.drive_file_id)}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!driveRes.ok) {
    return json({ error: "فشل تحميل الملف من Drive: " + (await driveRes.text()) }, 502);
  }

  if (caller) {
    await admin.from("archive_access_log").insert({
      file_id: fileRow.id,
      patient_id: fileRow.patient_id,
      employee_id: caller.id,
      action: "download",
    });
  } else if (portalAccount) {
    await admin.from("patient_portal_audit_log").insert({
      account_id: portalAccount.id,
      action: mode === "preview" ? "portal_file_preview" : "portal_file_download",
      entity_type: "patient_files",
      entity_id: fileRow.id,
      metadata: { patient_id: fileRow.patient_id },
    });
  }

  const encodedName = encodeURIComponent(fileRow.file_name || "file");
  const disposition = mode === "preview" ? "inline" : "attachment";
  return new Response(driveRes.body, {
    status: 200,
    headers: {
      ...CORS,
      "Content-Type": fileRow.mime_type || "application/octet-stream",
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodedName}`,
      "Cache-Control": "private, no-store, max-age=0",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
