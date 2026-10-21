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

const SOURCES = ["whatsapp", "messenger", "phone", "clinic", "doctor_referral"];
const SERVICES = [
  "checkup", "consultation", "radiology", "lab", "nursing", "physiotherapy", "treatment",
  "dental", "speech_therapy", "psychiatry", "cosmetic_laser", "emergency", "other",
];
const ACQUISITION_TYPES = ["organic", "ad"];
const CLOSED_STATUSES = ["service_done", "rejected", "no_response", "invalid_number"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const caller = await getCallerAdmin(req);
  if (!caller) return json({ error: "غير مصرح — سجّل دخولك تاني" }, 401);
  if (!roleIn(caller, ["reception", "customer_service", "general_manager", "super_admin"])) {
    return json({ error: "مفيش صلاحية موديول الليدز" }, 403);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "بيانات غير صالحة" }, 400);
  }

  const leadId = body.lead_id?.toString();
  const customerName = (body.customer_name ?? "").toString().trim();
  const phoneRaw = (body.phone ?? "").toString().trim();
  const source = (body.source ?? "").toString().trim();
  const interestedService = body.interested_service == null ? null : body.interested_service.toString().trim() || null;
  const requestedDepartment = body.requested_department == null ? null : body.requested_department.toString().trim() || null;
  const acquisitionType = body.acquisition_type == null ? null : body.acquisition_type.toString().trim().toLowerCase() || null;
  const messageText = body.message_text == null ? null : body.message_text.toString().trim() || null;

  if (!leadId) return json({ error: "lead_id مطلوب" }, 400);
  if (!customerName) return json({ error: "اسم العميل مطلوب" }, 400);
  if (!phoneRaw) return json({ error: "رقم الهاتف مطلوب" }, 400);
  if (!SOURCES.includes(source)) return json({ error: "مصدر الليد غير صالح" }, 400);
  if (interestedService && !SERVICES.includes(interestedService)) return json({ error: "الخدمة المختارة غير صالحة" }, 400);
  if (acquisitionType && !ACQUISITION_TYPES.includes(acquisitionType)) return json({ error: "مصدر الاهتمام غير صالح" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: lead, error: leadErr } = await admin
    .from("leads")
    .select("id, assigned_to, current_status, patient_id, patient_type, phone_normalized")
    .eq("id", leadId)
    .maybeSingle();
  if (leadErr || !lead) return json({ error: "الليد غير موجود" }, 404);

  const hasWiderAccess = roleIn(caller, ["reception", "general_manager", "super_admin"]);
  if (!hasWiderAccess && roleIn(caller, ["customer_service"]) && lead.assigned_to !== caller.id) {
    return json({ error: "الليد ده مش مُسند لك" }, 403);
  }

  const phoneNormalized = normalizePhone(phoneRaw);
  if (!phoneNormalized) return json({ error: "رقم الهاتف غير صالح" }, 400);

  const { data: duplicate } = await admin
    .from("leads")
    .select("id, customer_name, current_status")
    .eq("phone_normalized", phoneNormalized)
    .neq("id", leadId)
    .not("current_status", "in", `(${CLOSED_STATUSES.join(",")})`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (duplicate) {
    return json({ error: `فيه ليد مفتوح بالفعل بنفس الرقم باسم ${duplicate.customer_name}` }, 409);
  }

  let patientId = lead.patient_id ?? null;
  let patientType = lead.patient_type ?? "new";
  if (!patientId) {
    const { data: patient } = await admin
      .from("patients")
      .select("id")
      .eq("phone_normalized", phoneNormalized)
      .limit(1)
      .maybeSingle();
    patientId = patient?.id ?? null;
    patientType = patient ? "existing" : "new";
  }

  const { data: updated, error: updateErr } = await admin.rpc("rpc_update_lead_details", {
    p_lead_id: leadId,
    p_caller_id: caller.id,
    p_customer_name: customerName,
    p_phone_raw: phoneRaw,
    p_phone_normalized: phoneNormalized,
    p_source: source,
    p_message_text: messageText,
    p_interested_service: interestedService,
    p_requested_department: requestedDepartment,
    p_acquisition_type: acquisitionType,
    p_patient_id: patientId,
    p_patient_type: patientType,
  }).single();
  if (updateErr) return json({ error: updateErr.message }, 500);

  return json({ lead: updated });
});
