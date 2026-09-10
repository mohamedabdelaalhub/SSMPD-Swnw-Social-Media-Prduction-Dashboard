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
    headers: {
      ...CORS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}

async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return null;
  return user;
}

function isEffectiveAccess(row: any) {
  if (row.verification_status !== "approved" || row.revoked_at) return false;
  return !row.expires_at || new Date(row.expires_at).getTime() > Date.now();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "INVALID_JSON" }, 400); }
  if (String(body.op || "overview") !== "overview") return json({ error: "UNKNOWN_OPERATION" }, 400);

  const user = await getAuthenticatedUser(req);
  if (!user) return json({ error: "UNAUTHORIZED" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: staff, error: staffError } = await admin
    .from("admins")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (staffError) return json({ error: staffError.message }, 500);
  if (staff) return json({ error: "STAFF_ACCOUNT_NOT_ALLOWED" }, 403);

  const { data: account, error: accountError } = await admin
    .from("patient_accounts")
    .select("id, status, activation_completed_at")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (accountError) return json({ error: accountError.message }, 500);
  if (!account || account.status !== "active" || !account.activation_completed_at) {
    return json({ error: "PATIENT_ACCOUNT_NOT_ACTIVATED" }, 403);
  }

  const { data: accessRows, error: accessError } = await admin
    .from("patient_account_access")
    .select("patient_id, access_type, relationship, verification_status, is_primary, verified_at, expires_at, revoked_at")
    .eq("account_id", account.id)
    .eq("verification_status", "approved");
  if (accessError) return json({ error: accessError.message }, 500);

  const activeAccess = (accessRows || []).filter(isEffectiveAccess);
  const patientIds = Array.from(new Set(activeAccess.map((r: any) => r.patient_id).filter(Boolean)));
  if (!patientIds.length) return json({ records: [] });

  const [patientsRes, profilesRes, visitsRes, prescriptionsRes] = await Promise.all([
    admin.from("patients")
      .select("id, patient_code, full_name, phone, email, age, gender, medical_record_no, last_visit_date")
      .in("id", patientIds),
    admin.from("patient_medical_profile")
      .select("patient_id, treating_doctor, specialty, height, weight, blood_pressure, blood_sugar, pulse, oxygen_percent, chronic_conditions, surgeries, family_history, updated_at")
      .in("patient_id", patientIds),
    admin.from("patient_visits")
      .select("id, patient_id, visit_number, visit_date, complaint, medications, xrays, labs, other_recommendations, follow_up_date, blood_pressure, blood_sugar, pulse, created_at")
      .in("patient_id", patientIds)
      .order("visit_date", { ascending: false })
      .limit(250),
    admin.from("patient_prescriptions")
      .select("id, patient_id, report_date, doctor_name, specialty, diagnosis, rx_text, created_at, updated_at")
      .in("patient_id", patientIds)
      .order("report_date", { ascending: false })
      .limit(250),
  ]);

  for (const result of [patientsRes, profilesRes, visitsRes, prescriptionsRes]) {
    if (result.error) return json({ error: result.error.message }, 500);
  }

  const profilesByPatient = Object.fromEntries((profilesRes.data || []).map((r: any) => [r.patient_id, r]));
  const accessByPatient = Object.fromEntries(activeAccess.map((r: any) => [r.patient_id, r]));

  const visitsByPatient: Record<string, any[]> = {};
  for (const visit of visitsRes.data || []) {
    (visitsByPatient[visit.patient_id] ||= []).push(visit);
  }

  const prescriptionsByPatient: Record<string, any[]> = {};
  for (const rx of prescriptionsRes.data || []) {
    (prescriptionsByPatient[rx.patient_id] ||= []).push(rx);
  }

  const today = new Date().toISOString().slice(0, 10);
  const records = (patientsRes.data || []).map((patient: any) => {
    const profile = profilesByPatient[patient.id] || {};
    const visits = visitsByPatient[patient.id] || [];
    const prescriptions = prescriptionsByPatient[patient.id] || [];
    const latestVisit = visits[0] || null;
    const upcomingFollowUps = visits
      .filter((v: any) => v.follow_up_date && v.follow_up_date >= today)
      .sort((a: any, b: any) => String(a.follow_up_date).localeCompare(String(b.follow_up_date)));

    const chronicConditions = Array.isArray(profile.chronic_conditions)
      ? profile.chronic_conditions.filter((c: any) => c && c.has)
      : [];
    const surgeries = Array.isArray(profile.surgeries)
      ? profile.surgeries.filter((s: any) => s && s.has !== false)
      : [];
    const familyHistory = Array.isArray(profile.family_history)
      ? profile.family_history.filter((f: any) => f && f.has !== false)
      : [];

    return {
      patient: {
        id: patient.id,
        patient_code: patient.patient_code,
        full_name: patient.full_name,
        phone: patient.phone,
        email: patient.email,
        age: patient.age,
        gender: patient.gender,
        medical_record_no: patient.medical_record_no,
        last_visit_date: patient.last_visit_date,
      },
      access: accessByPatient[patient.id] || null,
      medical_profile: {
        treating_doctor: profile.treating_doctor || null,
        specialty: profile.specialty || null,
        height: profile.height || null,
        weight: profile.weight || null,
        blood_pressure: profile.blood_pressure || latestVisit?.blood_pressure || null,
        blood_sugar: profile.blood_sugar || latestVisit?.blood_sugar || null,
        pulse: profile.pulse || latestVisit?.pulse || null,
        oxygen_percent: profile.oxygen_percent || null,
        chronic_conditions: chronicConditions,
        surgeries,
        family_history: familyHistory,
        updated_at: profile.updated_at || null,
      },
      latest_visit: latestVisit,
      next_follow_up: upcomingFollowUps[0] || null,
      visits: visits.slice(0, 30),
      prescriptions: prescriptions.slice(0, 50),
    };
  });

  await admin.from("patient_portal_audit_log").insert({
    account_id: account.id,
    action: "medical_overview_viewed",
    entity_type: "patient_accounts",
    entity_id: account.id,
    metadata: { patient_count: records.length },
  });

  return json({ records });
});
