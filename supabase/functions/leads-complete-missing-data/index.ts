import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const SERVICES = [
  "checkup",
  "consultation",
  "radiology",
  "lab",
  "nursing",
  "physiotherapy",
  "treatment",
  "dental",
  "speech_therapy",
  "psychiatry",
  "cosmetic_laser",
  "emergency",
  "other"
];
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json"
    }
  });
}
function normalizePhone(raw) {
  if (!raw) return "";
  let s = raw.replace(/[‎‏‪-‮\s\-()]/g, "");
  s = s.replace(/^00/, "+");
  if (/^01[0125]\d{8}$/.test(s)) s = "+2" + s;
  else if (/^1[0125]\d{8}$/.test(s)) s = "+20" + s;
  else if (!s.startsWith("+")) s = "+" + s.replace(/^0+/, "");
  return s;
}
function isTripleName(name) {
  return name.trim().replace(/\s+/g, " ").split(" ").filter(Boolean).length >= 3;
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
// owner 2026-11-25 «الليدز تشوف كلها»: an active «أرشيف الليدز» grant holder works all leads (reception scope)
function hasLeadsGrant(caller) {
  return caller.has_leads_archive_access === true;
}
function roleIn(caller, roles) {
  return roles.includes(caller.role) || (caller.extra_roles ?? []).some((r)=>roles.includes(r));
}
Deno.serve(async (req)=>{
  if (req.method === "OPTIONS") return new Response(null, {
    headers: CORS
  });
  if (req.method !== "POST") return json({
    error: "Method not allowed"
  }, 405);
  const caller = await getCallerAdmin(req);
  if (!caller) return json({
    error: "غير مصرح — سجّل دخولك تاني"
  }, 401);
  if (!roleIn(caller, [
    "reception",
    "customer_service",
    "general_manager",
    "super_admin"
  ]) && !hasLeadsGrant(caller)) return json({
    error: "مفيش صلاحية موديول الليدز"
  }, 403);
  let body;
  try {
    body = await req.json();
  } catch  {
    return json({
      error: "بيانات غير صالحة"
    }, 400);
  }
  const leadId = (body.lead_id ?? "").toString().trim();
  const customerName = (body.customer_name ?? "").toString().trim();
  const phoneRaw = (body.phone ?? "").toString().trim();
  const requestedService = body.interested_service == null ? null : body.interested_service.toString().trim() || null;
  if (!leadId) return json({
    error: "lead_id مطلوب"
  }, 400);
  if (!customerName || !phoneRaw) return json({
    error: "الاسم والتليفون لازم يتملوا الاتنين"
  }, 400);
  if (!isTripleName(customerName)) return json({
    error: "اسم العميل لازم يكون ثلاثي على الأقل"
  }, 400);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: lead, error: findErr } = await admin.from("leads").select("id, assigned_to, current_status, interested_service").eq("id", leadId).maybeSingle();
  if (findErr || !lead) return json({
    error: "الليد غير موجود"
  }, 404);
  if (lead.current_status !== "missing_data") return json({
    error: "الليد ده مش في قائمة عملاء ناقصين بيانات"
  }, 400);
  const finalService = requestedService || lead.interested_service || null;
  if (!finalService) return json({
    error: "اختار الخدمة اللي العميل مهتم بيها"
  }, 400);
  if (!SERVICES.includes(finalService)) return json({
    error: "الخدمة المختارة غير صالحة"
  }, 400);
  const isManager = roleIn(caller, [
    "general_manager",
    "super_admin"
  ]);
  const isOwnerCs = roleIn(caller, [
    "customer_service"
  ]) && lead.assigned_to === caller.id;
  if (!isManager && !isOwnerCs && !roleIn(caller, [
    "reception"
  ]) && !hasLeadsGrant(caller)) return json({
    error: "مش مسموح تعدّل الليد ده"
  }, 403);
  const phoneNormalized = normalizePhone(phoneRaw);
  if (!phoneNormalized) return json({
    error: "رقم الهاتف غير صالح"
  }, 400);
  const { data: dup } = await admin.from("leads").select("id").eq("phone_normalized", phoneNormalized).neq("id", leadId).not("current_status", "in", "(service_done,rejected,no_response,invalid_number)").limit(1).maybeSingle();
  if (dup) return json({
    error: "فيه ليد مفتوح بالفعل بنفس الرقم"
  }, 409);
  const { data: matchedPatient } = await admin.from("patients").select("id").eq("phone_normalized", phoneNormalized).maybeSingle();
  const { error: updateErr } = await admin.from("leads").update({
    customer_name: customerName,
    phone_raw: phoneRaw,
    phone_normalized: phoneNormalized,
    interested_service: finalService,
    patient_id: matchedPatient?.id ?? null,
    patient_type: matchedPatient ? "existing" : "new",
    current_status: "new",
    missing_data_completed_at: new Date().toISOString()
  }).eq("id", leadId);
  if (updateErr) return json({
    error: updateErr.message
  }, 500);
  // owner 2026-11-25 «اي حركة بيعملها عندنا تقرير منها»: who completed the missing data (public.lead_activity_log, 20261125150000)
  await admin.from("lead_activity_log").insert({
    admin_id: caller.id,
    action: "complete_missing_data",
    lead_id: leadId,
    detail: {
      customer_name: customerName,
      patient_type: matchedPatient ? "existing" : "new"
    }
  });
  return json({
    ok: true
  });
});
