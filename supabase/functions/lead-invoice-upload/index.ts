import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const REPORTS_FOLDER_ID = Deno.env.get("DRIVE_LEADS_REPORTS_FOLDER_ID")!;

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
    .select("id, role, active")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  return row ?? null;
}

// ---------- Google Service Account OAuth (نفس أسلوب patient-files-upload بالظبط) ----------
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

async function uploadFileResumable(
  token: string,
  fileName: string,
  mimeType: string,
  parentId: string,
  fileBytes: Uint8Array,
): Promise<{ id: string }> {
  const initRes = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType || "application/octet-stream",
        "X-Upload-Content-Length": String(fileBytes.byteLength),
      },
      body: JSON.stringify({ name: fileName, parents: [parentId] }),
    },
  );
  if (!initRes.ok) throw new Error("فشل بدء جلسة الرفع: " + (await initRes.text()));
  const uploadUrl = initRes.headers.get("Location");
  if (!uploadUrl) throw new Error("مفيش Location header من Google لبدء الرفع");

  const putRes = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": mimeType || "application/octet-stream",
      "Content-Length": String(fileBytes.byteLength),
    },
    body: fileBytes,
  });
  const putJson = await putRes.json();
  if (!putRes.ok) throw new Error("فشل رفع الملف: " + JSON.stringify(putJson));
  return putJson;
}

// فاتورة/إيصال لليد اتحجز وأخد خدمة فعلاً — طلب المستخدم: تحليل الدخل الحقيقي
// القادم من الليدز لاحقاً. مقصور على مين يقدر يشوف الليد أصلاً (نفس صلاحيات الموديول)
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const caller = await getCallerAdmin(req);
  if (!caller) return json({ error: "غير مصرح — سجّل دخولك تاني" }, 401);
  const allowed = ["reception", "customer_service", "general_manager", "super_admin"].includes(caller.role);
  if (!allowed) return json({ error: "مفيش صلاحية موديول الليدز" }, 403);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "لازم ترفع الملف كـ multipart/form-data" }, 400);
  }

  const leadId = form.get("lead_id")?.toString();
  const amountStr = form.get("amount")?.toString();
  const serviceName = form.get("service_name")?.toString() || null;
  const notes = form.get("notes")?.toString() || null;
  const file = form.get("file");

  if (!leadId) return json({ error: "lead_id مطلوب" }, 400);
  const amount = Number(amountStr);
  if (!amountStr || !isFinite(amount) || amount <= 0) return json({ error: "amount لازم يكون رقم أكبر من صفر" }, 400);
  if (!(file instanceof File)) return json({ error: "الملف مطلوب" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: lead, error: leadErr } = await admin
    .from("leads")
    .select("id, customer_name, current_status, assigned_to")
    .eq("id", leadId)
    .maybeSingle();
  if (leadErr || !lead) return json({ error: "الليد غير موجود" }, 404);

  if (caller.role === "customer_service" && lead.assigned_to !== caller.id) {
    return json({ error: "الليد ده مش مُسند لك" }, 403);
  }
  if (lead.current_status !== "booked") {
    return json({ error: "رفع الفاتورة متاح بس للليدز اللي حالتها \"تم الحجز\"" }, 409);
  }

  let token: string;
  try {
    token = await getDriveAccessToken();
  } catch (e) {
    return json({ error: "فشل الاتصال بـ Google Drive: " + (e as Error).message }, 502);
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const uploaded = await uploadFileResumable(token, file.name, file.type, REPORTS_FOLDER_ID, bytes);

    const { data: invoice, error: insertErr } = await admin
      .from("lead_invoices")
      .insert({
        lead_id: leadId,
        amount,
        service_name: serviceName,
        drive_file_id: uploaded.id,
        file_name: file.name,
        uploaded_by: caller.id,
        notes,
      })
      .select("id, lead_id, amount, service_name, file_name, uploaded_at")
      .single();
    if (insertErr) return json({ error: insertErr.message }, 500);

    return json({ invoice });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
});
