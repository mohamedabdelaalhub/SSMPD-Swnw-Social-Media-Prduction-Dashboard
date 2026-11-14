import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Lead intake — machine-to-machine (WhatsApp agent on the Egypt server, Messenger/Instagram inbox sync).
// Auth: reuses the secret the WhatsApp agent already shares with the server (header X-WhatsApp-Alert-Secret =
// WHATSAPP_ALERT_SECRET, same as whatsapp-alert), or X-Lead-Ingest-Secret = LEAD_INGEST_SECRET if one is ever set. Creates or reuses a lead through public.ingest_lead
// (idempotent on event_id, de-duplicates by phone). Ad ids come from the Click-to-WhatsApp referral Meta sends with
// the first message (referral.source_id = ad id). Never reads or writes anything on Meta.

const SECRETS = [
  ["X-WhatsApp-Alert-Secret", Deno.env.get("WHATSAPP_ALERT_SECRET")],
  ["X-Lead-Ingest-Secret", Deno.env.get("LEAD_INGEST_SECRET")],
].filter((s): s is [string, string] => !!s[1]);
const SOURCES = new Set(["whatsapp", "messenger", "instagram"]);

function serviceKey(): string | null {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) { try { const p = JSON.parse(raw); if (typeof p?.default === "string" && p.default) return p.default; } catch { /* legacy */ } }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null;
}
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const idOnly = (v: unknown) => { const s = clip(v, 40).replace(/[^\d]/g, ""); return s || null; };

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  if (!SECRETS.length) return json({ ok: false, error: "MISCONFIGURED" }, 500);
  if (!SECRETS.some(([h, v]) => safeEqual(req.headers.get(h) || "", v))) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  const key = serviceKey();
  if (!key) return json({ ok: false, error: "MISCONFIGURED" }, 500);

  const b = await req.json().catch(() => null);
  if (!b) return json({ ok: false, error: "invalid_json" }, 400);
  const source = clip(b.source, 20);
  if (!SOURCES.has(source)) return json({ ok: false, error: "invalid_source" }, 400);
  const eventId = clip(b.event_id, 120).replace(/[^\w:.-]/g, "");
  if (!eventId) return json({ ok: false, error: "event_id required" }, 400);
  const phone = clip(b.phone, 25);
  if (source === "whatsapp" && phone.replace(/\D/g, "").length < 8) return json({ ok: false, error: "phone required" }, 400);
  const at = b.occurred_at && !isNaN(Date.parse(b.occurred_at)) ? new Date(b.occurred_at).toISOString() : new Date().toISOString();

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, key);
  const { data, error } = await admin.rpc("ingest_lead", {
    p_event_id: eventId, p_source: source, p_name: clip(b.name, 120) || null, p_phone: phone || null,
    p_message: clip(b.message, 1000) || null, p_received_at: at,
    p_ad_id: idOnly(b.ad_id), p_adset_id: idOnly(b.adset_id), p_campaign_id: idOnly(b.campaign_id),
  });
  if (error) return json({ ok: false, error: "ingest_failed" }, 500);  // no internal detail to the caller
  const row = Array.isArray(data) ? data[0] : data;
  return json({ ok: true, lead_id: row?.lead_id ?? null, created: !!row?.was_new });
});
