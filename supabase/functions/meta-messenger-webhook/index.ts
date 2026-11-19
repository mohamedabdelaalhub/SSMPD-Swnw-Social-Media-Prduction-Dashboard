import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Meta webhook (Messenger + Instagram). Records ONLY the ad referral of the first message (ad_id) so the
// booking flow can attribute the lead to the ad. Messages themselves are still pulled by meta-comments.
// Verifies the X-Hub-Signature-256 HMAC with META_APP_SECRET; GET handshake uses MESSENGER_WEBHOOK_VERIFY_TOKEN.
function serviceKey(): string | null {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) { try { const p = JSON.parse(raw); if (typeof p?.default === "string" && p.default) return p.default; } catch { /* legacy */ } }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null;
}
async function validSig(body: string, header: string | null, secret: string) {
  if (!header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  const hex = Array.from(mac).map((b) => b.toString(16).padStart(2, "0")).join("");
  const got = header.slice(7);
  if (got.length !== hex.length) return false;
  let d = 0; for (let i = 0; i < hex.length; i++) d |= hex.charCodeAt(i) ^ got.charCodeAt(i);
  return d === 0;
}
const idOnly = (v: unknown) => { const s = String(v ?? "").replace(/[^\d]/g, "").slice(0, 40); return s || null; };

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const vt = Deno.env.get("MESSENGER_WEBHOOK_VERIFY_TOKEN");
    if (vt && url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === vt)
      return new Response(url.searchParams.get("hub.challenge") || "", { status: 200 });
    return new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("method", { status: 405 });
  const secret = Deno.env.get("META_APP_SECRET"), key = serviceKey();
  if (!secret || !key) return new Response("not configured", { status: 503 });
  const raw = await req.text();
  if (!(await validSig(raw, req.headers.get("x-hub-signature-256"), secret))) return new Response("bad signature", { status: 401 });
  let body: any; try { body = JSON.parse(raw); } catch { return new Response("ok"); }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false } });
  const rows: any[] = [];
  for (const entry of body?.entry || []) for (const ev of entry?.messaging || []) {
    const ref = ev?.referral || ev?.postback?.referral || ev?.message?.referral;
    const sender = idOnly(ev?.sender?.id), page = idOnly(entry?.id);
    if (!ref || !sender || !page) continue;
    rows.push({ sender_id: sender, page_id: page, ad_id: idOnly(ref.ad_id || ref.source_id), ref: String(ref.ref || "").slice(0, 200) || null, source: String(ref.source || "").slice(0, 40) || null });
  }
  if (rows.length) await db.from("messenger_referrals").upsert(rows, { onConflict: "sender_id,page_id", ignoreDuplicates: true });
  return new Response("ok"); // always 200 once the signature is valid so Meta does not retry
});
