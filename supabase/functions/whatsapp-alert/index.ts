import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// WhatsApp agent → SSMPD alerts (one-way, same pattern as booking_sync).
// The WhatsApp customer agent POSTs here when a conversation needs a human (complaint / emergency / handoff).
// Auth: shared secret in X-WhatsApp-Alert-Secret (Edge secret WHATSAPP_ALERT_SECRET). The row lands in
// public.social_messages (platform "whatsapp", alert = true) and shows in the dashboard's red alerts.

const SECRET = Deno.env.get("WHATSAPP_ALERT_SECRET");
const CATEGORIES = new Set(["complaint", "emergency", "handoff", "medical_sensitive", "general"]);

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
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  if (!SECRET) return json({ ok: false, error: "MISCONFIGURED" }, 500);
  if (!safeEqual(req.headers.get("X-WhatsApp-Alert-Secret") || "", SECRET)) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  const key = serviceKey();
  if (!key) return json({ ok: false, error: "MISCONFIGURED" }, 500);

  const b = await req.json().catch(() => null);
  const phone = clip(b?.phone, 20).replace(/[^\d]/g, "");
  if (!b || phone.length < 8) return json({ ok: false, error: "phone required" }, 400);
  const category = CATEGORIES.has(b.category) ? b.category : "handoff";
  const eventId = clip(b.event_id, 80).replace(/[^\w:.-]/g, "") || crypto.randomUUID();
  const at = b.occurred_at && !isNaN(Date.parse(b.occurred_at)) ? new Date(b.occurred_at).toISOString() : new Date().toISOString();
  const reason = clip(b.reason, 300);
  const message = clip(b.customer_message, 2000) || reason || "محادثة واتساب محتاجة تدخل من الفريق";

  const db = createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false } });
  const { error } = await db.from("social_messages").upsert({
    id: `whatsapp:${eventId}`, platform: "whatsapp", brand: b.brand === "dr_dina" ? "dr_dina" : "sono",
    conversation_id: `whatsapp:${phone}`, conversation_url: `https://wa.me/${phone}`,
    sender_id: phone, sender_name: clip(b.name, 120) || null, is_page: false,
    message: reason && message !== reason ? `${message}\n\n(السبب: ${reason})` : message, sent_at: at,
    status: "replied", category, alert: true, reply_text: clip(b.agent_reply, 2000) || null, replied_at: b.agent_reply ? at : null,
    updated_at: new Date().toISOString()
  }, { onConflict: "id", ignoreDuplicates: true });
  if (error) return json({ ok: false, error: "save failed" }, 500);
  return json({ ok: true });
});
