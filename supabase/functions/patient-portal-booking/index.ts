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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body:any = {};
  try { body = await req.json(); } catch { return json({ error: "INVALID_JSON" },400); }

  const ctx:any = await portalContext(req);
  if (ctx.error) return json({ error: ctx.error }, ctx.status || 500);
  const op = String(body.op || "catalog");

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
    const date = cleanDate(body.date);
    const time = cleanTime(body.time);
    if (!date || !time) return json({ error: "INVALID_SLOT" },400);
    if (!patient.phone) return json({ error: "PATIENT_PHONE_REQUIRED" },400);

    const qs = new URLSearchParams({
      hospital:String(doctor.hospital_id),
      branch:String(doctor.branch_id),
      specialty:String(doctor.official_specialization_id),
      doctor:String(doctor.official_doctor_id),
      date,
    });
    try {
      const live = await bridge("/availability?" + qs.toString());
      const times = Array.isArray(live?.Times) ? live.Times.map((x:any)=>String(x).padStart(5,"0")) : [];
      if (!times.includes(time)) return json({ error: "SLOT_NO_LONGER_AVAILABLE" },409);

      const requestId = crypto.randomUUID().replace(/-/g,"");
      const payload:any = {
        BookingRequestId: requestId,
        HospitalId: doctor.hospital_id,
        BranchId: doctor.branch_id,
        SpecializationId: doctor.official_specialization_id,
        DoctorId: doctor.official_doctor_id,
        Date: date,
        Time: time,
        Patient: { Name: patient.full_name, Phone: patient.phone },
      };
      if (patient.age != null && Number.isFinite(Number(patient.age))) payload.Patient.Age = Number(patient.age);

      const created = await bridge("/bookings", { method:"POST", body:JSON.stringify(payload) });
      const officialId = String(created?.OfficialBookingId || created?.official_booking_id || "").trim();
      if (!/^\d+$/.test(officialId)) throw new Error("BOOKING_CONFIRMATION_INVALID");

      const check = await bridge("/bookings/" + encodeURIComponent(officialId));
      const reservation = String(check?.reservation_date || "");
      if (String(check?.official_booking_id || officialId) !== officialId ||
          Number(check?.doctor_id) !== Number(doctor.official_doctor_id) ||
          !reservation.startsWith(date) ||
          reservation.slice(11,16) !== time) {
        throw new Error("BOOKING_READBACK_MISMATCH");
      }

      await ctx.admin.from("patient_portal_audit_log").insert({
        account_id: ctx.account.id,
        patient_id: patientId,
        action: "portal_booking_created",
        entity_type: "official_booking",
        metadata: {
          official_booking_id: officialId,
          doctor_id: doctor.doctor_id,
          specialty_id: doctor.specialty_id,
          date, time
        }
      });

      return json({
        ok:true,
        official_booking_id:officialId,
        booking_request_id:requestId,
        patient:{id:patient.id,full_name:patient.full_name,patient_code:patient.patient_code},
        doctor:{doctor_id:doctor.doctor_id,doctor_name_ar:doctor.doctor_name_ar},
        specialty:{specialty_id:doctor.specialty_id,specialty_name_ar:doctor.specialty_name_ar},
        date,time,
      },201);
    } catch (e) {
      const msg = String((e as Error).message || e);
      return json({ error: msg }, msg==="SLOT_NO_LONGER_AVAILABLE"?409:502);
    }
  }

  return json({ error: "UNKNOWN_OPERATION" },400);
});