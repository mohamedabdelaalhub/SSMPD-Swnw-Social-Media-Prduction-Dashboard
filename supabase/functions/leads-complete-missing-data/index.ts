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

// نفس منطق تطبيع الهاتف بالظبط زي leads-create/leads-bulk-create
function normalizePhone(raw: string): string {
  if (!raw) return "";
  let s = raw.replace(/[‎‏‪-‮\s\-()]/g, "");
  s = s.replace(/^00/, "+");
  if (/^01[0125]\d{8}$/.test(s)) s = "+2" + s;
  else if (/^1[0125]\d{8}$/.test(s)) s = "+20" + s;
  else if (!s.startsWith("+")) s = "+" + s.replace(/^0+/, "");
  return s;
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
    .select("id, role, active, admin_extra_roles!admin_id(role)")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!row) return null;
  const extra = (row as unknown as { admin_extra_roles?: { role: string }[] }).admin_extra_roles;
  return { ...row, extra_roles: (extra ?? []).map((r: { role: string }) => r.role) };
}

function roleIn(caller: { role: string; extra_roles?: string[] }, roles: string[]): boolean {
  return roles.includes(caller.role) || (caller.extra_roles ?? []).some((r) => roles.includes(r));
}

// استكمال بيانات عميل "ناقص بيانات" (اتضاف من رفع إكسيل ناقص اسم/تليفون) —
// بعد ما الموظف يكلمه ويجيب الناقص، الدالة دي بتحدّث الاسم/التليفون وتحوّل
// current_status من missing_data لـ new (يدخل دورة العمل العادية من هنا).
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

  const leadId = (body.lead_id ?? "").toString().trim();
  const customerName = (body.customer_name ?? "").toString().trim();
  const phoneRaw = (body.phone ?? "").toString().trim();
  if (!leadId) return json({ error: "lead_id مطلوب" }, 400);
  if (!customerName || !phoneRaw) return json({ error: "الاسم والتليفون لازم يتملوا الاتنين" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: lead, error: findErr } = await admin
    .from("leads")
    .select("id, assigned_to, current_status")
    .eq("id", leadId)
    .maybeSingle();
  if (findErr || !lead) return json({ error: "الليد غير موجود" }, 404);
  if (lead.current_status !== "missing_data") {
    return json({ error: "الليد ده مش في قائمة عملاء ناقصين بيانات" }, 400);
  }

  const isManager = roleIn(caller, ["general_manager", "super_admin"]);
  const isOwnerCs = roleIn(caller, ["customer_service"]) && lead.assigned_to === caller.id;
  if (!isManager && !isOwnerCs && !roleIn(caller, ["reception"])) {
    return json({ error: "مش مسموح تعدّل الليد ده" }, 403);
  }

  const phoneNormalized = normalizePhone(phoneRaw);

  const { data: dup } = await admin
    .from("leads")
    .select("id")
    .eq("phone_normalized", phoneNormalized)
    .neq("id", leadId)
    .not("current_status", "in", "(service_done,rejected,no_response,invalid_number)")
    .limit(1)
    .maybeSingle();
  if (dup) return json({ error: "فيه ليد مفتوح بالفعل بنفس الرقم" }, 409);

  const { data: matchedPatient } = await admin
    .from("patients")
    .select("id")
    .eq("phone_normalized", phoneNormalized)
    .maybeSingle();

  const { error: updateErr } = await admin
    .from("leads")
    .update({
      customer_name: customerName,
      phone_raw: phoneRaw,
      phone_normalized: phoneNormalized,
      patient_id: matchedPatient?.id ?? null,
      patient_type: matchedPatient ? "existing" : "new",
      current_status: "new",
      missing_data_completed_at: new Date().toISOString(),
    })
    .eq("id", leadId);
  if (updateErr) return json({ error: updateErr.message }, 500);

  return json({ ok: true });
});
