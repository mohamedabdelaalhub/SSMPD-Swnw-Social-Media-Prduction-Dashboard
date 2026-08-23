import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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
    .select("id, role, has_archive_access, has_archive_review_access, has_archive_view_only, active, admin_extra_roles!admin_id(role)")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!row) return null;
  const extra = (row as unknown as { admin_extra_roles?: { role: string }[] }).admin_extra_roles;
  return { ...row, extra_roles: (extra ?? []).map((r: { role: string }) => r.role) };
}

function isSuperAdmin(caller: { role: string; extra_roles?: string[] }): boolean {
  return caller.role === "super_admin" || (caller.extra_roles ?? []).includes("super_admin");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const caller = await getCallerAdmin(req);
  if (!caller) return json({ error: "غير مصرح — سجّل دخولك تاني" }, 401);
  // ملاحظة: has_archive_review_access مكانتش متجابة من قبل هنا (select ماكانش شامله)
  // فكانت بترجع undefined دايماً — تم تصحيحها هنا كجزء من نفس التعديل (select فوق).
  const canReview = caller.has_archive_review_access || isSuperAdmin(caller);
  const allowed = caller.has_archive_access || canReview || caller.has_archive_view_only;
  if (!allowed) return json({ error: "مفيش صلاحية أرشيف المرضى" }, 403);
  // "طبيب سونو" بمعاينة فقط (من غير أرشيف كامل/مراجعة) — يشوف بس المرضى
  // المحالين له (patient_doctor_assignments)، مش الأرشيف كله
  const doctorOnly = caller.has_archive_view_only && !caller.has_archive_access && !canReview;

  const url = new URL(req.url);
  const patientId = url.searchParams.get("patient_id");
  const search = url.searchParams.get("search")?.trim();
  const reviewStatus = url.searchParams.get("review_status"); // pending/approved/rejected — للمراجع بس
  const statsMode = url.searchParams.get("stats") === "1";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("page_size") ?? "20") || 20));

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // الداشبورد العام مش موجه لدكتور "معاينة محالة فقط" — مفيش له داعي
  if (statsMode && doctorOnly) return json({ error: "مفيش صلاحية" }, 403);

  // داشبورد عام: إجماليات + آخر الإضافات
  if (statsMode) {
    const [{ count: totalPatients }, { count: totalFiles }, { count: pendingReview }, recentPatients, recentFiles] =
      await Promise.all([
        admin.from("patients").select("id", { count: "exact", head: true }),
        admin.from("patient_files").select("id", { count: "exact", head: true }),
        admin.from("patient_files").select("id", { count: "exact", head: true }).eq("review_status", "pending"),
        admin.from("patients").select("id, patient_code, full_name, created_at").order("created_at", { ascending: false }).limit(8),
        admin.from("patient_files").select("id, file_name, category, review_status, uploaded_at, patient_id, patients(full_name, patient_code)").order("uploaded_at", { ascending: false }).limit(8),
      ]);
    return json({
      total_patients: totalPatients ?? 0,
      total_files: totalFiles ?? 0,
      pending_review: pendingReview ?? 0,
      recent_patients: recentPatients.data ?? [],
      recent_files: recentFiles.data ?? [],
    });
  }

  // لو patient_id متبعت، رجّع بيانات المريض + كل ملفاته مصنّفة
  if (patientId) {
    if (doctorOnly) {
      const { data: assignment } = await admin
        .from("patient_doctor_assignments")
        .select("id")
        .eq("patient_id", patientId)
        .eq("doctor_id", caller.id)
        .eq("status", "pending")
        .maybeSingle();
      if (!assignment) return json({ error: "المريض ده مش محال لك" }, 403);
    }
    const { data: patient, error: pErr } = await admin
      .from("patients")
      .select("id, patient_code, full_name, phone, status, gender, age, medical_record_no, last_visit_date, created_at")
      .eq("id", patientId)
      .maybeSingle();
    if (pErr || !patient) return json({ error: "المريض غير موجود" }, 404);

    let filesQuery = admin
      .from("patient_files")
      .select("id, category, file_name, file_size, mime_type, uploaded_at, uploaded_by, review_status, reviewed_by, reviewed_at, review_notes, other_description, uploader:admins!uploaded_by(name), reviewer:admins!reviewed_by(name)")
      .eq("patient_id", patientId)
      .order("uploaded_at", { ascending: false });
    if (reviewStatus) filesQuery = filesQuery.eq("review_status", reviewStatus);
    const { data: rawFiles, error: fErr } = await filesQuery;
    if (fErr) return json({ error: fErr.message }, 500);
    const files = (rawFiles ?? []).map((f: any) => ({
      ...f,
      uploaded_by_name: f.uploader?.name ?? null,
      reviewed_by_name: f.reviewer?.name ?? null,
      uploader: undefined,
      reviewer: undefined,
    }));

    if (caller.has_archive_access || caller.has_archive_view_only) {
      await admin.from("archive_access_log").insert({
        patient_id: patientId,
        employee_id: caller.id,
        action: "view",
      });
    }

    return json({ patient, files: files });
  }

  // وضع المراجعة: كل الملفات المعلّقة عبر كل المرضى (مش مربوطة بمريض واحد)
  if (reviewStatus && !canReview) return json({ error: "مفيش صلاحية مراجعة" }, 403);
  if (reviewStatus) {
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;
    const { data: rawFiles, error, count } = await admin
      .from("patient_files")
      .select("id, category, file_name, file_size, mime_type, uploaded_at, uploaded_by, review_status, other_description, patient_id, patients(full_name, patient_code), uploader:admins!uploaded_by(name)", { count: "exact" })
      .eq("review_status", reviewStatus)
      .order("uploaded_at", { ascending: true })
      .range(from, to);
    if (error) return json({ error: error.message }, 500);
    const files = (rawFiles ?? []).map((f: any) => ({
      ...f,
      uploaded_by_name: f.uploader?.name ?? null,
      uploader: undefined,
    }));
    return json({ files: files, total: count ?? 0, page, page_size: pageSize });
  }

  // "طبيب سونو" (معاينة محالة فقط): بس المرضى المحالين له وقيد الكشف —
  // مش أرشيف كل المرضى، ومفيش بحث/صفحات هنا (طابور يومي صغير عادةً)
  if (doctorOnly) {
    const { data: rows, error } = await admin
      .from("patient_doctor_assignments")
      .select("id, assigned_at, patients(id, patient_code, full_name, phone, status, created_at)")
      .eq("doctor_id", caller.id)
      .eq("status", "pending")
      .order("assigned_at", { ascending: true });
    if (error) return json({ error: error.message }, 500);
    const patients = (rows ?? [])
      .filter((r: any) => r.patients)
      .map((r: any) => ({ ...r.patients, assignment_id: r.id, assigned_at: r.assigned_at }));
    return json({ patients, total: patients.length, page: 1, page_size: patients.length });
  }

  // من غير patient_id: قائمة/بحث المرضى (اسم أو رقم أو patient_code)
  let query = admin
    .from("patients")
    .select("id, patient_code, full_name, phone, status, gender, age, medical_record_no, last_visit_date, created_at", { count: "exact" })
    .order("created_at", { ascending: false });

  if (search) {
    // ملحوظة: template literal هنا كان بيفشل نشر Edge Function بخطأ "Expected unicode
    // escape" من bundler دينو (على الأغلب بسبب الـ backtick المتداخل) — استُبدل
    // بـ concatenation عادي كإصلاح مطابق للنسخة المنشورة فعلياً (٢٠٢٦-٠٨-٢٣).
    query = query.or(
      "full_name.ilike.%" + search + "%,phone.ilike.%" + search + "%,phone_normalized.ilike.%" + search + "%,patient_code.ilike.%" + search + "%",
    );
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data: patients, error, count } = await query.range(from, to);
  if (error) return json({ error: error.message }, 500);

  return json({ patients: patients ?? [], total: count ?? 0, page, page_size: pageSize });
});
