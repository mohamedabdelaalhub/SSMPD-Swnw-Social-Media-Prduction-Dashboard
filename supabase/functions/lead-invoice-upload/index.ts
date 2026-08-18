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

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// أنواع الملفات المسموحة لفاتورة/إيصال الحجز — صور + PDF + إكسيل (مش صور بس)
const ALLOWED_MIME_PREFIXES = ["image/"];
const ALLOWED_MIME_EXACT = new Set([
  "application/pdf",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
]);
function isAllowedMime(mimeType: string, fileName: string): boolean {
  if (ALLOWED_MIME_PREFIXES.some((p) => mimeType.startsWith(p))) return true;
  if (ALLOWED_MIME_EXACT.has(mimeType)) return true;
  // بعض المتصفحات بتبعت mimeType فاضي لملفات الإكسيل/PDF أحياناً — رجوع لامتداد الملف
  return /\.(pdf|xlsx?)$/i.test(fileName);
}

// ---------- رفع عبر جسر Apps Script (category: "leads_invoice") ----------
async function uploadViaBridge(
  leadId: string,
  fileName: string,
  mimeType: string,
  bytes: Uint8Array,
): Promise<{ fileUrl: string; folderUrl: string; fileId: string }> {
  const payload = {
    category: "leads_invoice",
    leadId,
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
  if (!isAllowedMime(file.type || "", file.name || "")) {
    return json({ error: "نوع الملف غير مدعوم — لازم يكون صورة أو PDF أو إكسيل" }, 400);
  }

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

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const uploaded = await uploadViaBridge(leadId, file.name, file.type, bytes);

    const { data: invoice, error: insertErr } = await admin
      .from("lead_invoices")
      .insert({
        lead_id: leadId,
        amount,
        service_name: serviceName,
        drive_file_id: uploaded.fileId,
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
