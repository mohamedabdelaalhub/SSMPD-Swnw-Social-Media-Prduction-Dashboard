import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// جسر Google Apps Script (نفس اللي بيستخدمه الفرونت‌إند في drive.js) — بيرفع
// الملف وهو شغّال بحساب المركز نفسه (swnwclinics@gmail.com) عشان نتجنب مشكلة
// "Service Account مفيش عنده مساحة تخزين" (403 storageQuotaExceeded) اللي كانت
// بتحصل مع الرفع المباشر بالـ Service Account. موثّق في CLAUDE.md.
const DRIVE_BRIDGE_URL =
  "https://script.google.com/macros/s/AKfycbyTg8uqckj3ttdCS5rV32jzAjpdtTt74XKYaxNZH1tSQ3ESqR63dASUvsjbU0T_BFBl/exec";

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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// ---------- رفع عبر جسر Apps Script (category: "patient_archive") ----------
async function uploadViaBridge(
  patientCode: string,
  docFolderName: string,
  fileName: string,
  mimeType: string,
  bytes: Uint8Array,
): Promise<{ fileUrl: string; folderUrl: string; fileId: string }> {
  const payload = {
    category: "patient_archive",
    patientCode,
    docFolderName,
    fileName,
    mimeType: mimeType || "application/octet-stream",
    base64: bytesToBase64(bytes),
  };
  const res = await fetch(DRIVE_BRIDGE_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" }, // يتفادى preflight CORS مع Apps Script
    body: JSON.stringify(payload),
  });
  const resJson = await res.json();
  if (!res.ok || !resJson || !resJson.ok) {
    throw new Error((resJson && resJson.error) || "فشل الرفع لجوجل درايف عبر الجسر");
  }
  return { fileUrl: resJson.fileUrl, folderUrl: resJson.folderUrl, fileId: resJson.fileId };
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

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const checksumBuf = await crypto.subtle.digest("SHA-256", bytes);
    const checksum = Array.from(new Uint8Array(checksumBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");

    const uploaded = await uploadViaBridge(
      patient.patient_code,
      CATEGORY_FOLDER_NAMES[category],
      file.name,
      file.type,
      bytes,
    );

    const { data: fileRow, error: insertErr } = await admin
      .from("patient_files")
      .insert({
        patient_id: patientId,
        category,
        other_description: otherDescription,
        drive_file_id: uploaded.fileId,
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
