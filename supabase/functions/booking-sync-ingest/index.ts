import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SYNC_SECRET = Deno.env.get("BOOKING_SYNC_SECRET");

function getServiceRoleKey(): string | null {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.default === "string" && parsed.default) return parsed.default;
    } catch {}
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null;
}

const SERVICE_ROLE_KEY = getServiceRoleKey();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function textValue(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s || null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  if (!SYNC_SECRET || req.headers.get("X-Booking-Sync-Secret") !== SYNC_SECRET) {
    return json({ ok: false, error: "unauthorized" }, 401);
  }
  if (!SERVICE_ROLE_KEY) return json({ ok: false, error: "misconfigured" }, 500);

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ ok: false, error: "invalid_json" }, 400); }

  const bookingRequestId = textValue(body.booking_request_id);
  if (!bookingRequestId) return json({ ok: false, error: "booking_request_id_required" }, 400);

  const status = textValue(body.status) || "confirmed";
  const channel = textValue(body.channel) || "whatsapp";
  const validStatuses = ["confirmed","rescheduled","cancelled","arrived","completed","no_show"];
  const validChannels = ["whatsapp","messenger","instagram","facebook","other"];
  if (!validStatuses.includes(status)) return json({ ok: false, error: "invalid_status" }, 400);
  if (!validChannels.includes(channel)) return json({ ok: false, error: "invalid_channel" }, 400);

  const row: Record<string, unknown> = {
    booking_request_id: bookingRequestId,
    status,
    channel,
    last_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const fields = [
    "booking_flow_id","official_booking_id","booking_reference","tenant_id","wa_id",
    "customer_name","phone","specialty_id","specialty_name","doctor_id","doctor_name",
    "appointment_date","appointment_time","currency","confirmed_at"
  ];
  for (const key of fields) {
    if (body[key] !== undefined) row[key] = textValue(body[key]);
  }
  if (!row.tenant_id) row.tenant_id = "swnw";
  if (!row.currency) row.currency = "EGP";

  if (body.price !== undefined && body.price !== null && body.price !== "") {
    const price = Number(body.price);
    if (!Number.isFinite(price)) return json({ ok: false, error: "invalid_price" }, 400);
    row.price = price;
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const result = await admin.from("customer_bookings")
    .upsert(row, { onConflict: "booking_request_id" })
    .select("*").single();

  if (result.error) return json({ ok: false, error: result.error.message }, 500);
  return json({ ok: true, booking: result.data });
});
