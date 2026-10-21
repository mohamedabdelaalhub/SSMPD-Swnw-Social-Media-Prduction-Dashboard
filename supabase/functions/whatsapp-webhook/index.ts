import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { decideReply, clinicInfo } from "../meta-comments/ai.ts";
import { factCache } from "../meta-comments/clinic-facts.ts";

// WhatsApp Cloud API → OpenAI replies (Mohamed, 2026-10-18): same reply rules as the Facebook/Instagram
// comments and messages (meta-comments/ai.ts). Every customer message and every reply is saved in
// public.social_messages (platform "whatsapp"); complaints/emergencies raise the red alert in the dashboard.
//
// Meta setup (done by Mohamed in the Meta developer app, secrets typed by him in Supabase):
//   Webhook URL  = https://<project>.supabase.co/functions/v1/whatsapp-webhook   (field: messages)
//   WHATSAPP_VERIFY_TOKEN  any text; the same text goes in Meta's "Verify token" box
//   WHATSAPP_APP_SECRET    the app's App Secret (checks Meta's X-Hub-Signature-256)
//   WHATSAPP_TOKEN         access token allowed to send from the number
//   WHATSAPP_ALLOWED_NUMBERS  optional "2010xxxxxxx,2011xxxxxxx": while testing the agent only answers these
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

// Dashboard facts take precedence over the website. Keep the existing five-minute refresh.
const dashboardFacts = factCache(async () => {
  const secret = Deno.env.get("WHATSAPP_ALERT_SECRET");
  if (!secret) throw new Error("MISSING_CLINIC_KNOWLEDGE_CREDENTIAL");
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/clinic-knowledge`, {
    method: "POST", headers: { "X-WhatsApp-Alert-Secret": secret }, signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error("CLINIC_KNOWLEDGE_HTTP_ERROR");
  const d = await r.json();
  if (!d?.ok || typeof d.text !== "string" || d.text.length > 40000) throw new Error("INVALID_CLINIC_KNOWLEDGE");
  return d.text;
}, 5 * 60e3);
async function centerFacts(): Promise<string> {
  const [dashboard, website] = await Promise.all([dashboardFacts(), clinicInfo()]);
  return [dashboard, website].filter(Boolean).join("\n\n");
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
async function handleStatus(db: any, value: any) {
  for (const status of value?.statuses || []) {
    const wamid = String(status?.id || "");
    const state = String(status?.status || "");
    if (!wamid || !state) continue;

    const { data: matches } = await db.from("contracting_activity_log")
      .select("id,entity_id,agreement_id,created_by,metadata")
      .contains("metadata", { provider_message_id: wamid })
      .order("created_at", { ascending: false })
      .limit(1);
    const base = matches?.[0];
    if (!base?.agreement_id || !base?.entity_id) continue;

    const actionKey = `whatsapp_${state}`;
    const { data: duplicate } = await db.from("contracting_activity_log")
      .select("id")
      .eq("agreement_id", base.agreement_id)
      .eq("action_key", actionKey)
      .contains("metadata", { provider_message_id: wamid })
      .limit(1);
    if (duplicate?.length) continue;

    const error = Array.isArray(status?.errors) ? status.errors[0] : null;
    const timestamp = status?.timestamp ? new Date(Number(status.timestamp) * 1000).toISOString() : new Date().toISOString();
    const arabicState = state === "delivered" ? "تم التسليم"
      : state === "read" ? "تمت القراءة"
      : state === "sent" ? "تم الإرسال من Meta"
      : state === "failed" ? "فشل التسليم"
      : state;

    await db.from("contracting_activity_log").insert({
      entity_id: base.entity_id,
      agreement_id: base.agreement_id,
      action_key: actionKey,
      summary: `${arabicState} عبر واتساب`,
      metadata: {
        channel: "whatsapp",
        provider: "meta_whatsapp",
        provider_message_id: wamid,
        delivery_status: state,
        recipient_id: status?.recipient_id || null,
        status_at: timestamp,
        error_code: error?.code || null,
        error_title: error?.title || null,
        error_message: error?.message || null,
        error_details: error?.error_data?.details || null,
      },
      created_by: base.created_by || null,
    });

    if (state === "delivered") {
      await db.from("contracting_agreements")
        .update({ status: "sent", sent_at: timestamp })
        .eq("id", base.agreement_id);
    }
  }
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
      // Last six inbound turns; only successfully sent replies belong in the conversation.
      const { data: past } = await db.from("social_messages").select("message,reply_text,sent_at,status")
        .eq("conversation_id", `whatsapp:${from}`).eq("platform", "whatsapp").eq("brand", brand)
        .neq("id", id).order("sent_at", { ascending: false }).limit(6);
      const history: string[] = [];
      for (const p of (past || []).reverse()) { history.push(`العميل: ${p.message || ""}`); if (p.status === "replied" && p.reply_text) history.push(`المركز: ${p.reply_text}`); }
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
    for (const e of body?.entry || []) {
      for (const ch of e?.changes || []) {
        if (ch?.field !== "messages") continue;
        if (ch.value?.statuses) await handleStatus(db, ch.value);
        if (ch.value?.messages) await handle(db, ch.value);
      }
    }
  })().catch((err) => console.error("whatsapp-webhook", String(err?.message || err).slice(0, 200)));
  // Answer Meta right away; the reply is written in the background.
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(work); else await work;
  return new Response("ok", { status: 200 });
});
