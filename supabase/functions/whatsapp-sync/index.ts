import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { handle } from "./sync.ts";

// swnw-agent <-> dashboard WhatsApp inbox (owner 2026-11-22: «عايز الرد على الواتساب من الداشبورد»).
// Called ONLY by the agent, over its outbound HTTPS, with the same shared secret as whatsapp-alert
// (X-WhatsApp-Alert-Secret / Edge secret WHATSAPP_ALERT_SECRET). Actions (body.action):
//   (none) / "event"  one WhatsApp turn -> public.social_messages (customer, bot or staff; bot_state = who answers now)
//   "lease" / "ack"   the dashboard's queued sends (ops_private.whatsapp_outbox, migration 20261122170000)
//   "templates"       refresh the approved template list for the dashboard picker
//   "template_lease" / "template_ack" / "template_sync"  templates the owner asked for in the dashboard (migration 20261124230000):
//                     lease a request, POST it to Meta with the agent's own token, ack PENDING|FAILED; sync = Meta's review statuses
// The dashboard never calls the agent; nothing here is reachable without the secret.

const SECRET = Deno.env.get("WHATSAPP_ALERT_SECRET");

function serviceKey(): string | null {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) { try { const p = JSON.parse(raw); if (typeof p?.default === "string" && p.default) return p.default; } catch { /* legacy */ } }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null;
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  if (!SECRET) return json({ ok: false, error: "MISCONFIGURED" }, 500);
  if (!safeEqual(req.headers.get("X-WhatsApp-Alert-Secret") || "", SECRET)) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  const key = serviceKey();
  if (!key) return json({ ok: false, error: "MISCONFIGURED" }, 500);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ ok: false, error: "bad body" }, 400);
  const db = createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false } });
  const r = await handle(db, body);
  return json(r.body, r.status);
});
