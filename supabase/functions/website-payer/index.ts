import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
// Website payment step: machine-to-machine, called ONLY by the booking agent (never by a browser). Same shared secret as booking-sync-ingest.
// ops: options (names of active contracting entities), quote (price only when unambiguous), attach_approval (neutral true / false).
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
Deno.serve(async (request)=>{
  if (request.method !== "POST") return respond({
    ok: false,
    error: "POST only"
  }, 405);
  if (!SYNC_SECRET || request.headers.get("X-Booking-Sync-Secret") !== SYNC_SECRET) return respond({
    ok: false,
    error: "unauthorized"
  }, 401);
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return respond({
    ok: false,
    error: "server_misconfigured"
  }, 500);
  let body;
  try {
    body = await request.json();
  } catch  {
    return respond({
      ok: false,
      error: "invalid_json"
    }, 400);
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  if (body.op === "options") {
    const r = await supabase.rpc("website_payer_options");
    if (r.error) return respond({
      ok: false,
      error: "unavailable"
    }, 503);
    return respond({
      ok: true,
      options: r.data
    });
  }
  if (body.op === "quote") {
    const r = await supabase.rpc("website_payer_quote", {
      p_entity: String(body.entity_id || ""),
      p_base: Number(body.base_price),
      p_day: body.day ? String(body.day) : null
    });
    if (r.error) return respond({
      ok: true,
      price: null
    });
    return respond({
      ok: true,
      price: r.data === null ? null : Number(r.data)
    });
  }
  if (body.op === "attach_approval") {
    const r = await supabase.rpc("website_booking_attach_approval", {
      p_reference: String(body.reference || ""),
      p_phone: String(body.phone || ""),
      p_approval: String(body.approval_no || "")
    });
    // One neutral answer for every failure.
    return respond({
      ok: !r.error && r.data === true
    });
  }
  return respond({
    ok: false,
    error: "unknown_op"
  }, 400);
});
