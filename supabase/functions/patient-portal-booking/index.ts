import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const BRIDGE_URL = (Deno.env.get("SWNW_BOOKING_BRIDGE_URL") || "").replace(/\/$/, "");
const BRIDGE_TOKEN = Deno.env.get("SWNW_BOOKING_BRIDGE_TOKEN") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CATALOG = [{"doctor_id":"doc_a02b9c288462","doctor_name_ar":"احمد علي","specialty_id":"internal-medicine","specialty_name_ar":"الباطنة","official_doctor_id":1055,"official_specialization_id":397,"hospital_id":96,"branch_id":98,"consultation_price":600,"followup_price":100,"currency":"EGP","followup_valid_days":14},{"doctor_id":"doc_383ba58d6bbf","doctor_name_ar":"امل علي","specialty_id":"internal-medicine","specialty_name_ar":"الباطنة","official_doctor_id":1054,"official_specialization_id":397,"hospital_id":96,"branch_id":98,"consultation_price":600,"followup_price":100,"currency":"EGP","followup_valid_days":14},{"doctor_id":"doc_4966e1b8dc64","doctor_name_ar":"احمد السيد عباده","specialty_id":"internal-medicine","specialty_name_ar":"الباطنة","official_doctor_id":1102,"official_specialization_id":397,"hospital_id":96,"branch_id":98,"consultation_price":500,"followup_price":100,"currency":"EGP","followup_valid_days":14},{"doctor_id":"doc_1d5445d2abbd","doctor_name_ar":"عمر خالد","specialty_id":"internal-medicine","specialty_name_ar":"الباطنة","official_doctor_id":1116,"official_specialization_id":397,"hospital_id":96,"branch_id":98,"consultation_price":500,"followup_price":100,"currency":"EGP","followup_valid_days":14},{"doctor_id":"doc_342da23a2627","doctor_name_ar":"دينا حسني","specialty_id":"neurology","specialty_name_ar":"المخ والأعصاب","official_doctor_id":1095,"official_specialization_id":413,"hospital_id":96,"branch_id":98,"consultation_price":1000,"followup_price":100,"currency":"EGP","followup_valid_days":14},{"doctor_id":"doc_b91f7c4d0665","doctor_name_ar":"احمد عبد العزيز","specialty_id":"neurosurgery","specialty_name_ar":"جراحة المخ والأعصاب","official_doctor_id":1122,"official_specialization_id":417,"hospital_id":96,"branch_id":98,"consultation_price":1000,"followup_price":100,"currency":"EGP","followup_valid_days":14},{"doctor_id":"doc_2f8a11dc48a2","doctor_name_ar":"احمد مصطفي","specialty_id":"orthopedics","specialty_name_ar":"العظام","official_doctor_id":1059,"official_specialization_id":398,"hospital_id":96,"branch_id":98,"consultation_price":500,"followup_price":100,"currency":"EGP","followup_valid_days":14},{"doctor_id":"doc_040e204b98a8","doctor_name_ar":"ايمن عبد الله","specialty_id":"orthopedics","specialty_name_ar":"العظام","official_doctor_id":1119,"official_specialization_id":398,"hospital_id":96,"branch_id":98,"consultation_price":500,"followup_price":100,"currency":"EGP","followup_valid_days":14},{"doctor_id":"doc_3ae520f7f46c","doctor_name_ar":"بلال الصفتي","specialty_id":"orthopedics","specialty_name_ar":"العظام","official_doctor_id":1088,"official_specialization_id":398,"hospital_id":96,"branch_id":98,"consultation_price":500,"followup_price":100,"currency":"EGP","followup_valid_days":14},{"doctor_id":"doc_1c06a1d0fa08","doctor_name_ar":"شريف ابراهيم","specialty_id":"general-surgery","specialty_name_ar":"الجراحة","official_doctor_id":1061,"official_specialization_id":399,"hospital_id":96,"branch_id":98,"consultation_price":600,"followup_price":100,"currency":"EGP","followup_valid_days":14},{"doctor_id":"doc_c1f124a01579","doctor_name_ar":"احمد الخولي","specialty_id":"general-surgery","specialty_name_ar":"الجراحة","official_doctor_id":1062,"official_specialization_id":399,"hospital_id":96,"branch_id":98,"consultation_price":500,"followup_price":100,"currency":"EGP","followup_valid_days":14},{"doctor_id":"doc_7e2db189b078","doctor_name_ar":"احمد سمير","specialty_id":"dermatology-cosmetics","specialty_name_ar":"الجلدية والتجميل","official_doctor_id":1065,"official_specialization_id":400,"hospital_id":96,"branch_id":98,"consultation_price":600,"followup_price":100,"currency":"EGP","followup_valid_days":14},{"doctor_id":"doc_0d440dd412ad","doctor_name_ar":"امنيه السيد","specialty_id":"dermatology-cosmetics","specialty_name_ar":"الجلدية والتجميل","official_doctor_id":1066,"official_specialization_id":400,"hospital_id":96,"branch_id":98,"consultation_price":500,"followup_price":100,"currency":"EGP","followup_valid_days":14},{"doctor_id":"doc_480b4a6faf45","doctor_name_ar":"محمد قدري","specialty_id":"ent","specialty_name_ar":"الأنف والأذن","official_doctor_id":1068,"official_specialization_id":401,"hospital_id":96,"branch_id":98,"consultation_price":600,"followup_price":100,"currency":"EGP","followup_valid_days":14},{"doctor_id":"doc_806b48d90225","doctor_name_ar":"ايه مفتاح","specialty_id":"obgyn","specialty_name_ar":"النساء والتوليد","official_doctor_id":1099,"official_specialization_id":402,"hospital_id":96,"branch_id":98,"consultation_price":500,"followup_price":100,"currency":"EGP","followup_valid_days":14},{"doctor_id":"doc_25aaba18b2e6","doctor_name_ar":"محمد فتحي","specialty_id":"obgyn","specialty_name_ar":"النساء والتوليد","official_doctor_id":1126,"official_specialization_id":402,"hospital_id":96,"branch_id":98,"consultation_price":500,"followup_price":100,"currency":"EGP","followup_valid_days":14},{"doctor_id":"doc_01e541ebd2b7","doctor_name_ar":"مريم القس","specialty_id":"psychiatry-speech-therapy","specialty_name_ar":"النفسية والتخاطب","official_doctor_id":1074,"official_specialization_id":403,"hospital_id":96,"branch_id":98,"consultation_price":800,"followup_price":100,"currency":"EGP","followup_valid_days":14},{"doctor_id":"doc_d3fd179a74e2","doctor_name_ar":"مي اللبودي","specialty_id":"psychiatry-speech-therapy","specialty_name_ar":"النفسية والتخاطب","official_doctor_id":1077,"official_specialization_id":403,"hospital_id":96,"branch_id":98,"consultation_price":800,"followup_price":100,"currency":"EGP","followup_valid_days":14},{"doctor_id":"doc_e8bb6b9c83ae","doctor_name_ar":"لينا الحسني","specialty_id":"psychiatry-speech-therapy","specialty_name_ar":"النفسية والتخاطب","official_doctor_id":1075,"official_specialization_id":403,"hospital_id":96,"branch_id":98,"consultation_price":600,"followup_price":100,"currency":"EGP","followup_valid_days":14},{"doctor_id":"doc_809ef7fd8818","doctor_name_ar":"الهام قدري","specialty_id":"pediatrics","specialty_name_ar":"أطفال","official_doctor_id":1079,"official_specialization_id":404,"hospital_id":96,"branch_id":98,"consultation_price":600,"followup_price":100,"currency":"EGP","followup_valid_days":14},{"doctor_id":"doc_7aa9a35d9a9b","doctor_name_ar":"سما نبيل","specialty_id":"physiotherapy-nutrition","specialty_name_ar":"علاج طبيعي وتغذية","official_doctor_id":1080,"official_specialization_id":405,"hospital_id":96,"branch_id":98,"consultation_price":400,"followup_price":100,"currency":"EGP","followup_valid_days":14},{"doctor_id":"doc_7e61b58027ea","doctor_name_ar":"يحيي ذكريا","specialty_id":"physiotherapy-nutrition","specialty_name_ar":"علاج طبيعي وتغذية","official_doctor_id":1081,"official_specialization_id":405,"hospital_id":96,"branch_id":98,"consultation_price":500,"followup_price":100,"currency":"EGP","followup_valid_days":14},{"doctor_id":"doc_fdf688845cd6","doctor_name_ar":"وفاء مصطفي","specialty_id":"physiotherapy-nutrition","specialty_name_ar":"علاج طبيعي وتغذية","official_doctor_id":1120,"official_specialization_id":405,"hospital_id":96,"branch_id":98,"consultation_price":500,"followup_price":100,"currency":"EGP","followup_valid_days":14},{"doctor_id":"doc_a519accfec16","doctor_name_ar":"احمد عبدالله فودة","specialty_id":"vascular","specialty_name_ar":"الأوعية الدموية","official_doctor_id":1097,"official_specialization_id":408,"hospital_id":96,"branch_id":98,"consultation_price":600,"followup_price":100,"currency":"EGP","followup_valid_days":14},{"doctor_id":"doc_37b364f746c9","doctor_name_ar":"غاده علي قدري","specialty_id":"dentistry","specialty_name_ar":"الأسنان","official_doctor_id":1096,"official_specialization_id":409,"hospital_id":96,"branch_id":98,"consultation_price":350,"followup_price":100,"currency":"EGP","followup_valid_days":14},{"doctor_id":"doc_2d9b9aee31e2","doctor_name_ar":"معتز الهجين","specialty_id":"dentistry","specialty_name_ar":"الأسنان","official_doctor_id":1092,"official_specialization_id":409,"hospital_id":96,"branch_id":98,"consultation_price":350,"followup_price":100,"currency":"EGP","followup_valid_days":14},{"doctor_id":"doc_3f828efe0fd8","doctor_name_ar":"عبد الرحمن الطوخي","specialty_id":"dentistry","specialty_name_ar":"الأسنان","official_doctor_id":1105,"official_specialization_id":409,"hospital_id":96,"branch_id":98,"consultation_price":350,"followup_price":100,"currency":"EGP","followup_valid_days":14},{"doctor_id":"doc_4c3ee65d89c8","doctor_name_ar":"مصطفي محمد","specialty_id":"urology","specialty_name_ar":"مسالك بولية","official_doctor_id":1114,"official_specialization_id":412,"hospital_id":96,"branch_id":98,"consultation_price":600,"followup_price":100,"currency":"EGP","followup_valid_days":14}] as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store, max-age=0" },
  });
}

async function getUser(req: Request) {
  const auth = req.headers.get("Authorization");
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) return null;
  const client = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data: { user }, error } = await client.auth.getUser();
  return error ? null : user;
}

function effective(row: any) {
  return row.verification_status === "approved" && !row.revoked_at &&
    (!row.expires_at || new Date(row.expires_at).getTime() > Date.now());
}

async function portalContext(req: Request) {
  const user = await getUser(req);
  if (!user) return { error: "UNAUTHORIZED", status: 401 };
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: account, error } = await admin.from("patient_accounts")
    .select("id,status,activation_completed_at,login_email")
    .eq("auth_user_id", user.id).maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!account || account.status !== "active" || !account.activation_completed_at) {
    return { error: "PATIENT_ACCOUNT_NOT_ACTIVATED", status: 403 };
  }
  const { data: accessRows, error: accessError } = await admin.from("patient_account_access")
    .select("patient_id,access_type,relationship,verification_status,expires_at,revoked_at")
    .eq("account_id", account.id).eq("verification_status", "approved");
  if (accessError) return { error: accessError.message, status: 500 };
  const active = (accessRows || []).filter(effective);
  const patientIds = [...new Set(active.map((x:any)=>x.patient_id).filter(Boolean))];
  let patients:any[] = [];
  if (patientIds.length) {
    const { data, error: pErr } = await admin.from("patients")
      .select("id,patient_code,full_name,phone,age,status")
      .in("id", patientIds).eq("status","active");
    if (pErr) return { error: pErr.message, status: 500 };
    patients = data || [];
  }
  return { admin, account, patients, patientIds };
}

function doctorById(id: string) {
  return (CATALOG as readonly any[]).find((d:any)=>d.doctor_id===id) || null;
}

async function bridge(path: string, init?: RequestInit) {
  if (!BRIDGE_URL || !BRIDGE_TOKEN) throw new Error("BOOKING_BRIDGE_NOT_CONFIGURED");
  const ctrl = new AbortController();
  const timer = setTimeout(()=>ctrl.abort(), 12000);
  try {
    const res = await fetch(BRIDGE_URL + path, {
      ...init,
      signal: ctrl.signal,
      headers: {
        Authorization: "Bearer " + BRIDGE_TOKEN,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers || {}),
      },
    });
    const text = await res.text();
    let data:any = null;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!res.ok) throw new Error(data?.Error || data?.error || `BRIDGE_${res.status}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function cleanDate(v: unknown) {
  const s = String(v || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}
function cleanTime(v: unknown) {
  const s = String(v || "").trim();
  return /^\d{1,2}:\d{2}$/.test(s) ? s.padStart(5,"0") : "";
}


// ---- reception (staff) side: confirm / cancel portal booking requests ----
async function staffContext(req: Request) {
  const auth = req.headers.get("Authorization") || "";
  const user = await getUser(req);
  if (!user) return { error: "UNAUTHORIZED", status: 401 };
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
  const { data: allowed, error } = await userClient.rpc("can_access_leads");
  if (error) return { error: error.message, status: 500 };
  if (allowed !== true) return { error: "NOT_ALLOWED", status: 403 };
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: staff } = await admin.from("admins").select("id,name").eq("user_id", user.id).eq("active", true).maybeSingle();
  if (!staff) return { error: "NOT_ALLOWED", status: 403 };
  return { admin, staff };
}

const OPEN_STATUSES = ["pending", "confirming", "confirmed"];
const REQUEST_FIELDS = "id,patient_id,doctor_id,doctor_name,specialty_id,specialty_name,requested_date,requested_time,status,official_booking_id,last_error,staff_note,reviewed_at,created_at";

async function createOfficialBooking(doctor: any, patient: any, date: string, time: string) {
  const qs = new URLSearchParams({
    hospital:String(doctor.hospital_id), branch:String(doctor.branch_id),
    specialty:String(doctor.official_specialization_id), doctor:String(doctor.official_doctor_id), date,
  });
  const live = await bridge("/availability?" + qs.toString());
  const times = Array.isArray(live?.Times) ? live.Times.map((x:any)=>String(x).padStart(5,"0")) : [];
  if (!times.includes(time)) throw new Error("SLOT_NO_LONGER_AVAILABLE");
  const requestId = crypto.randomUUID().replace(/-/g,"");
  const payload:any = {
    BookingRequestId: requestId, HospitalId: doctor.hospital_id, BranchId: doctor.branch_id,
    SpecializationId: doctor.official_specialization_id, DoctorId: doctor.official_doctor_id,
    Date: date, Time: time, Patient: { Name: patient.full_name, Phone: patient.phone },
  };
  if (patient.age != null && Number.isFinite(Number(patient.age))) payload.Patient.Age = Number(patient.age);
  const created = await bridge("/bookings", { method:"POST", body:JSON.stringify(payload) });
  const officialId = String(created?.OfficialBookingId || created?.official_booking_id || "").trim();
  if (!/^\d+$/.test(officialId)) throw new Error("BOOKING_CONFIRMATION_INVALID");
  const check = await bridge("/bookings/" + encodeURIComponent(officialId));
  const reservation = String(check?.reservation_date || "");
  if (String(check?.official_booking_id || officialId) !== officialId ||
      Number(check?.doctor_id) !== Number(doctor.official_doctor_id) ||
      !reservation.startsWith(date) || reservation.slice(11,16) !== time) {
    throw new Error("BOOKING_READBACK_MISMATCH");
  }
  return { officialId, requestId };
}

// Owner 2026-11-19: once a request is booked on Masa it also goes to the dashboard's automatic bookings
// (clinic_reception_auto_book_service_api; the database books it in reception). Best effort: a failure here never undoes
// the Masa booking, the 5-minute Masa import picks it up anyway.
async function queueForReception(admin: any, row: any, doctor: any) {
  try {
    await admin.rpc("clinic_reception_auto_book_service_api", { p_op: "portal_confirmed", p: {
      request_id: row.id, official_booking_id: row.official_booking_id, masa_doctor_id: doctor?.official_doctor_id,
      date: String(row.requested_date), time: row.requested_time, patient_id: row.patient_id } });
  } catch (_) { /* logged by status only */ }
}

async function autoConfirmEnabled(admin: any): Promise<{ on: boolean; actor: string | null }> {
  try {
    const { data } = await admin.rpc("clinic_reception_auto_book_service_api", { p_op: "config", p: {} });
    return { on: data?.portal_auto_confirm === true, actor: data?.system_admin_id || null };
  } catch (_) { return { on: false, actor: null }; }
}

// pending -> confirming (atomic claim) -> booked on Masa -> confirmed; a failure goes back to pending / slot_unavailable.
async function confirmRequest(admin: any, requestId: string, actorId: string | null, auditAction: string) {
  const { data: claimed, error: claimError } = await admin.from("patient_portal_booking_requests")
    .update({ status: "confirming", reviewed_by: actorId, reviewed_at: new Date().toISOString(), last_error: null })
    .eq("id", requestId).eq("status", "pending").select("*").maybeSingle();
  if (claimError) return { error: claimError.message, status: 500 };
  if (!claimed) return { error: "REQUEST_NOT_PENDING", status: 409 };
  const doctor = doctorById(claimed.doctor_id);
  const { data: patient } = await admin.from("patients").select("id,full_name,phone,age,status").eq("id", claimed.patient_id).maybeSingle();
  try {
    if (!doctor) throw new Error("DOCTOR_NOT_BOOKING_READY");
    if (!patient || patient.status !== "active" || !patient.phone) throw new Error("PATIENT_PHONE_REQUIRED");
    const { officialId, requestId: bridgeRequestId } = await createOfficialBooking(doctor, patient, String(claimed.requested_date), claimed.requested_time);
    const { data: done, error: doneError } = await admin.from("patient_portal_booking_requests")
      .update({ status: "confirmed", official_booking_id: officialId, booking_request_id: bridgeRequestId })
      .eq("id", requestId).select(REQUEST_FIELDS).single();
    if (doneError) throw new Error("BOOKED_BUT_NOT_SAVED:" + officialId);
    await admin.from("patient_portal_audit_log").insert({ patient_id: claimed.patient_id, actor_admin_id: actorId,
      action: auditAction, entity_type: "portal_booking_request", entity_id: requestId,
      metadata: { official_booking_id: officialId, doctor_id: claimed.doctor_id, date: claimed.requested_date, time: claimed.requested_time } });
    await queueForReception(admin, done, doctor);
    return { request: done };
  } catch (e) {
    const msg = String((e as Error).message || e);
    const slotGone = msg === "SLOT_NO_LONGER_AVAILABLE";
    // A failed booking goes back to pending (or slot_unavailable) so reception can retry or call the patient.
    await admin.from("patient_portal_booking_requests")
      .update({ status: slotGone ? "slot_unavailable" : "pending", last_error: msg.slice(0, 200) })
      .eq("id", requestId).eq("status", "confirming");
    return { error: msg, status: slotGone ? 409 : 502 };
  }
}

async function handleStaff(op: string, body: any, req: Request) {
  const ctx:any = await staffContext(req);
  if (ctx.error) return json({ error: ctx.error }, ctx.status || 500);
  const admin = ctx.admin;

  if (op === "staff_list") {
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const { data, error } = await admin.from("patient_portal_booking_requests")
      .select(REQUEST_FIELDS + ",patients(full_name,patient_code,phone)")
      .or("status.in.(pending,confirming),created_at.gte." + since)
      .order("created_at", { ascending: false }).limit(300);
    if (error) return json({ error: error.message }, 500);
    return json({ requests: data || [], bridge_ready: !!(BRIDGE_URL && BRIDGE_TOKEN) });
  }

  const requestId = String(body.request_id || "");
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return json({ error: "INVALID_REQUEST_ID" }, 400);

  if (op === "staff_cancel") {
    const note = String(body.note || "").slice(0, 300) || null;
    const { data, error } = await admin.from("patient_portal_booking_requests")
      .update({ status: "cancelled_by_staff", staff_note: note, reviewed_by: ctx.staff.id, reviewed_at: new Date().toISOString() })
      .eq("id", requestId).eq("status", "pending").select(REQUEST_FIELDS).maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: "REQUEST_NOT_PENDING" }, 409);
    await admin.from("patient_portal_audit_log").insert({ patient_id: data.patient_id, actor_admin_id: ctx.staff.id,
      action: "portal_booking_request_cancelled_by_staff", entity_type: "portal_booking_request", entity_id: requestId, metadata: {} });
    return json({ ok: true, request: data });
  }

  if (op === "staff_confirm") {
    const out: any = await confirmRequest(admin, requestId, ctx.staff.id, "portal_booking_confirmed");
    if (out.error) return json({ error: out.error }, out.status);
    return json({ ok: true, request: out.request });
  }
  return json({ error: "UNKNOWN_OPERATION" }, 400);
}

// One log line per call: function, op and HTTP status only (no body, ids or patient data), so failed
// bookings are visible in the edge logs.
Deno.serve(async (req) => {
  let op = "-";
  try { if (req.method === "POST") op = String((await req.clone().json())?.op || "catalog").slice(0, 32); } catch { op = "invalid_json"; }
  const started = Date.now();
  let res: Response;
  try { res = await handleRequest(req); }
  catch (e) { console.error(JSON.stringify({ fn: "patient-portal-booking", op, error: String((e as Error)?.name || "Error") })); res = json({ error: "INTERNAL_ERROR" }, 500); }
  console.log(JSON.stringify({ fn: "patient-portal-booking", op, status: res.status, ms: Date.now() - started }));
  return res;
});

async function handleRequest(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body:any = {};
  try { body = await req.json(); } catch { return json({ error: "INVALID_JSON" },400); }

  const op = String(body.op || "catalog");
  if (op.startsWith("staff_")) return handleStaff(op, body, req);

  const ctx:any = await portalContext(req);
  if (ctx.error) return json({ error: ctx.error }, ctx.status || 500);

  if (op === "my_requests") {
    if (!ctx.patientIds.length) return json({ requests: [] });
    const { data, error } = await ctx.admin.from("patient_portal_booking_requests")
      .select(REQUEST_FIELDS).in("patient_id", ctx.patientIds)
      .order("created_at", { ascending: false }).limit(20);
    if (error) return json({ error: error.message }, 500);
    return json({ requests: (data || []).map((r:any)=>({ ...r, last_error: undefined, staff_note: r.status === "cancelled_by_staff" ? r.staff_note : null })) });
  }

  if (op === "cancel_request") {
    const requestId = String(body.request_id || "");
    if (!/^[0-9a-f-]{36}$/i.test(requestId) || !ctx.patientIds.length) return json({ error: "INVALID_REQUEST_ID" }, 400);
    const { data, error } = await ctx.admin.from("patient_portal_booking_requests")
      .update({ status: "cancelled_by_patient" })
      .eq("id", requestId).eq("status", "pending").in("patient_id", ctx.patientIds).select("id,patient_id").maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: "REQUEST_NOT_PENDING" }, 409);
    await ctx.admin.from("patient_portal_audit_log").insert({ account_id: ctx.account.id, patient_id: data.patient_id,
      action: "portal_booking_request_cancelled_by_patient", entity_type: "portal_booking_request", entity_id: requestId, metadata: {} });
    return json({ ok: true });
  }

  if (op === "catalog") {
    const specsMap = new Map<string, any>();
    for (const d of CATALOG as readonly any[]) {
      if (!specsMap.has(d.specialty_id)) specsMap.set(d.specialty_id, {
        specialty_id: d.specialty_id,
        specialty_name_ar: d.specialty_name_ar,
      });
    }
    return json({
      patients: ctx.patients.map((p:any)=>({ id:p.id, patient_code:p.patient_code, full_name:p.full_name })),
      specialties: [...specsMap.values()],
      doctors: (CATALOG as readonly any[]).map((d:any)=>({
        doctor_id:d.doctor_id, doctor_name_ar:d.doctor_name_ar,
        specialty_id:d.specialty_id, specialty_name_ar:d.specialty_name_ar,
        consultation_price:d.consultation_price, followup_price:d.followup_price,
        currency:d.currency, followup_valid_days:d.followup_valid_days
      })),
      bridge_ready: !!(BRIDGE_URL && BRIDGE_TOKEN),
    });
  }

  const patientId = String(body.patient_id || "");
  if (!patientId || !ctx.patientIds.includes(patientId)) return json({ error: "NO_APPROVED_MEDICAL_ACCESS" },403);
  const patient = ctx.patients.find((p:any)=>p.id===patientId);
  if (!patient) return json({ error: "PATIENT_NOT_FOUND" },404);

  const doctor = doctorById(String(body.doctor_id || ""));
  if (!doctor) return json({ error: "DOCTOR_NOT_BOOKING_READY" },400);

  if (op === "availability") {
    const date = cleanDate(body.date);
    const qs = new URLSearchParams({
      hospital:String(doctor.hospital_id),
      branch:String(doctor.branch_id),
      specialty:String(doctor.official_specialization_id),
      doctor:String(doctor.official_doctor_id),
    });
    if (date) qs.set("date", date);
    try {
      const data = await bridge("/availability?" + qs.toString());
      return json(date ? { times: Array.isArray(data?.Times) ? data.Times : [] } : { dates: Array.isArray(data?.Dates) ? data.Dates : [] });
    } catch (e) {
      return json({ error: String((e as Error).message || e) },502);
    }
  }

  if (op === "book") {
    // The portal stores a REQUEST; reception confirms it (staff_confirm) before anything is booked officially.
    const date = cleanDate(body.date);
    const time = cleanTime(body.time);
    if (!date || !time) return json({ error: "INVALID_SLOT" },400);
    if (!patient.phone) return json({ error: "PATIENT_PHONE_REQUIRED" },400);
    const today = new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Cairo",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
    if (date < today) return json({ error: "INVALID_SLOT" },400);
    try {
      const qs = new URLSearchParams({
        hospital:String(doctor.hospital_id), branch:String(doctor.branch_id),
        specialty:String(doctor.official_specialization_id), doctor:String(doctor.official_doctor_id), date,
      });
      const live = await bridge("/availability?" + qs.toString());
      const times = Array.isArray(live?.Times) ? live.Times.map((x:any)=>String(x).padStart(5,"0")) : [];
      if (!times.includes(time)) return json({ error: "SLOT_NO_LONGER_AVAILABLE" },409);
    } catch (e) {
      return json({ error: String((e as Error).message || e) },502);
    }
    const { data: request, error } = await ctx.admin.from("patient_portal_booking_requests").insert({
      account_id: ctx.account.id, patient_id: patientId,
      doctor_id: doctor.doctor_id, doctor_name: doctor.doctor_name_ar,
      specialty_id: doctor.specialty_id, specialty_name: doctor.specialty_name_ar,
      requested_date: date, requested_time: time, status: "pending",
    }).select(REQUEST_FIELDS).single();
    if (error) {
      const m = String(error.message || "");
      if (m.includes("PORTAL_BOOKING_LIMIT")) return json({ error: "PORTAL_BOOKING_LIMIT" },409);
      if ((error as any).code === "23505") return json({ error: "DUPLICATE_REQUEST" },409);
      return json({ error: m },500);
    }
    await ctx.admin.from("patient_portal_audit_log").insert({
      account_id: ctx.account.id, patient_id: patientId, action: "portal_booking_requested",
      entity_type: "portal_booking_request", entity_id: request.id,
      metadata: { doctor_id: doctor.doctor_id, specialty_id: doctor.specialty_id, date, time },
    });
    // Owner 2026-11-19: portal bookings are confirmed automatically when the slot is free (flag in reception settings).
    const auto = await autoConfirmEnabled(ctx.admin);
    if (auto.on) {
      const out: any = await confirmRequest(ctx.admin, request.id, auto.actor, "portal_booking_auto_confirmed");
      if (out.request) {
        return json({
          ok:true, status:"confirmed", request: out.request,
          patient:{id:patient.id,full_name:patient.full_name,patient_code:patient.patient_code},
          doctor:{doctor_id:doctor.doctor_id,doctor_name_ar:doctor.doctor_name_ar},
          specialty:{specialty_id:doctor.specialty_id,specialty_name_ar:doctor.specialty_name_ar},
          date,time,
        },201);
      }
      if (out.error === "SLOT_NO_LONGER_AVAILABLE") return json({ error: "SLOT_NO_LONGER_AVAILABLE" },409);
      // any other failure leaves the request pending for reception, as before
    }
    return json({
      ok:true, status:"pending", request,
      patient:{id:patient.id,full_name:patient.full_name,patient_code:patient.patient_code},
      doctor:{doctor_id:doctor.doctor_id,doctor_name_ar:doctor.doctor_name_ar},
      specialty:{specialty_id:doctor.specialty_id,specialty_name_ar:doctor.specialty_name_ar},
      date,time,
    },201);
  }

  return json({ error: "UNKNOWN_OPERATION" },400);
}
