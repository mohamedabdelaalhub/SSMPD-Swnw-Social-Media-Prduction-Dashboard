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
  if (!row) return null;
  // تعدد الأدوار: نجيب الأدوار الإضافية عشان الفحص يقبل مستخدم عنده رول تاني
  // أساسي بس معاه صلاحية إضافية لموديول الليدز
  const { data: extra } = await admin
    .from("admin_extra_roles")
    .select("role")
    .eq("admin_id", row.id);
  return { ...row, extra_roles: (extra ?? []).map((r: { role: string }) => r.role) };
}

// true لو الرول الأساسي أو أي من الأدوار الإضافية موجود في القائمة
function roleIn(caller: { role: string; extra_roles?: string[] }, roles: string[]): boolean {
  return roles.includes(caller.role) || (caller.extra_roles ?? []).some((r) => roles.includes(r));
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

// الفاتورة بقت بترفع في فولدر المريض نفسه على درايف (زي أي مستند تاني في أرشيف
// المرضى) عشان تبقى "على ملفه" فعلاً — مش فولدر عام منفصل للي دز. لازم يبقى
// عندنا patient_code قبل الرفع، فده بيحصل بعد ما نحدد/ننشئ المريض.
async function uploadViaBridge(
  patientCode: string,
  fileName: string,
  mimeType: string,
  bytes: Uint8Array,
): Promise<{ fileUrl: string; folderUrl: string; fileId: string }> {
  const payload = {
    category: "patient_archive",
    patientCode,
    docFolderName: "Invoices",
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

// تطبيع رقم التليفون — نفس منطق patients-create/leads-create بالظبط عشان
// المطابقة بين الليد والمريض تشتغل صح
function normalizePhone(raw: string): string {
  if (!raw) return "";
  // نشيل مسافات/شرطات/أقواس + رموز اتجاه النص المخفية (LRM/RLM/LRE..PDF) اللي
  // بتيجي أحياناً من نسخ رقم من واتساب — code points بدل حروف حرفية في المصدر
  // عشان نتفادى أي مشكلة ترميز عند النسخ/اللصق
  const HIDDEN_BIDI = [0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e];
  let s = Array.from(raw)
    .filter((ch) => !HIDDEN_BIDI.includes(ch.codePointAt(0) ?? 0))
    .join("")
    .replace(/[\s\-()]/g, "");
  s = s.replace(/^00/, "+");
  if (/^01[0125]\d{8}$/.test(s)) s = "+2" + s;
  else if (/^1[0125]\d{8}$/.test(s)) s = "+20" + s;
  else if (!s.startsWith("+")) s = "+" + s.replace(/^0+/, "");
  return s;
}

const ALLOWED_STATUSES_FOR_INVOICE = ["booked", "booked_on_system", "service_done"];

// فاتورة/إيصال لليد اتحجز وأخد خدمة فعلاً — طلب المستخدم: تحليل الدخل الحقيقي
// القادم من الليدز، وتحويل الليد تلقائياً لملف مريض في الأرشيف (مطابقة بالتليفون
// وإلا إنشاء مريض جديد) عشان محدش يعمل الخطوتين يدوي وينسى واحدة. مقصور على مين
// يقدر يشوف الليد أصلاً (نفس صلاحيات الموديول)
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const caller = await getCallerAdmin(req);
  if (!caller) return json({ error: "غير مصرح — سجّل دخولك تاني" }, 401);
  const allowed = roleIn(caller, ["reception", "customer_service", "general_manager", "super_admin"]);
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
    .select("id, customer_name, phone_raw, phone_normalized, current_status, assigned_to, patient_id, patient_type")
    .eq("id", leadId)
    .maybeSingle();
  if (leadErr || !lead) return json({ error: "الليد غير موجود" }, 404);

  const hasWiderAccess = roleIn(caller, ["reception", "general_manager", "super_admin"]);
  if (!hasWiderAccess && roleIn(caller, ["customer_service"]) && lead.assigned_to !== caller.id) {
    return json({ error: "الليد ده مش مُسند لك" }, 403);
  }
  if (!ALLOWED_STATUSES_FOR_INVOICE.includes(lead.current_status)) {
    return json({
      error: 'رفع الفاتورة متاح بس للليدز اللي حالتها "تم الحجز" أو "تم الحجز على سيستم المركز" أو "تم إجراء الخدمة"',
    }, 409);
  }

  try {
    // ---------- الخطوة ١: تحديد/إنشاء ملف المريض (تحويل تلقائي — تجنب التكرار) ----------
    let patientId: string = lead.patient_id ?? "";
    let patientCode: string;
    let patientType: "new" | "existing" = (lead.patient_type as "new" | "existing") ?? "new";

    if (patientId) {
      const { data: existing } = await admin.from("patients").select("id, patient_code").eq("id", patientId).maybeSingle();
      if (!existing) return json({ error: "ملف المريض المرتبط بالليد ده مش موجود" }, 500);
      patientCode = existing.patient_code;
    } else {
      const phoneNormalized = lead.phone_normalized || (lead.phone_raw ? normalizePhone(lead.phone_raw) : null);
      let matched: { id: string; patient_code: string } | null = null;
      if (phoneNormalized) {
        const { data: found } = await admin
          .from("patients")
          .select("id, patient_code")
          .eq("phone_normalized", phoneNormalized)
          .limit(1)
          .maybeSingle();
        matched = found ?? null;
      }
      if (matched) {
        patientId = matched.id;
        patientCode = matched.patient_code;
        patientType = "existing";
      } else {
        const { data: created, error: createErr } = await admin
          .from("patients")
          .insert({
            full_name: lead.customer_name,
            phone: lead.phone_raw || null,
            phone_normalized: phoneNormalized,
            created_by: caller.id,
          })
          .select("id, patient_code")
          .single();
        if (createErr || !created) return json({ error: (createErr && createErr.message) || "فشل إنشاء ملف مريض جديد" }, 500);
        patientId = created.id;
        patientCode = created.patient_code;
        patientType = "new";
      }
    }

    // ---------- الخطوة ٢: رفع الفاتورة نفسها على فولدر المريض (فئة "فاتورة") ----------
    const bytes = new Uint8Array(await file.arrayBuffer());
    const uploaded = await uploadViaBridge(patientCode, file.name, file.type, bytes);
    const checksumBuf = await crypto.subtle.digest("SHA-256", bytes);
    const checksum = Array.from(new Uint8Array(checksumBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");

    const { data: fileRow, error: fileErr } = await admin
      .from("patient_files")
      .insert({
        patient_id: patientId,
        category: "invoice",
        drive_file_id: uploaded.fileId,
        file_name: file.name,
        file_size: bytes.byteLength,
        mime_type: file.type || null,
        checksum,
        uploaded_by: caller.id,
      })
      .select("id")
      .single();
    if (fileErr || !fileRow) return json({ error: (fileErr && fileErr.message) || "فشل تسجيل ملف الفاتورة" }, 500);

    await admin.from("archive_access_log").insert({
      file_id: fileRow.id,
      patient_id: patientId,
      employee_id: caller.id,
      action: "upload",
    });

    // ---------- الخطوة ٣: تسجيل الفاتورة على الليد (للتقارير/إحصائيات الدخل) ----------
    const { data: invoice, error: insertErr } = await admin
      .from("lead_invoices")
      .insert({
        lead_id: leadId,
        amount,
        service_name: serviceName,
        drive_file_id: uploaded.fileId,
        file_name: file.name,
        uploaded_by: caller.id,
        patient_file_id: fileRow.id,
        notes,
      })
      .select("id, lead_id, amount, service_name, file_name, uploaded_at")
      .single();
    if (insertErr) return json({ error: insertErr.message }, 500);

    // ---------- الخطوة ٤: ربط الليد بملف المريض + إقفاله بـ"تم إجراء الخدمة" ----------
    // بيعدّي من rpc_update_lead (مش .update() مباشرة) عشان app.caller_admin_id يتحدد
    // جوّه نفس الترانزاكشن — التريجرز (تسجيل تغيير الحالة) محتاجة تعرف "مين" فعلياً
    const newStatus = lead.current_status === "service_done" ? null : "service_done";
    await admin.from("leads").update({ patient_id: patientId, patient_type: patientType }).eq("id", leadId);
    if (newStatus) {
      await admin.rpc("rpc_update_lead", {
        p_lead_id: leadId,
        p_caller_id: caller.id,
        p_current_status: newStatus,
        p_closed_at: new Date().toISOString(),
      });
    }

    return json({ invoice, patient: { id: patientId, patient_code: patientCode, type: patientType } });
  } catch (e) {
    return json({ error: (e as Error).message }, 502);
  }
});
