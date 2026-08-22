import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function getCallerAdmin(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return null;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: row } = await admin
    .from("admins")
    .select("id, role, has_archive_access, active, admin_extra_roles(role)")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!row) return null;
  // تعدد الأدوار: مضمومة في نفس استعلام admins فوق (join) بدل نداء منفصل —
  // أسرع (رحلة شبكة واحدة بدل اتنين) لكل استدعاء للدالة دي
  const extra = (row as unknown as { admin_extra_roles?: { role: string }[] }).admin_extra_roles;
  return { ...row, extra_roles: (extra ?? []).map((r: { role: string }) => r.role) };
}

function isSuperAdmin(caller: { role: string; extra_roles?: string[] }): boolean {
  return caller.role === "super_admin" || (caller.extra_roles ?? []).includes("super_admin");
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
  const key = JSON.parse(Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY")!);
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const caller = await getCallerAdmin(req);
  if (!caller) return json({ error: "غير مصرح — سجّل دخولك تاني" }, 401);
  // الحذف مقصور على السوبر أدمن أو صاحب صلاحية الأرشيف الكاملة — نفس شرط باقي عمليات الموديول
  const allowed = caller.has_archive_access || isSuperAdmin(caller);
  if (!allowed) return json({ error: "مفيش صلاحية أرشيف المرضى" }, 403);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "بيانات غير صالحة" }, 400);
  }
  const fileId = body.file_id?.toString();
  if (!fileId) return json({ error: "file_id مطلوب" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: fileRow, error } = await admin
    .from("patient_files")
    .select("id, patient_id, drive_file_id")
    .eq("id", fileId)
    .maybeSingle();
  if (error || !fileRow) return json({ error: "الملف غير موجود" }, 404);

  let token: string;
  try {
    token = await getDriveAccessToken();
  } catch (e) {
    return json({ error: "فشل الاتصال بـ Google Drive: " + (e as Error).message }, 502);
  }

  const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileRow.drive_file_id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  // 404 من Drive يعني الملف اتمسح بالفعل هناك — نكمل حذف السجل عندنا برضه
  if (!driveRes.ok && driveRes.status !== 404) {
    return json({ error: "فشل حذف الملف من Drive: " + (await driveRes.text()) }, 502);
  }

  await admin.from("archive_access_log").insert({
    file_id: fileRow.id,
    patient_id: fileRow.patient_id,
    employee_id: caller.id,
    action: "delete",
  });

  const { error: delErr } = await admin.from("patient_files").delete().eq("id", fileId);
  if (delErr) return json({ error: delErr.message }, 500);

  return json({ success: true });
});
