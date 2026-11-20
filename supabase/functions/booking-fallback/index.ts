// Fallback booking for the WhatsApp agent (and later the website) while the Masa bridge is down.
// Machine-to-machine: authenticates with the existing BOOKING_SYNC_SECRET header, never a dashboard user JWT.
// All logic lives in clinic_reception.fallback_api (service role only). This function never calls Masa and sends no messages.
// Ops: health | slots | book | cancel | status | pending_replay | replay_result | reconcile_list | masa_import | reconcile_flag | masa_schedule
//      | queue_board | my_turn | checkin_link (queue, read-only: numbers/rooms/turn status, no patient data). Errors return {ok:false,error:<code>}.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SYNC_SECRET = Deno.env.get("BOOKING_SYNC_SECRET");
const OPS = new Set(["health", "slots", "book", "cancel", "status", "pending_replay", "replay_result",
  "reconcile_list", "masa_import", "reconcile_flag", "masa_schedule", "queue_board", "my_turn", "checkin_link", "masa_payments_import",
  "masa_patients_import", "masa_archive_import", "masa_payouts_import"]);

function getServiceRoleKey(): string | null {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.default === "string" && parsed.default) return parsed.default;
    } catch { /* fall through */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null;
}
const SERVICE_ROLE_KEY = getServiceRoleKey();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  if (!SYNC_SECRET || req.headers.get("X-Booking-Sync-Secret") !== SYNC_SECRET) return json({ ok: false, error: "unauthorized" }, 401);
  if (!SERVICE_ROLE_KEY) return json({ ok: false, error: "misconfigured" }, 500);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ ok: false, error: "invalid_json" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ ok: false, error: "invalid_json" }, 400);
  const op = typeof body.op === "string" ? body.op : "";
  if (!OPS.has(op)) return json({ ok: false, error: "unknown_op" }, 400);
  const { op: _op, ...payload } = body;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc("clinic_reception_fallback_api", { p_op: op, p_payload: payload });
  // Database errors are reported by code only (no patient data in logs or responses).
  if (error) return json({ ok: false, error: "server_error", code: error.code || null }, 500);
  const result = data as { ok?: boolean; error?: string } | null;
  if (!result) return json({ ok: false, error: "server_error" }, 500);
  const status = result.ok ? 200 : result.error === "slot_taken" || result.error === "booking_request_id_reused" ? 409
    : result.error === "not_found" || result.error === "unknown_doctor" ? 404 : 422;
  return json(result, status);
});
