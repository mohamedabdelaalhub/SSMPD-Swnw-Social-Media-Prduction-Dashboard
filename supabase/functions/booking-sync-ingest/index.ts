import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SYNC_SECRET = Deno.env.get("BOOKING_SYNC_SECRET");
function respond(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
function textValue(value) {
  if (value === undefined || value === null) return null;
  const valueAsText = String(value).trim();
  return valueAsText || null;
}
Deno.serve(async (request)=>{
  // الوكيل فقط هو المسموح له بإرسال حجوزات
  if (request.method !== "POST") {
    return respond({
      ok: false,
      error: "POST only"
    }, 405);
  }
  // Secret مستقل للربط بين الوكيل والداشبورد
  if (!SYNC_SECRET || request.headers.get("X-Booking-Sync-Secret") !== SYNC_SECRET) {
    return respond({
      ok: false,
      error: "unauthorized"
    }, 401);
  }
  if (!SERVICE_ROLE_KEY) {
    return respond({
      ok: false,
      error: "server_misconfigured"
    }, 500);
  }
  let body;
  try {
    body = await request.json();
  } catch  {
    return respond({
      ok: false,
      error: "invalid_json"
    }, 400);
  }
  // المفتاح الأساسي لمنع تكرار نفس الحجز
  const bookingRequestId = textValue(body.booking_request_id);
  if (!bookingRequestId) {
    return respond({
      ok: false,
      error: "booking_request_id_required"
    }, 400);
  }
  const allowedStatuses = [
    "confirmed",
    "rescheduled",
    "cancelled",
    "arrived",
    "completed",
    "no_show"
  ];
  const allowedChannels = [
    "whatsapp",
    "messenger",
    "instagram",
    "facebook",
    "other"
  ];
  const incomingStatus = textValue(body.status);
  if (incomingStatus && !allowedStatuses.includes(incomingStatus)) {
    return respond({
      ok: false,
      error: "invalid_status"
    }, 400);
  }
  const incomingChannel = textValue(body.channel);
  if (incomingChannel && !allowedChannels.includes(incomingChannel)) {
    return respond({
      ok: false,
      error: "invalid_channel"
    }, 400);
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  // هل الحجز اتبعت قبل كده؟
  const existingResult = await supabase.from("customer_bookings").select("*").eq("booking_request_id", bookingRequestId).maybeSingle();
  if (existingResult.error) {
    return respond({
      ok: false,
      error: existingResult.error.message
    }, 500);
  }
  const now = new Date().toISOString();
  const fields = [
    "booking_flow_id",
    "official_booking_id",
    "booking_reference",
    "tenant_id",
    "wa_id",
    "customer_name",
    "phone",
    "specialty_id",
    "specialty_name",
    "doctor_id",
    "doctor_name",
    "appointment_date",
    "appointment_time",
    "currency",
    "confirmed_at"
  ];
  const patch = {
    last_synced_at: now,
    updated_at: now
  };
  // نحدّث فقط الحقول اللي الوكيل بعتها فعلاً
  // عشان إلغاء/تعديل الحجز مايمسحش باقي البيانات القديمة.
  for (const field of fields){
    if (body[field] !== undefined) {
      patch[field] = textValue(body[field]);
    }
  }
  if (incomingStatus) {
    patch.status = incomingStatus;
  }
  if (incomingChannel) {
    patch.channel = incomingChannel;
  }
  // Masa doctor id (int) from the agent; doctor_id stays the agent's own opaque id (doc_...).
  if (body.masa_doctor_id !== undefined && body.masa_doctor_id !== null && body.masa_doctor_id !== "") {
    const masaDoctorId = Number(body.masa_doctor_id);
    if (!Number.isInteger(masaDoctorId) || masaDoctorId <= 0) {
      return respond({
        ok: false,
        error: "invalid_masa_doctor_id"
      }, 400);
    }
    patch.masa_doctor_id = masaDoctorId;
  }
  // Website booking form extras (2026-11-27): the service text the patient wrote, and the gender (dashboard only; Masa never gets it).
  if (body.gender !== undefined && body.gender !== null && body.gender !== "") {
    if (body.gender !== "male" && body.gender !== "female") {
      return respond({
        ok: false,
        error: "invalid_gender"
      }, 400);
    }
    patch.gender = body.gender;
  }
  if (body.needed_service !== undefined && body.needed_service !== null && body.needed_service !== "") {
    patch.needed_service = (textValue(body.needed_service) || "").slice(0, 80) || null;
  }
  if (body.price !== undefined && body.price !== null && body.price !== "") {
    const price = Number(body.price);
    if (!Number.isFinite(price)) {
      return respond({
        ok: false,
        error: "invalid_price"
      }, 400);
    }
    patch.price = price;
  }
  let result;
  if (existingResult.data) {
    // نفس الحجز موجود: تحديث فقط، مفيش Duplicate.
    result = await supabase.from("customer_bookings").update(patch).eq("booking_request_id", bookingRequestId).select("*").single();
  } else {
    // أول مرة الحجز يوصل للداشبورد.
    const newRow = {
      booking_request_id: bookingRequestId,
      tenant_id: "swnw",
      channel: incomingChannel || "whatsapp",
      status: incomingStatus || "confirmed",
      currency: "EGP",
      created_at: now,
      ...patch
    };
    result = await supabase.from("customer_bookings").insert(newRow).select("*").single();
  }
  if (result.error) {
    return respond({
      ok: false,
      error: result.error.message
    }, 500);
  }
  return respond({
    ok: true,
    booking: result.data
  });
});
