import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { decideReply, clinicInfo } from "../meta-comments/ai.ts";

// WhatsApp Cloud API → Claude replies (Mohamed, 2026-10-18): same reply rules as the Facebook/Instagram
// comments and messages (meta-comments/ai.ts). Every customer message and every reply is saved in
// public.social_messages (platform "whatsapp"); complaints/emergencies raise the red alert in the dashboard.
//
// Meta setup (done by Mohamed in the Meta developer app, secrets typed by him in Supabase):
//   Webhook URL  = https://<project>.supabase.co/functions/v1/whatsapp-webhook   (field: messages)
//   WHATSAPP_VERIFY_TOKEN  any text; the same text goes in Meta's "Verify token" box
//   WHATSAPP_APP_SECRET    the app's App Secret (checks Meta's X-Hub-Signature-256)
//   WHATSAPP_TOKEN         access token allowed to send from the number
//   WHATSAPP_ALLOWED_NUMBERS  optional "2010xxxxxxx,2011xxxxxxx": while testing Claude only answers these
//   WHATSAPP_AUTOREPLY     "on" to answer; anything else = save only, no replies (kill switch)
//   WHATSAPP_BRANDS        optional JSON {"<phone_number_id>":"dr_dina"}; default brand is sono

const GRAPH = "https://graph.facebook.com/v26.0/";
const enc = new TextEncoder();

function serviceKey(): string | null {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) { try { const p = JSON.parse(raw); if (typeof p?.default === "string" && p.default) return p.default; } catch { /* legacy */ } }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null;
}

async function validSignature(raw: string, header: string | null): Promise<boolean> {
  const secret = Deno.env.get("WHATSAPP_APP_SECRET");
  if (!secret || !header?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(raw)));
  const hex = Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
  const got = header.slice(7);
  if (got.length !== hex.length) return false;
  let d = 0; for (let i = 0; i < hex.length; i++) d |= hex.charCodeAt(i) ^ got.charCodeAt(i);
  return d === 0;
}

function brandFor(phoneNumberId: string): string {
  try { const m = JSON.parse(Deno.env.get("WHATSAPP_BRANDS") || "{}"); if (m[phoneNumberId] === "dr_dina") return "dr_dina"; } catch { /* default */ }
  return "sono";
}

// Center facts staff keep in the dashboard tab «معلومات المركز» (hours, doctors, services), cached 5 min,
// plus the website's doctors/specialties. Prices in them are never quoted (rule in ai.ts).
let knowledge: { at: number; text: string } | null = null;
async function centerFacts(): Promise<string> {
  if (!knowledge || Date.now() - knowledge.at > 5 * 60e3) {
    let text = "";
    const secret = Deno.env.get("WHATSAPP_ALERT_SECRET");
    if (secret) {
      try {
        const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/clinic-knowledge`, { method: "POST", headers: { "X-WhatsApp-Alert-Secret": secret }, signal: AbortSignal.timeout(8000) });
        const d = await r.json(); if (d?.ok && typeof d.text === "string") text = d.text.slice(0, 6000);
      } catch { /* fall back to website facts only */ }
    }
    knowledge = { at: Date.now(), text };
  }
  return [knowledge.text, await clinicInfo()].filter(Boolean).join("\n");
}

async function send(phoneNumberId: string, to: string, body: string) {
  const r = await fetch(`${GRAPH}${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("WHATSAPP_TOKEN") || ""}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: body.slice(0, 4000), preview_url: false } }),
  });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok && !d.error, id: d?.messages?.[0]?.id as string | undefined, error: d?.error?.message as string | undefined };
}

async function markRead(phoneNumberId: string, messageId: string) {
  await fetch(`${GRAPH}${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("WHATSAPP_TOKEN") || ""}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId }),
  }).catch(() => {});
}

// deno-lint-ignore no-explicit-any
async function handle(db: any, value: any) {
  const phoneNumberId = String(value?.metadata?.phone_number_id || "");
  if (!phoneNumberId) return;
  const brand = brandFor(phoneNumberId);
  const names: Record<string, string> = {};
  for (const c of value.contacts || []) if (c?.wa_id) names[c.wa_id] = c.profile?.name || "";
  const allowed = (Deno.env.get("WHATSAPP_ALLOWED_NUMBERS") || "").split(/[,\s]+/).map((x) => x.replace(/\D/g, "")).filter(Boolean);
  const autopilot = (Deno.env.get("WHATSAPP_AUTOREPLY") || "").toLowerCase() === "on";

  for (const m of value.messages || []) {
    const from = String(m.from || "").replace(/\D/g, "");
    if (!from || !m.id) continue;
    const text = m.type === "text" ? String(m.text?.body || "")
      : m.type === "button" ? String(m.button?.text || "")
      : m.type === "interactive" ? String(m.interactive?.button_reply?.title || m.interactive?.list_reply?.title || "")
      : "";
    const now = new Date().toISOString();
    const id = `whatsapp:${m.id}`;
    const ins = await db.from("social_messages").upsert({
      id, platform: "whatsapp", brand, conversation_id: `whatsapp:${from}`, conversation_url: `https://wa.me/${from}`,
      sender_id: from, sender_name: names[from] || null, is_page: false,
      message: text || `(${m.type})`, sent_at: m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : now,
      status: "new", updated_at: now,
    }, { onConflict: "id", ignoreDuplicates: true }).select("id");
    if (ins.error || !ins.data?.length) continue; // duplicate delivery from Meta: already handled
    await markRead(phoneNumberId, m.id);

    if (!autopilot || (allowed.length && !allowed.includes(from))) continue; // saved for staff, no auto reply

    let reply = "", category = "general";
    if (!text.trim()) {
      reply = m.type === "audio"
        ? "أهلاً بيك 🌷 للأسف مش بنقدر نسمع الرسايل الصوتية هنا، ممكن تكتبلنا سؤالك وهنرد عليك على طول؟"
        : "أهلاً بيك 🌷 وصلتنا رسالتك. ممكن تكتبلنا سؤالك أو طلبك بالكلام علشان نقدر نساعدك؟";
    } else {
      // Last messages of this chat (customer + our replies) so Claude continues the conversation.
      const { data: past } = await db.from("social_messages").select("message,reply_text,sent_at")
        .eq("conversation_id", `whatsapp:${from}`).neq("id", id).order("sent_at", { ascending: false }).limit(6);
      const history: string[] = [];
      for (const p of (past || []).reverse()) { history.push(`العميل: ${p.message || ""}`); if (p.reply_text) history.push(`المركز: ${p.reply_text}`); }
      const d = await decideReply({ brand, channel: "whatsapp", text, history, clinicInfo: await centerFacts() });
      if (!d.ok) { await db.from("social_messages").update({ status: "failed", last_error: String(d.error).slice(0, 300), updated_at: now }).eq("id", id); continue; }
      category = d.category || "general";
      if (category === "spam" || !d.reply) { await db.from("social_messages").update({ status: "skipped", category, updated_at: now }).eq("id", id); continue; }
      reply = d.reply;
    }
    const alert = category === "complaint" || category === "emergency";
    const sent = await send(phoneNumberId, from, reply);
    await db.from("social_messages").update(sent.ok
      ? { status: "replied", category, alert, reply_text: reply, replied_at: new Date().toISOString(), reply_platform_id: sent.id || null, updated_at: new Date().toISOString() }
      : { status: "failed", category, alert, reply_text: reply, last_error: String(sent.error).slice(0, 300), updated_at: new Date().toISOString() }).eq("id", id);
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // Meta's one-time webhook check.
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && Deno.env.get("WHATSAPP_VERIFY_TOKEN") &&
      url.searchParams.get("hub.verify_token") === Deno.env.get("WHATSAPP_VERIFY_TOKEN");
    return ok ? new Response(url.searchParams.get("hub.challenge") || "", { status: 200 }) : new Response("forbidden", { status: 403 });
  }
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const raw = await req.text();
  if (!(await validSignature(raw, req.headers.get("X-Hub-Signature-256")))) return new Response("bad signature", { status: 401 });
  const key = serviceKey();
  if (!key) return new Response("MISCONFIGURED", { status: 500 });
  let body: any; try { body = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, key, { auth: { persistSession: false } });
  const work = (async () => {
    for (const e of body?.entry || []) for (const ch of e?.changes || []) if (ch?.field === "messages" && ch.value?.messages) await handle(db, ch.value);
  })().catch((err) => console.error("whatsapp-webhook", String(err?.message || err).slice(0, 200)));
  // Answer Meta right away; the reply is written in the background.
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(work); else await work;
  return new Response("ok", { status: 200 });
});
