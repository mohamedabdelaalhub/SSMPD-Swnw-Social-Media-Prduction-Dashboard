import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
};
const CLOSED_STATUSES = [
  "service_done",
  "rejected",
  "no_response",
  "invalid_number"
];
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json"
    }
  });
}
async function getCallerAdmin(req) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: {
      headers: {
        Authorization: authHeader
      }
    }
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return null;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: row } = await admin.from("admins").select("id, role, active, has_leads_archive_access, admin_extra_roles!admin_id(role)").eq("user_id", user.id).eq("active", true).maybeSingle();
  if (!row) return null;
  const extra = row.admin_extra_roles;
  return {
    ...row,
    extra_roles: (extra ?? []).map((r)=>r.role)
  };
}
function roleIn(caller, roles) {
  return roles.includes(caller.role) || (caller.extra_roles ?? []).some((r)=>roles.includes(r));
}
function basicMissingFields(lead) {
  const missing = [];
  const name = String(lead?.customer_name ?? "").trim().replace(/\s+/g, " ");
  const parts = name && name !== "بدون اسم" ? name.split(" ").filter(Boolean) : [];
  if (parts.length < 3) missing.push("name");
  const phone = String(lead?.phone_raw || lead?.phone_normalized || "").trim();
  if (!phone) missing.push("phone");
  const service = String(lead?.interested_service ?? "").trim();
  if (!service) missing.push("service");
  return missing;
}
function matchesMissingFilter(fields, filter) {
  if (!fields.length) return false;
  if (!filter || filter === "any") return true;
  if (filter === "multiple") return fields.length > 1;
  if (filter.endsWith("_only")) {
    const key = filter.slice(0, -5);
    return fields.length === 1 && fields[0] === key;
  }
  return fields.includes(filter);
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: CORS
  });
  if (req.method !== "GET") return json({
    error: "Method not allowed"
  }, 405);
  const caller = await getCallerAdmin(req);
  if (!caller) return json({
    error: "غير مصرح — سجّل دخولك تاني"
  }, 401);
  const archiveAccess = caller.has_leads_archive_access === true;
  if (!archiveAccess && !roleIn(caller, [
    "reception",
    "customer_service",
    "general_manager",
    "super_admin"
  ])) return json({
    error: "مفيش صلاحية موديول الليدز"
  }, 403);
  const url = new URL(req.url);
  const admin0 = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  if (url.searchParams.get("list_employees") === "1") {
    const allowedRoles = [
      "reception",
      "customer_service",
      "general_manager",
      "super_admin"
    ];
    const { data: allAdmins, error: empErr } = await admin0.from("admins").select("id, name, role, has_leads_archive_access, admin_extra_roles!admin_id(role)").eq("active", true).order("name");
    if (empErr) return json({
      error: empErr.message
    }, 500);
    const employees = (allAdmins ?? []).filter((a)=>{
      const extra = (a.admin_extra_roles ?? []).map((r)=>r.role);
      return a.has_leads_archive_access === true || allowedRoles.includes(a.role) || extra.some((r)=>allowedRoles.includes(r));
    }).map((a)=>({
        id: a.id,
        name: a.name,
        role: a.role
      }));
    return json({
      employees
    });
  }
  if (url.searchParams.get("stats") === "1") {
    if (!archiveAccess && !roleIn(caller, [
      "general_manager",
      "super_admin"
    ])) return json({
      error: "تقارير الليدز تحتاج صلاحية أرشيف الليدز أو دور إداري"
    }, 403);
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
      admin1.from("leads").select("id", {
        count: "exact",
        head: true
      }).not("current_status", "in", `(${CLOSED_STATUSES.join(",")})`),
      admin1.from("leads").select("id", {
        count: "exact",
        head: true
      }).in("current_status", CLOSED_STATUSES),
      admin1.from("leads").select("id", {
        count: "exact",
        head: true
      }).eq("current_status", "booked"),
      leadsQuery,
      invoicesQuery
    ]);
    const statusCounts = {};
    const acquisitionCounts = {
      organic: 0,
      ad: 0,
      unknown: 0
    };
    (leadsRes.data ?? []).forEach((r)=>{
      statusCounts[r.current_status] = (statusCounts[r.current_status] ?? 0) + 1;
      const k = r.acquisition_type === "organic" || r.acquisition_type === "ad" ? r.acquisition_type : "unknown";
      acquisitionCounts[k] += 1;
    });
    let totalIncome = 0;
    const incomeByEmployee = {};
    const incomeByDept = {};
    (invoicesRes.data ?? []).forEach((r)=>{
      const amount = Number(r.amount) || 0;
      totalIncome += amount;
      const leadRel = Array.isArray(r.lead) ? r.lead[0] : r.lead;
      const bookedBy = leadRel?.booked_by ?? "unknown";
      if (!incomeByEmployee[bookedBy]) incomeByEmployee[bookedBy] = {
        total: 0,
        count: 0
      };
      incomeByEmployee[bookedBy].total += amount;
      incomeByEmployee[bookedBy].count += 1;
      const dept = (leadRel?.requested_department ?? "").trim() || "غير محدد";
      if (!incomeByDept[dept]) incomeByDept[dept] = {
        total: 0,
        count: 0
      };
      incomeByDept[dept].total += amount;
      incomeByDept[dept].count += 1;
    });
    const employeeIds = Object.keys(incomeByEmployee).filter((id)=>id !== "unknown");
    const employeeNames = {};
    if (employeeIds.length) {
      const { data: names } = await admin1.from("admins").select("id, name").in("id", employeeIds);
      (names ?? []).forEach((n)=>employeeNames[n.id] = n.name);
    }
    const incomeByEmployeeArr = Object.keys(incomeByEmployee).map((id)=>({
        employee_id: id === "unknown" ? null : id,
        employee_name: id === "unknown" ? "غير معروف" : employeeNames[id] || "—",
        total: incomeByEmployee[id].total,
        invoices_count: incomeByEmployee[id].count
      })).sort((a, b)=>b.total - a.total);
    const incomeByDeptArr = Object.keys(incomeByDept).map((dept)=>({
        department: dept,
        total: incomeByDept[dept].total,
        invoices_count: incomeByDept[dept].count
      })).sort((a, b)=>b.total - a.total);
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
      filter_to: toDate
    });
  }
  const status = url.searchParams.get("status")?.trim();
  const search = url.searchParams.get("search")?.trim();
  const openOnly = url.searchParams.get("open_only") === "true";
  const bookedBy = url.searchParams.get("booked_by")?.trim();
  const assignedTo = url.searchParams.get("assigned_to")?.trim();
  const source = url.searchParams.get("source")?.trim();
  const completedMissingData = url.searchParams.get("completed_missing_data") === "1";
  const missingBasic = url.searchParams.get("missing_basic") === "1";
  const missingField = (url.searchParams.get("missing_field") ?? "any").trim();
  const dateFrom = url.searchParams.get("date_from")?.trim() || null;
  const dateTo = url.searchParams.get("date_to")?.trim() || null;
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("page_size") ?? "20") || 20));
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const hasWiderAccess = archiveAccess || roleIn(caller, [
    "reception",
    "general_manager",
    "super_admin"
  ]);
  if (missingBasic) {
    const fields = "id, customer_name, phone_raw, phone_normalized, source, current_status, patient_type, assigned_to, interested_service, requested_department, priority, booking_reference, booking_date, booked_by, created_at, closed_at, missing_data_completed_at";
    const all = [];
    let offset = 0;
    const batchSize = 1000;
    while(true){
      let q = admin.from("leads").select(fields).not("current_status", "in", `(${CLOSED_STATUSES.join(",")})`).order("created_at", {
        ascending: false
      }).order("id", {
        ascending: false
      });
      if (!hasWiderAccess && roleIn(caller, [
        "customer_service"
      ])) q = q.eq("assigned_to", caller.id);
      if (search) q = q.or(`customer_name.ilike.%${search}%,phone_raw.ilike.%${search}%,phone_normalized.ilike.%${search}%`);
      if (dateFrom) q = q.gte("created_at", dateFrom);
      if (dateTo) q = q.lte("created_at", dateTo + "T23:59:59");
      const { data, error } = await q.range(offset, offset + batchSize - 1);
      if (error) return json({
        error: error.message
      }, 500);
      const rows = data ?? [];
      all.push(...rows);
      if (rows.length < batchSize) break;
      offset += batchSize;
    }
    const incomplete = all.map((lead)=>({
        ...lead,
        missing_fields: basicMissingFields(lead)
      })).filter((lead)=>lead.missing_fields.length > 0);
    const stats = {
      total: incomplete.length,
      name: 0,
      phone: 0,
      service: 0,
      multiple: 0,
      new_24h: 0
    };
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    incomplete.forEach((lead)=>{
      const f = lead.missing_fields;
      if (f.includes("name")) stats.name++;
      if (f.includes("phone")) stats.phone++;
      if (f.includes("service")) stats.service++;
      if (f.length > 1) stats.multiple++;
      if (lead.created_at && new Date(lead.created_at).getTime() >= dayAgo) stats.new_24h++;
    });
    const filtered = incomplete.filter((lead)=>matchesMissingFilter(lead.missing_fields, missingField));
    const from = (page - 1) * pageSize, to = from + pageSize;
    return json({
      leads: filtered.slice(from, to),
      total: filtered.length,
      page,
      page_size: pageSize,
      stats,
      missing_field: missingField
    });
  }
  let query = admin.from("leads").select("id, customer_name, phone_raw, phone_normalized, source, current_status, patient_type, assigned_to, interested_service, requested_department, priority, booking_reference, booking_date, booked_by, created_at, closed_at, missing_data_completed_at", {
    count: "exact"
  }).order("created_at", {
    ascending: false
  });
  if (!hasWiderAccess && roleIn(caller, [
    "customer_service"
  ])) query = query.eq("assigned_to", caller.id);
  if (status) query = query.eq("current_status", status);
  else if (openOnly) query = query.not("current_status", "in", `(${CLOSED_STATUSES.join(",")})`);
  if (bookedBy) query = query.eq("booked_by", bookedBy);
  if (source) query = query.eq("source", source);
  if (assignedTo) {
    const { data: allAttempts } = await admin.from("lead_attempts").select("lead_id, employee_id, attempt_date").order("attempt_date", {
      ascending: false
    });
    const latestByLead = {};
    (allAttempts ?? []).forEach((a)=>{
      if (!(a.lead_id in latestByLead)) latestByLead[a.lead_id] = a.employee_id;
    });
    const matchingLeadIds = Object.keys(latestByLead).filter((id)=>latestByLead[id] === assignedTo);
    query = query.in("id", matchingLeadIds.length ? matchingLeadIds : [
      "00000000-0000-0000-0000-000000000000"
    ]);
  }
  if (completedMissingData) query = query.not("missing_data_completed_at", "is", null);
  if (dateFrom) query = query.gte("created_at", dateFrom);
  if (dateTo) query = query.lte("created_at", dateTo + "T23:59:59");
  if (search) query = query.or(`customer_name.ilike.%${search}%,phone_raw.ilike.%${search}%,phone_normalized.ilike.%${search}%`);
  const from = (page - 1) * pageSize, to = from + pageSize - 1;
  const { data: leads, error, count } = await query.range(from, to);
  if (error) return json({
    error: error.message
  }, 500);
  return json({
    leads: leads ?? [],
    total: count ?? 0,
    page,
    page_size: pageSize
  });
});
