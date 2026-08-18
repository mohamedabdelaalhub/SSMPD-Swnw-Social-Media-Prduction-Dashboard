import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const ARCHIVE_FOLDER_ID = Deno.env.get("DRIVE_PATIENT_ARCHIVE_FOLDER_ID")!;

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

const CATEGORY_FOLDER_NAMES: Record<string, string> = {
  id_document: "ID_Documents",
  insurance: "Insurance",
  radiology: "Radiology",
  lab_result: "Lab_Results",
  prescription: "Prescriptions",
  eeg: "EEG_Brain_Scans",
  other: "Other",
};

// ---------- تحقق من JWT + الصلاحية ----------
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
    .select("id, role, has_archive_access, active")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  return row ?? null;
}

// ---------- Google Service Account OAuth (بدون أي مكتبة خارجية — Web Crypto فقط) ----------
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

// ---------- Drive helpers ----------
async function findOrCreateFolder(name: string, parentId: string, token: string): Promise<string> {
  const q = encodeURIComponent(
    `name = '${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
  );
  const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const searchJson = await searchRes.json();
  if (!searchRes.ok) throw new Error("فشل البحث في Drive: " + JSON.stringify(searchJson));
  if (searchJson.files && searchJson.files.length > 0) return searchJson.files[0].id;

  const createRes = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });
  const createJson = await createRes.json();
  if (!createRes.ok) throw new Error("فشل إنشاء فولدر في Drive: " + JSON.stringify(createJson));
  return createJson.id as string;
}

// رفع resumable حقيقي: بدء جلسة ثم PUT للبايتات الخام (من غير base64) — مناسب للملفات الكبيرة (أشعة/PDF)
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const caller = await getCallerAdmin(req);
  if (!caller) return json({ error: "غير مصرح — سجّل دخولك تاني" }, 401);
  const allowed = caller.has_archive_access || caller.role === "super_admin";
  if (!allowed) return json({ error: "مفيش صلاحية أرشيف المرضى" }, 403);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json({ error: "لازم ترفع الملف كـ multipart/form-data" }, 400);
  }

  const patientId = form.get("patient_id")?.toString();
  const category = form.get("category")?.toString();
  const otherDescription = form.get("other_description")?.toString().trim() || null;
  const file = form.get("file");

  if (!patientId) return json({ error: "patient_id مطلوب" }, 400);
  if (!category || !CATEGORY_FOLDER_NAMES[category]) {
    return json({ error: "category غير صالحة (id_document/insurance/radiology/lab_result/prescription/eeg/other)" }, 400);
  }
  if (category === "other" && !otherDescription) {
    return json({ error: "لازم توصف نوع الملف لما الفئة تكون \"أخرى\"" }, 400);
  }
  if (!(file instanceof File)) return json({ error: "الملف مطلوب" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: patient, error: patientErr } = await admin
    .from("patients")
    .select("id, patient_code")
    .eq("id", patientId)
    .maybeSingle();
  if (patientErr || !patient) return json({ error: "المريض غير موجود" }, 404);

  let token: string;
  try {
    token = await getDriveAccessToken();
  } catch (e) {
    return json({ error: "فشل الاتصال بـ Google Drive: " + (e as Error).message }, 502);
  }

  try {
    const patientFolderId = await findOrCreateFolder(`Patient_${patient.patient_code}`, ARCHIVE_FOLDER_ID, token);
    const categoryFolderId = await findOrCreateFolder(CATEGORY_FOLDER_NAMES[category], patientFolderId, token);

    const bytes = new Uint8Array(await file.arrayBuffer());
    const checksumBuf = await crypto.subtle.digest("SHA-256", bytes);
    const checksum = Array.from(new Uint8Array(checksumBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");

    const uploaded = await uploadFileResumable(token, file.name, file.type, categoryFolderId, bytes);

    const { data: fileRow, error: insertErr } = await admin
      .from("patient_files")
      .insert({
        patient_id: patientId,
        category,
        other_description: otherDescription,
        drive_file_id: uploaded.id,
        file_name: file.name,
        file_size: bytes.byteLength,
        mime_type: file.type || null,
        checksum,
        uploaded_by: caller.id,
      })
      .select("id, category, other_description, file_name, file_size, mime_type, uploaded_at")
      .single();

    if (insertErr) return json({ error: insertErr.message }, 500);

    await admin.from("archive_access_log").insert({
      file_id: fileRow.id,
      patient_id: patientId,
      employee_id: caller.id,
      action: "upload",
    });

    return json({ file: fileRow });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
});
