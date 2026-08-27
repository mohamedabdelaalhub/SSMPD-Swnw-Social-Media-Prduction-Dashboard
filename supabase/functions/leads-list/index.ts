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

// "booked"/"booked_on_system" بقوا حالات "لسه شغالة" بعد إضافة خطوة الاستقبال —
// الإقفال الفعلي بقى بس عند "تم إجراء الخدمة" أو أي حالة رفض/عدم رد
const CLOSED_STATUSES = ["service_done", "rejected", "no_response", "invalid_number"];

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
    .select("id, role, active, admin_extra_roles!admin_id(role)")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!row) return null;
  const extra = (row as unknown as { admin_extra_roles?: { role: string }[] }).admin_extra_roles;
  return { ...row, extra_roles: (extra ?? []).map((r: { role: string }) => r.role) };
}

// true لو الرول الأساسي أو أي من الأدوار الإضافية موجود في القائمة
function roleIn(caller: { role: string; extra_roles?: string[] }, roles: string[]): boolean {
  return roles.includes(caller.role) || (caller.extra_roles ?? []).some((r) => roles.includes(r));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const caller = await getCallerAdmin(req);
  if (!caller) return json({ error: "غير مصرح — سجّل دخولك تاني" }, 401);
  const allowed = roleIn(caller, ["reception", "customer_service", "general_manager", "super_admin"]);
  if (!allowed) return json({ error: "مفيش صلاحية موديول الليدز" }, 403);

  const url = new URL(req.url);
  const admin0 = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // وضع خفيف: قائمة أسماء الموظفين لملء فلتر "الموظف اللي أنهى الحجز" في أرشيف الليدز
  if (url.searchParams.get("list_employees") === "1") {
    // بيشمل الرول الأساسي أو أي رول إضافي — عشان موظف عنده الرول كإضافي
    // (مش أساسي) يظهر برضه في أسماء "بواسطة"/سجل المحاولات/تغييرات الحالة
    const allowedRoles = ["reception", "customer_service", "general_manager", "super_admin"];
    const { data: allAdmins, error: empErr } = await admin0
      .from("admins")
      .select("id, name, role, admin_extra_roles!admin_id(role)")
      .eq("active", true)
      .order("name");
    if (empErr) return json({ error: empErr.message }, 500);
    const employees = (allAdmins ?? [])
      .filter((a: any) => {
        const extra = ((a.admin_extra_roles ?? []) as { role: string }[]).map((r) => r.role);
        return allowedRoles.includes(a.role) || extra.some((r: string) => allowedRoles.includes(r));
      })
      .map((a: any) => ({ id: a.id, name: a.name, role: a.role }));
    return json({ employees });
  }

  // داشبورد الإدارة: إجماليات مفتوح/مغلق + توزيع حسب الحالة + الدخل من الفواتير
  // مجمّع حسب الموظف اللي أنهى الحجز (booked_by) وحسب القسم المطلوب
  // (requested_department) + تصنيف عضوي/إعلان — كل ده بيقبل فلتر تاريخ اختياري
  // (from/to) على تاريخ رفع الفاتورة (لدخل) وتاريخ استلام الليد (لتصنيف عضوي/إعلان)
  if (url.searchParams.get("stats") === "1") {
    if (!roleIn(caller, ["general_manager", "super_admin"])) {
      return json({ error: "داشبورد الإدارة مقصور على المدير العام/السوبر أدمن" }, 403);
    }
    const fromDate = url.searchParams.get("from")?.trim() || null;
    const toDate = url.searchParams.get("to")?.trim() || null;

    const admin1 = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    let leadsQuery = admin1.from("leads").select("current_status, acquisition_type");
    if (fromDate) leadsQuery = leadsQuery.gte("created_at", fromDate);
    if (toDate) leadsQuery = leadsQuery.lte("created_at", toDate + "T23:59:59");

    let invoicesQuery = admin1.from("lead_invoices").select("amount, uploaded_at, lead:leads!inner(booked_by, requested_department)");
    if (fromDate) invoicesQuery = invoicesQuery.gte("uploaded_at", fromDate);
    if (toDate) invoicesQuery = invoicesQuery.lte("uploaded_at", toDate + "T23:59:59");

    const [{ count: totalOpen }, { count: totalClosed }, { count: totalBooked }, leadsRes, invoicesRes] = await Promise.all([
      admin1.from("leads").select("id", { count: "exact", head: true }).not("current_status", "in", `(${CLOSED_STATUSES.join(",")})`),
      admin1.from("leads").select("id", { count: "exact", head: true }).in("current_status", CLOSED_STATUSES),
      admin1.from("leads").select("id", { count: "exact", head: true }).eq("current_status", "booked"),
      leadsQuery,
      invoicesQuery,
    ]);
    const statusCounts: Record<string, number> = {};
    const acquisitionCounts: Record<string, number> = { organic: 0, ad: 0, unknown: 0 };
    (leadsRes.data as { current_status: string; acquisition_type: string | null }[] | null ?? []).forEach((r) => {
      statusCounts[r.current_status] = (statusCounts[r.current_status] ?? 0) + 1;
      const key = r.acquisition_type === "organic" || r.acquisition_type === "ad" ? r.acquisition_type : "unknown";
      acquisitionCounts[key] += 1;
    });

    // إجمالي الدخل + تجميعه حسب الموظف المسؤول عن إتمام الحجز (booked_by)
    // وحسب القسم المطلوب (requested_department) — نفس بيانات الفواتير، تجميعين مختلفين
    let totalIncome = 0;
    const incomeByEmployee: Record<string, { total: number; count: number }> = {};
    const incomeByDept: Record<string, { total: number; count: number }> = {};
    type InvoiceRow = {
      amount: number;
      lead: { booked_by: string | null; requested_department: string | null }
        | { booked_by: string | null; requested_department: string | null }[] | null;
    };
    (invoicesRes.data as InvoiceRow[] | null ?? []).forEach((r) => {
      const amount = Number(r.amount) || 0;
      totalIncome += amount;
      const leadRel = Array.isArray(r.lead) ? r.lead[0] : r.lead;
      const bookedBy = leadRel?.booked_by ?? "unknown";
      if (!incomeByEmployee[bookedBy]) incomeByEmployee[bookedBy] = { total: 0, count: 0 };
      incomeByEmployee[bookedBy].total += amount;
      incomeByEmployee[bookedBy].count += 1;
      const dept = (leadRel?.requested_department ?? "").trim() || "غير محدد";
      if (!incomeByDept[dept]) incomeByDept[dept] = { total: 0, count: 0 };
      incomeByDept[dept].total += amount;
      incomeByDept[dept].count += 1;
    });
    const employeeIds = Object.keys(incomeByEmployee).filter((id) => id !== "unknown");
    let employeeNames: Record<string, string> = {};
    if (employeeIds.length) {
      const { data: names } = await admin1.from("admins").select("id, name").in("id", employeeIds);
      (names ?? []).forEach((n: { id: string; name: string }) => { employeeNames[n.id] = n.name; });
    }
    const incomeByEmployeeArr = Object.keys(incomeByEmployee).map((id) => ({
      employee_id: id === "unknown" ? null : id,
      employee_name: id === "unknown" ? "غير معروف" : (employeeNames[id] || "—"),
      total: incomeByEmployee[id].total,
      invoices_count: incomeByEmployee[id].count,
    })).sort((a, b) => b.total - a.total);
    const incomeByDeptArr = Object.keys(incomeByDept).map((dept) => ({
      department: dept,
      total: incomeByDept[dept].total,
      invoices_count: incomeByDept[dept].count,
    })).sort((a, b) => b.total - a.total);

    return json({
      open: totalOpen ?? 0,
      closed: totalClosed ?? 0,
      booked: totalBooked ?? 0,
      by_status: statusCounts,
      by_acquisition_type: acquisitionCounts,
      total_income: totalIncome,
      invoices_count: (invoicesRes.data ?? []).length,
      income_by_employee: incomeByEmployeeArr,
      income_by_department: incomeByDeptArr,
      filter_from: fromDate,
      filter_to: toDate,
    });
  }

  const status = url.searchParams.get("status")?.trim();
  const search = url.searchParams.get("search")?.trim();
  const openOnly = url.searchParams.get("open_only") === "true";
  const bookedBy = url.searchParams.get("booked_by")?.trim(); // فلتر أرشيف الليدز: الموظف اللي أنهى الحجز
  const completedMissingData = url.searchParams.get("completed_missing_data") === "1";
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("page_size") ?? "20") || 20));

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let query = admin
    .from("leads")
    .select(
      "id, customer_name, phone_raw, phone_normalized, source, current_status, patient_type, assigned_to, interested_service, requested_department, priority, booking_reference, booking_date, booked_by, created_at, closed_at, missing_data_completed_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false });

  // خدمة العملاء تشوف بس الليدز المُسندة لها (RLS بتفرضها أصلاً، بس بنفلتر هنا كمان للوضوح)
  // — إلا لو عنده رول تاني بيديه صلاحية أوسع (استقبال/مدير عام/سوبر أدمن)
  const hasWiderAccess = roleIn(caller, ["reception", "general_manager", "super_admin"]);
  if (!hasWiderAccess && roleIn(caller, ["customer_service"])) {
    query = query.eq("assigned_to", caller.id);
  }

  if (status) {
    query = query.eq("current_status", status);
  } else if (openOnly) {
    query = query.not("current_status", "in", `(${CLOSED_STATUSES.join(",")})`);
  }

  if (bookedBy) {
    query = query.eq("booked_by", bookedBy);
  }

  if (completedMissingData) {
    query = query.not("missing_data_completed_at", "is", null);
  }

  if (search) {
    query = query.or(
      `customer_name.ilike.%${search}%,phone_raw.ilike.%${search}%,phone_normalized.ilike.%${search}%`,
    );
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data: leads, error, count } = await query.range(from, to);
  if (error) return json({ error: error.message }, 500);

  return json({ leads: leads ?? [], total: count ?? 0, page, page_size: pageSize });
});
