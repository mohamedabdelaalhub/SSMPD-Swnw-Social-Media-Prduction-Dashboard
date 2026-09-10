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

async function authenticatedUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return null;
  return user;
}

function effectiveAccess(row: any) {
  if (!row || row.verification_status !== "approved" || row.revoked_at) return false;
  return !row.expires_at || new Date(row.expires_at).getTime() > Date.now();
}

function str(v: unknown) {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.filter(Boolean).join("، ");
  if (typeof v === "object") {
    try { return JSON.stringify(v); } catch { return ""; }
  }
  return String(v).trim();
}

function clip(v: unknown, n = 900) {
  const s = str(v);
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function detail(label: string, value: unknown) {
  const text = clip(value);
  return text ? { label, value: text } : null;
}

function patientRef(row: any, patientsById: Record<string, any>) {
  const p = patientsById[row.patient_id] || null;
  return p ? { id: p.id, patient_code: p.patient_code, full_name: p.full_name } : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const user = await authenticatedUser(req);
  if (!user) return json({ error: "UNAUTHORIZED" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Portal context is intentionally independent from staff/admin roles.
  // A dual-role employee sees medical data here only through approved patient_account_access.
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
    .select("patient_id, verification_status, expires_at, revoked_at")
    .eq("account_id", account.id)
    .eq("verification_status", "approved");

  if (accessError) return json({ error: accessError.message }, 500);

  const patientIds = Array.from(new Set(
    (accessRows || []).filter(effectiveAccess).map((r: any) => r.patient_id).filter(Boolean),
  ));

  if (!patientIds.length) return json({ documents: [] });

  const { data: patients, error: patientError } = await admin
    .from("patients")
    .select("id, patient_code, full_name")
    .in("id", patientIds);

  if (patientError) return json({ error: patientError.message }, 500);
  const patientsById = Object.fromEntries((patients || []).map((p: any) => [p.id, p]));

  async function safeRows(table: string) {
    const { data, error } = await admin.from(table).select("*").in("patient_id", patientIds).limit(500);
    if (error) {
      console.error("patient portal documents query failed", table, error.message);
      return [] as any[];
    }
    return (data || []) as any[];
  }

  const [medicalReports, echoReports, dentalReports, physioReports, prescriptions, labRequests, radiologyRequests] = await Promise.all([
    safeRows("patient_medical_reports"),
    safeRows("patient_echo_reports"),
    safeRows("patient_dental_reports"),
    safeRows("patient_physio_reports"),
    safeRows("patient_prescriptions"),
    safeRows("patient_lab_requests"),
    safeRows("patient_radiology_requests"),
  ]);

  const documents: any[] = [];

  for (const r of medicalReports) {
    documents.push({
      id: r.id,
      source: "medical_report",
      category: "medical_report",
      title: r.specialty ? `تقرير طبي — ${r.specialty}` : "تقرير طبي",
      date: r.report_date || r.created_at,
      doctor_name: r.doctor_name || null,
      specialty: r.specialty || null,
      patient: patientRef(r, patientsById),
      summary: clip(r.body_text, 180),
      details: [detail("نص التقرير", r.body_text)].filter(Boolean),
    });
  }

  for (const r of echoReports) {
    documents.push({
      id: r.id,
      source: "echo_report",
      category: "echo",
      title: "Echocardiography Report",
      date: r.report_date || r.created_at,
      doctor_name: r.doctor_name || null,
      specialty: "Echocardiography",
      patient: patientRef(r, patientsById),
      summary: clip(r.conclusion || r.summary || r.findings, 180),
      details: [
        detail("Referred by", r.referred_by),
        detail("Findings", r.findings),
        detail("Summary", r.summary),
        detail("Conclusion", r.conclusion),
      ].filter(Boolean),
    });
  }

  for (const r of dentalReports) {
    documents.push({
      id: r.id,
      source: "dental_report",
      category: "dental",
      title: "تقرير أسنان",
      date: r.report_date || r.created_at,
      doctor_name: r.doctor_name || null,
      specialty: "أسنان",
      patient: patientRef(r, patientsById),
      summary: clip(r.chief_complaint || r.diagnosis || r.notes, 180),
      details: [
        detail("الشكوى", r.chief_complaint),
        detail("التشخيص", r.diagnosis),
        detail("الخطة / الملاحظات", r.treatment_plan || r.notes),
      ].filter(Boolean),
    });
  }

  for (const r of physioReports) {
    documents.push({
      id: r.id,
      source: "physio_report",
      category: "physical_therapy",
      title: "تقرير علاج طبيعي",
      date: r.visit_date || r.report_date || r.created_at,
      doctor_name: r.doctor_name || null,
      specialty: r.specialty || "علاج طبيعي",
      patient: patientRef(r, patientsById),
      summary: clip(r.visit_reason || r.diagnosis || r.notes, 180),
      details: [
        detail("سبب الزيارة", r.visit_reason),
        detail("التشخيص", r.diagnosis),
        detail("ملاحظات", r.notes),
      ].filter(Boolean),
    });
  }

  for (const r of prescriptions) {
    documents.push({
      id: r.id,
      source: "prescription",
      category: "prescription",
      title: "روشتة / وصفة طبية",
      date: r.report_date || r.created_at,
      doctor_name: r.doctor_name || null,
      specialty: r.specialty || null,
      patient: patientRef(r, patientsById),
      summary: clip(r.diagnosis || r.rx_text, 180),
      details: [
        detail("التشخيص", r.diagnosis),
        detail("الوصفة", r.rx_text),
      ].filter(Boolean),
    });
  }

  for (const r of labRequests) {
    documents.push({
      id: r.id,
      source: "lab_request",
      category: "lab_result",
      title: "طلب تحاليل",
      date: r.report_date || r.created_at,
      doctor_name: r.doctor_name || null,
      specialty: null,
      patient: patientRef(r, patientsById),
      summary: clip(r.tests || r.diagnosis, 180),
      details: [
        detail("التشخيص", r.diagnosis),
        detail("التحاليل المطلوبة", r.tests),
        detail("أخرى", r.others_text),
      ].filter(Boolean),
    });
  }

  for (const r of radiologyRequests) {
    documents.push({
      id: r.id,
      source: "radiology_request",
      category: "radiology",
      title: "طلب أشعة",
      date: r.report_date || r.created_at,
      doctor_name: r.doctor_name || null,
      specialty: null,
      patient: patientRef(r, patientsById),
      summary: clip(r.items || r.diagnosis, 180),
      details: [
        detail("التشخيص المبدئي", r.diagnosis),
        detail("الأشعة المطلوبة", r.items),
        detail("أخرى", r.others_text),
      ].filter(Boolean),
    });
  }

  documents.sort((a, b) => {
    const ta = new Date(a.date || 0).getTime() || 0;
    const tb = new Date(b.date || 0).getTime() || 0;
    return tb - ta;
  });

  await admin.from("patient_portal_audit_log").insert({
    account_id: account.id,
    action: "clinical_documents_viewed",
    entity_type: "patient_accounts",
    entity_id: account.id,
    metadata: { patient_count: patientIds.length, document_count: documents.length },
  }).then(({ error }) => {
    if (error) console.error("portal documents audit failed", error.message);
  });

  return json({ documents });
});
