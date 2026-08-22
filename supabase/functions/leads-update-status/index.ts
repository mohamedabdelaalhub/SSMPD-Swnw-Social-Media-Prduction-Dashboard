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

// نفس القيم المسموحة في check constraint بتاع leads.current_status في setup.sql
// (بعد إضافة "تم الحجز على سيستم المركز" و"تم إجراء الخدمة")
const VALID_STATUSES = [
  "new",
  "in_progress",
  "booked",
  "booked_on_system",
  "service_done",
  "interested_undecided",
  "rejected",
  "no_response",
  "invalid_number",
];
// "booked"/"booked_on_system" بقوا حالات "لسه شغالة" (مش مغلقة) بعد إضافة
// خطوة الاستقبال — الإقفال الفعلي بقى بس عند "تم إجراء الخدمة" أو أي حالة رفض/عدم رد
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
  // تعدد الأدوار: مضمومة في نفس استعلام admins فوق (join) بدل نداء منفصل —
  // أسرع (رحلة شبكة واحدة بدل اتنين) لكل استدعاء للدالة دي
  const extra = (row as unknown as { admin_extra_roles?: { role: string }[] }).admin_extra_roles;
  return { ...row, extra_roles: (extra ?? []).map((r: { role: string }) => r.role) };
}

// true لو الرول الأساسي أو أي من الأدوار الإضافية موجود في القائمة
function roleIn(caller: { role: string; extra_roles?: string[] }, roles: string[]): boolean {
  return roles.includes(caller.role) || (caller.extra_roles ?? []).some((r) => roles.includes(r));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const caller = await getCallerAdmin(req);
  if (!caller) return json({ error: "غير مصرح — سجّل دخولك تاني" }, 401);
  const allowed = roleIn(caller, ["reception", "customer_service", "general_manager", "super_admin"]);
  if (!allowed) return json({ error: "مفيش صلاحية موديول الليدز" }, 403);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "بيانات غير صالحة" }, 400);
  }

  const leadId = body.lead_id?.toString();
  const newStatus = (body.current_status ?? "").toString().trim();
  const bookingReference = body.booking_reference?.toString().trim() || null;
  const bookingDate = body.booking_date?.toString().trim() || null;
  const priority = body.priority?.toString().trim() || null;
  const doNotContact = typeof body.do_not_contact === "boolean" ? body.do_not_contact : null;

  if (!leadId) return json({ error: "lead_id مطلوب" }, 400);
  if (newStatus && !VALID_STATUSES.includes(newStatus)) {
    return json({ error: `current_status لازم يكون واحد من: ${VALID_STATUSES.join(", ")}` }, 400);
  }
  // طلب المستخدم: لما الحالة تبقى "تم الحجز" لازم تفاصيل الحجز (رقم الحجز على الأقل)
  if (newStatus === "booked" && !bookingReference) {
    return json({ error: "رقم/مرجع الحجز مطلوب لما الحالة تبقى \"تم الحجز\"" }, 400);
  }
  if (priority && !["high", "medium", "normal"].includes(priority)) {
    return json({ error: "priority لازم يكون high أو medium أو normal" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: lead, error: leadErr } = await admin
    .from("leads")
    .select("id, assigned_to, current_status")
    .eq("id", leadId)
    .maybeSingle();
  if (leadErr || !lead) return json({ error: "الليد غير موجود" }, 404);

  // خدمة العملاء تعدّل بس الليدز المُسندة ليها (إلا لو عنده رول تاني بيديه صلاحية أوسع)
  const hasWiderAccess = roleIn(caller, ["reception", "general_manager", "super_admin"]);
  if (!hasWiderAccess && roleIn(caller, ["customer_service"]) && lead.assigned_to !== caller.id) {
    return json({ error: "الليد ده مش مُسند لك" }, 403);
  }

  const hasUpdate = !!(newStatus || bookingReference !== null || bookingDate !== null || priority || doNotContact !== null);
  if (!hasUpdate) return json({ error: "مفيش أي تحديث اتبعت" }, 400);

  var closedAt: string | null = null;
  var clearClosedAt = false;
  if (newStatus) {
    if (CLOSED_STATUSES.includes(newStatus)) closedAt = new Date().toISOString();
    else clearClosedAt = true;
  }

  // ملاحظة: التحديث بيعدّي من rpc_update_lead (مش .update() مباشرة) عشان يحدد
  // app.caller_admin_id جوّه نفس الترانزاكشن — التريجرز في القاعدة (تسجيل تغيير
  // الحالة/الحقول + توثيق مين أنهى الحجز) بتعتمد على القيمة دي لما الاتصال بيحصل
  // بالـ service role زي هنا (my_admin_id() العادي بيرجع فاضي في السياق ده)
  const { data: updated, error: updErr } = await admin.rpc("rpc_update_lead", {
    p_lead_id: leadId,
    p_caller_id: caller.id,
    p_current_status: newStatus || null,
    p_booking_reference: bookingReference,
    p_clear_booking_reference: false,
    p_booking_date: bookingDate,
    p_priority: priority,
    p_do_not_contact: doNotContact,
    p_closed_at: closedAt,
    p_clear_closed_at: clearClosedAt,
  }).single();
  if (updErr) return json({ error: updErr.message }, 500);

  return json({ lead: updated });
});
