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

const CLOSED_STATUSES = ["booked", "rejected", "no_response", "invalid_number"];

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const caller = await getCallerAdmin(req);
  if (!caller) return json({ error: "غير مصرح — سجّل دخولك تاني" }, 401);
  const allowed = ["reception", "customer_service", "general_manager", "super_admin"].includes(caller.role);
  if (!allowed) return json({ error: "مفيش صلاحية موديول الليدز" }, 403);

  const url = new URL(req.url);
  const admin0 = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // وضع خفيف: قائمة أسماء الموظفين لملء فلتر "الموظف اللي أنهى الحجز" في أرشيف الليدز
  if (url.searchParams.get("list_employees") === "1") {
    const { data: employees, error: empErr } = await admin0
      .from("admins")
      .select("id, name, role")
      .in("role", ["reception", "customer_service", "general_manager", "super_admin"])
      .eq("active", true)
      .order("name");
    if (empErr) return json({ error: empErr.message }, 500);
    return json({ employees: employees ?? [] });
  }

  // داشبورد الإدارة: إجماليات مفتوح/مغلق + توزيع حسب الحالة
  if (url.searchParams.get("stats") === "1") {
    if (!["general_manager", "super_admin"].includes(caller.role)) {
      return json({ error: "داشبورد الإدارة مقصور على المدير العام/السوبر أدمن" }, 403);
    }
    const admin1 = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const [{ count: totalOpen }, { count: totalClosed }, { count: totalBooked }, byStatus] = await Promise.all([
      admin1.from("leads").select("id", { count: "exact", head: true }).not("current_status", "in", `(${CLOSED_STATUSES.join(",")})`),
      admin1.from("leads").select("id", { count: "exact", head: true }).in("current_status", CLOSED_STATUSES),
      admin1.from("leads").select("id", { count: "exact", head: true }).eq("current_status", "booked"),
      admin1.from("leads").select("current_status"),
    ]);
    const statusCounts: Record<string, number> = {};
    (byStatus.data ?? []).forEach((r: { current_status: string }) => {
      statusCounts[r.current_status] = (statusCounts[r.current_status] ?? 0) + 1;
    });
    return json({
      open: totalOpen ?? 0,
      closed: totalClosed ?? 0,
      booked: totalBooked ?? 0,
      by_status: statusCounts,
    });
  }

  const status = url.searchParams.get("status")?.trim();
  const search = url.searchParams.get("search")?.trim();
  const openOnly = url.searchParams.get("open_only") === "true";
  const bookedBy = url.searchParams.get("booked_by")?.trim(); // فلتر أرشيف الليدز: الموظف اللي أنهى الحجز
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("page_size") ?? "20") || 20));

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let query = admin
    .from("leads")
    .select(
      "id, customer_name, phone_raw, phone_normalized, source, current_status, patient_type, assigned_to, interested_service, requested_department, priority, booking_reference, booking_date, booked_by, created_at, closed_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false });

  // خدمة العملاء تشوف بس الليدز المُسندة لها (RLS بتفرضها أصلاً، بس بنفلتر هنا كمان للوضوح)
  if (caller.role === "customer_service") {
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
