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
const VALID_STATUSES = [
  "new",
  "in_progress",
  "booked",
  "interested_undecided",
  "rejected",
  "no_response",
  "invalid_number",
];
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
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const caller = await getCallerAdmin(req);
  if (!caller) return json({ error: "غير مصرح — سجّل دخولك تاني" }, 401);
  const allowed = ["reception", "customer_service", "general_manager", "super_admin"].includes(caller.role);
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
  const priority = body.priority?.toString().trim() || null;
  const doNotContact = typeof body.do_not_contact === "boolean" ? body.do_not_contact : null;

  if (!leadId) return json({ error: "lead_id مطلوب" }, 400);
  if (newStatus && !VALID_STATUSES.includes(newStatus)) {
    return json({ error: `current_status لازم يكون واحد من: ${VALID_STATUSES.join(", ")}` }, 400);
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

  // خدمة العملاء تعدّل بس الليدز المُسندة ليها
  if (caller.role === "customer_service" && lead.assigned_to !== caller.id) {
    return json({ error: "الليد ده مش مُسند لك" }, 403);
  }

  const updates: Record<string, unknown> = {};
  if (newStatus) {
    updates.current_status = newStatus;
    if (CLOSED_STATUSES.includes(newStatus)) updates.closed_at = new Date().toISOString();
    else updates.closed_at = null;
  }
  if (bookingReference !== null) updates.booking_reference = bookingReference;
  if (priority) updates.priority = priority;
  if (doNotContact !== null) updates.do_not_contact = doNotContact;
  updates.updated_at = new Date().toISOString();

  if (Object.keys(updates).length === 0) return json({ error: "مفيش أي تحديث اتبعت" }, 400);

  const { data: updated, error: updErr } = await admin
    .from("leads")
    .update(updates)
    .eq("id", leadId)
    .select("id, customer_name, current_status, priority, do_not_contact, booking_reference, closed_at, updated_at")
    .single();
  // ملاحظة: تريجر trg_log_lead_status_change بيسجل التغيير تلقائياً في lead_status_log — مفيش داعي نسجله يدوي هنا
  if (updErr) return json({ error: updErr.message }, 500);

  return json({ lead: updated });
});
