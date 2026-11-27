import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Website forms («اتصل بنا» / الوظايف) → dashboard (owner 2026-11-27). Machine-to-machine: the new site's server posts here with
// X-Website-Request-Secret (Edge secret WEBSITE_REQUEST_SECRET). Nothing is written to Masa.
// Body: {request_id, kind: contact|job|internship|partner, fields: {...}, hp?, ip?}. hp = honeypot (filled → answered ok, stored nowhere).
// Idempotent on request_id. Rate limit per hashed IP (SQL function). Never logs field values.
// A new request also lands as a red alert in the dashboard (same table as whatsapp-alert) when the sender gave a phone number.

const SECRET = Deno.env.get("WEBSITE_REQUEST_SECRET");
const MAX_BODY = 8000;
const KINDS = new Set(["contact", "job", "internship", "partner"]);
const LABEL: Record<string, string> = { contact: "اتصل بنا", job: "طلب وظيفة", internship: "طلب تدريب", partner: "طلب شراكة" };

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
async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("swnw-website-request:" + text));
  return Array.from(new Uint8Array(buf)).map((x) => x.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  if (!SECRET) return json({ ok: false, error: "MISCONFIGURED" }, 500);
  if (!safeEqual(req.headers.get("X-Website-Request-Secret") || "", SECRET)) return json({ ok: false, error: "UNAUTHORIZED" }, 401);
  const key = serviceKey();
  if (!key) return json({ ok: false, error: "MISCONFIGURED" }, 500);

  const raw = await req.text();
  if (raw.length > MAX_BODY) return json({ ok: false, error: "too_large" }, 413);
  let b: Record<string, unknown> | null = null;
  try { b = JSON.parse(raw); } catch { b = null; }
  if (!b || typeof b !== "object" || Array.isArray(b)) return json({ ok: false, error: "invalid_json" }, 400);
  if (typeof b.hp === "string" && b.hp.trim()) return json({ ok: true }); // honeypot: pretend success, store nothing
  const kind = typeof b.kind === "string" ? b.kind : "";
  if (!KINDS.has(kind)) return json({ ok: false, error: "invalid_kind" }, 400);
  const ip = typeof b.ip === "string" ? b.ip.trim().slice(0, 64) : "";

  const db = createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false } });
  const { data, error } = await db.rpc("website_request_ingest", {
    p_request_id: typeof b.request_id === "string" ? b.request_id : "", p_kind: kind, p_fields: b.fields ?? {}, p_ip_hash: ip ? await sha256(ip) : null,
  });
  if (error) return json({ ok: false, error: "ingest_failed" }, 500); // no internal detail to the caller
  if (!data?.ok) return json({ ok: false, error: data?.error || "invalid" }, data?.error === "rate_limited" ? 429 : 400);

  if (data.created) { // best effort: a red alert for reception; never blocks the form
    try {
      const f = (b.fields ?? {}) as Record<string, unknown>;
      const phone = String(f.phone ?? "").replace(/[^\d]/g, "").slice(0, 20);
      if (phone.length >= 8) {
        await db.from("social_messages").upsert({
          id: `whatsapp:website-${data.id}`, platform: "whatsapp", brand: "sono", conversation_id: `whatsapp:${phone}`,
          conversation_url: `https://wa.me/${phone}`, sender_id: phone, sender_name: String(f.name ?? "").trim().slice(0, 120) || null, is_page: false,
          message: `طلب جديد من الموقع: ${LABEL[kind]}. التفاصيل في الداشبورد ← طلبات الموقع.`, sent_at: new Date().toISOString(),
          status: "new", category: "general", alert: true, updated_at: new Date().toISOString(),
        }, { onConflict: "id", ignoreDuplicates: true });
      }
    } catch { /* alert is optional */ }
  }
  return json({ ok: true, created: !!data.created });
});
