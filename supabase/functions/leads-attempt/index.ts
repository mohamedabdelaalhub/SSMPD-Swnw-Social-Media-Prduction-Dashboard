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

// نفس القيم المسموحة في check constraint بتاع lead_attempts.result في setup.sql
const VALID_RESULTS = ["answered", "no_answer", "busy", "call_back_later", "other"];

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
    .select("id, role, active, admin_extra_roles(role)")
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
  const result = (body.result ?? "").toString().trim();
  const notes = (body.notes ?? "").toString().trim() || null;
  const nextFollowUpDate = body.next_follow_up_date ? body.next_follow_up_date.toString() : null;

  if (!leadId) return json({ error: "lead_id مطلوب" }, 400);
  if (!VALID_RESULTS.includes(result)) {
    return json({ error: `result لازم يكون واحد من: ${VALID_RESULTS.join(", ")}` }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: lead, error: leadErr } = await admin
    .from("leads")
    .select("id, assigned_to, current_status")
    .eq("id", leadId)
    .maybeSingle();
  if (leadErr || !lead) return json({ error: "الليد غير موجود" }, 404);

  // خدمة العملاء تسجّل محاولات بس على الليدز المُسندة ليها
  if (caller.role === "customer_service" && lead.assigned_to !== caller.id) {
    return json({ error: "الليد ده مش مُسند لك" }, 403);
  }

  const { data: attempt, error: attErr } = await admin
    .from("lead_attempts")
    .insert({
      lead_id: leadId,
      employee_id: caller.id,
      result,
      notes,
      next_follow_up_date: nextFollowUpDate,
      status_at_attempt: lead.current_status,
    })
    .select("id, lead_id, employee_id, result, notes, next_follow_up_date, attempt_date, status_at_attempt")
    .single();
  if (attErr) return json({ error: attErr.message }, 500);

  // تحديث معاد المتابعة الجاي على الليد نفسه لو اتبعت، وترقية الحالة من "new" لـ"in_progress"
  // أول ما بيحصل أول محاولة تواصل فعلية (بدون التأثير على أي حالة نهائية موجودة بالفعل)
  const updates: Record<string, unknown> = {};
  if (nextFollowUpDate) updates.next_follow_up_date = nextFollowUpDate;
  if (lead.current_status === "new") updates.current_status = "in_progress";

  if (Object.keys(updates).length > 0) {
    const { error: updErr } = await admin.from("leads").update(updates).eq("id", leadId);
    if (updErr) return json({ error: updErr.message }, 500);
  }

  return json({ attempt });
});
