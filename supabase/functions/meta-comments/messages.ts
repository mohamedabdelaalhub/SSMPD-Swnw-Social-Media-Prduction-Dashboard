// Private messages (Messenger + Instagram Direct): pull recent conversations into public.social_messages
// and answer the latest customer message within Meta's 24-hour window (autopilot), using the same
// reply rules as comments. Complaints raise a red alert in the dashboard.
import { decideReply, clinicInfo } from "./ai.ts";
import { advance, serviceLabel } from "./flow.mjs";
import { reviewHandoffs } from "./review.ts";

const GRAPH = "https://graph.facebook.com/v26.0/";
const WINDOW_MS = 23.5 * 3600e3; // stay inside Meta's 24h standard messaging window

async function gget(path: string, params: Record<string, string>) {
  const u = new URL(GRAPH + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u.toString());
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok && !d.error, data: d, error: d.error?.message as string | undefined };
}
async function gpostJson(path: string, token: string, body: unknown) {
  const r = await fetch(`${GRAPH}${path}?access_token=${encodeURIComponent(token)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok && !d.error, data: d, error: d.error?.message as string | undefined };
}

export async function syncMessages(db: any, brand: string, cfg: any, token: string, report: any, autopilot: boolean) {
  if (!cfg?.facebook_page_id) return;
  const pageId = cfg.facebook_page_id, igId = cfg.instagram_business_account_id;
  for (const platform of ["messenger", "instagram"] as const) {
    if (platform === "instagram" && !igId) continue;
    // Instagram rejects nested messages on the conversations list ("reduce the amount of data"/timeout),
    // so there the messages of each conversation are read one by one.
    const ig = platform === "instagram";
    const r = await gget(`${pageId}/conversations`, {
      platform, fields: ig ? "id,updated_time" : "id,link,updated_time,messages.limit(6){id,message,from,created_time}",
      limit: ig ? "10" : "20", access_token: token
    });
    if (!r.ok) { report.errors.push(`${brand} ${platform} messages: ${r.error}`); continue; }
    if (ig) for (const conv of r.data.data || []) {
      if (conv.updated_time && Date.now() - Date.parse(conv.updated_time) > 3 * 864e5) { conv.messages = { data: [] }; continue; }
      const mr = await gget(`${conv.id}/messages`, { fields: "id,message,from,created_time", limit: "6", access_token: token });
      conv.messages = { data: mr.ok ? mr.data.data || [] : [] };
      if (!mr.ok) report.errors.push(`${brand} instagram conversation: ${mr.error}`);
    }
    const plat = platform === "messenger" ? "facebook" : "instagram";
    const selfIds = new Set([pageId, igId].filter(Boolean));
    for (const conv of r.data.data || []) {
      const msgs = (conv.messages?.data || []).slice().reverse(); // oldest → newest
      if (!msgs.length) continue;
      const rows = msgs.map((m: any) => ({
        id: `${plat}:${m.id}`, platform: plat, brand, conversation_id: conv.id,
        conversation_url: conv.link ? (String(conv.link).startsWith("http") ? conv.link : `https://www.facebook.com${conv.link}`) : null,
        sender_id: m.from?.id || null, sender_name: m.from?.name || m.from?.username || null,
        is_page: selfIds.has(m.from?.id), message: m.message || "", sent_at: m.created_time || null,
        status: selfIds.has(m.from?.id) ? "replied" : "new"
      }));
      const ins = await db.from("social_messages").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
      if (ins.error) { report.errors.push(`${brand} save messages: ${ins.error.message}`); continue; }
      report.messages = (report.messages || 0) + rows.length;

      // Customer messages after the page's last message are the ones waiting.
      let lastPage = -1;
      msgs.forEach((m: any, i: number) => { if (selfIds.has(m.from?.id)) lastPage = i; });
      const waiting = msgs.slice(lastPage + 1).filter((m: any) => !selfIds.has(m.from?.id));
      const earlierIds = msgs.slice(0, lastPage + 1).filter((m: any) => !selfIds.has(m.from?.id)).map((m: any) => `${plat}:${m.id}`);
      if (earlierIds.length) await db.from("social_messages").update({ status: "replied", updated_at: new Date().toISOString() }).in("id", earlierIds).eq("status", "new");
      if (!waiting.length) continue;
      const latest = waiting[waiting.length - 1];
      const ids = waiting.map((m: any) => `${plat}:${m.id}`);
      if (Date.now() - Date.parse(latest.created_time) > WINDOW_MS) {
        await db.from("social_messages").update({ status: "expired", updated_at: new Date().toISOString() }).in("id", ids).eq("status", "new");
        continue;
      }
      if (!autopilot) continue;
      // Already tried this exact message (e.g. failed send)? Don't loop on it.
      const { data: cur } = await db.from("social_messages").select("status").eq("id", `${plat}:${latest.id}`).maybeSingle();
      if (cur && cur.status !== "new") continue;

      const waitingText = waiting.map((m: any) => m.message || "").join("\n");
      const now = new Date().toISOString();
      const recipient = latest.from?.id;
      // Booking flow first (state per conversation); general info questions fall back to decideReply.
      const { data: st } = await db.from("messenger_flow_state").select("*").eq("conversation_id", conv.id).maybeSingle();
      const hist = msgs.slice(Math.max(0, lastPage - 3), lastPage + 1).map((m: any) => `${selfIds.has(m.from?.id) ? "الصفحة" : "العميل"}: ${m.message || ""}`);
      let decision = await decideReply({ brand, channel: "message", text: waitingText, history: hist, clinicInfo: await clinicInfo() });
      if (!decision.ok) { report.errors.push(`${brand} message reply: ${decision.error}`); break; }
      if (decision.category === "spam" && !st) {
        await db.from("social_messages").update({ status: "skipped", category: decision.category, updated_at: now }).in("id", ids);
        continue;
      }
      const flow = advance(st, waitingText, { category: decision.category, firstContact: !st && lastPage < 0 });
      if (flow.silent) { await db.from("social_messages").update({ status: "skipped", category: "handoff", updated_at: now }).in("id", ids); continue; }
      if (flow.passthrough) { /* thanks: keep decideReply's text, no state change */ }
      else {
        let reply = flow.reply;
        if (flow.infoReply && decision.reply) reply = decision.reply + "\n\n" + flow.reply;
        else if (flow.alert && !reply) reply = decision.reply; // approved emergency/complaint template from ai.ts
        decision = { ...decision, category: flow.handoff === "emergency" ? "emergency" : flow.handoff === "complaint" ? "complaint" : decision.category, reply };
        const s = flow.state;
        const row = { conversation_id: conv.id, platform: plat, brand, sender_id: recipient, stage: s.stage, name: s.name, phone: s.phone, service: s.service,
          preferred_time: s.preferred_time, expect: s.expect, unclear: s.unclear, handoff_reason: s.handoff_reason, updated_at: now,
          ...((flow.handoff || flow.ready) && !st?.handoff_at ? { handoff_at: now } : {}) };
        let leadId = st?.lead_id || null;
        if (flow.ready) {
          // Ad attribution from the webhook referral (if the webhook is live); campaign/adset come from the synced ad rows.
          const { data: ref } = await db.from("messenger_referrals").select("ad_id").eq("sender_id", recipient).eq("page_id", pageId).maybeSingle();
          const { data: adRow } = ref?.ad_id ? await db.from("meta_ads_daily").select("adset_id,campaign_id").eq("ad_id", ref.ad_id).limit(1).maybeSingle() : { data: null };
          const { data: lead, error: le } = await db.rpc("ingest_lead", { p_event_id: `${plat}:flow:${conv.id}`, p_source: platform, p_name: s.name, p_phone: s.phone,
            p_message: `حجز ${serviceLabel(s.service)} — الوقت المفضل: ${s.preferred_time}`, p_ad_id: ref?.ad_id || null, p_adset_id: adRow?.adset_id || null, p_campaign_id: adRow?.campaign_id || null });
          if (le) { report.errors.push(`${brand} ingest_lead: ${le.message}`); continue; }
          leadId = Array.isArray(lead) ? lead[0]?.lead_id : lead?.lead_id;
          await db.rpc("messenger_flow_notify", { p_message: `حجز جديد من ${platform === "messenger" ? "ماسنجر" : "انستجرام"}: ${s.name} — ${serviceLabel(s.service)} — ${s.phone} — ${s.preferred_time}` });
        } else if (flow.handoff) {
          await db.rpc("messenger_flow_notify", { p_message: `محادثة محتاجة موظف (${flow.handoff}) على ${platform === "messenger" ? "ماسنجر" : "انستجرام"} — ${brand}` });
        }
        await db.from("messenger_flow_state").upsert({ ...row, lead_id: leadId }, { onConflict: "conversation_id" });
      }
      if (!decision.reply) {
        await db.from("social_messages").update({ status: "skipped", category: decision.category, alert: flow.alert, updated_at: now }).in("id", ids);
        continue;
      }
      const sent = await gpostJson(`${pageId}/messages`, token, { recipient: { id: recipient }, messaging_type: "RESPONSE", message: { text: decision.reply } });
      const alert = flow.alert || decision.category === "complaint" || decision.category === "emergency";
      if (sent.ok) {
        await db.from("social_messages").update({ status: "replied", category: decision.category, alert, reply_text: decision.reply, replied_at: now, reply_platform_id: sent.data.message_id || null, updated_at: now }).in("id", ids);
        report.messagesReplied = (report.messagesReplied || 0) + 1;
      } else {
        await db.from("social_messages").update({ status: "failed", category: decision.category, alert, reply_text: decision.reply, last_error: String(sent.error).slice(0, 300), updated_at: now }).in("id", ids);
        report.errors.push(`${brand} send message: ${sent.error}`);
      }
    }
  }
  await reviewHandoffs(db, brand, token, new Set([pageId, igId].filter(Boolean)), report).catch((e) => report.errors.push(`${brand} flow review: ${e?.message}`));
}

// ---------- Manual replies from the dashboard (owner 2026-11-22: «ايوة عايز الموظف يقدر يرد من الداشبورد») ----------
// Only Messenger / Instagram Direct, only inside Meta's 24h standard messaging window (messaging_type RESPONSE),
// sent with the same page token the autopilot uses. The caller's role is checked in index.ts before this runs.
export const MANUAL_WINDOW_MS = 24 * 3600e3;
export const WINDOW_CLOSED_AR = "عدّى 24 ساعة من آخر رسالة للعميل — ميتا مش بتسمح بالرد";

async function conversationRows(db: any, conversationId: string) {
  const { data, error } = await db.from("social_messages").select("*").eq("conversation_id", conversationId)
    .order("sent_at", { ascending: false }).limit(60);
  if (error) throw new Error(error.message);
  return (data || []) as any[];
}

export async function suggestMessage(db: any, conversationId: string) {
  const rows = await conversationRows(db, conversationId);
  if (!rows.length) return { ok: false, error: "المحادثة مش موجودة" };
  const chrono = rows.slice().reverse();
  let lastPage = -1;
  chrono.forEach((m, i) => { if (m.is_page) lastPage = i; });
  const waiting = chrono.slice(lastPage + 1).filter((m) => !m.is_page);
  if (!waiting.length) return { ok: false, error: "مفيش رسالة من العميل مستنية رد" };
  const hist = chrono.slice(Math.max(0, lastPage - 3), lastPage + 1).map((m) => `${m.is_page ? "الصفحة" : "العميل"}: ${m.message || ""}`);
  const d = await decideReply({ brand: rows[0].brand, channel: "message", text: waiting.map((m) => m.message || "").join("\n"), history: hist, clinicInfo: await clinicInfo() });
  if (!d.ok) return { ok: false, error: d.error || "تعذر اقتراح رد" };
  return { ok: true, text: d.reply || "" };
}

export async function sendManualMessage(db: any, opts: { conversationId: string; text: string; adminId: string; token: (brand: string) => string | null; now?: number }) {
  const text = String(opts.text || "").trim();
  if (!text) return { ok: false, error: "اكتب الرسالة الأول" };
  if (text.length > 2000) return { ok: false, error: "الرسالة طويلة — الحد 2000 حرف" };
  const rows = await conversationRows(db, opts.conversationId);
  if (!rows.length) return { ok: false, error: "المحادثة مش موجودة" };
  const { brand, platform } = rows[0];
  if (platform !== "facebook" && platform !== "instagram") return { ok: false, error: "الرد من الداشبورد على ماسنجر وانستجرام بس" };
  const lastCustomer = rows.find((m) => !m.is_page);
  if (!lastCustomer || !lastCustomer.sender_id) return { ok: false, error: "مفيش رسالة من العميل نرد عليها" };
  const now = opts.now ?? Date.now();
  if (!lastCustomer.sent_at || now - Date.parse(lastCustomer.sent_at) > MANUAL_WINDOW_MS) return { ok: false, error: "WINDOW_CLOSED", message: WINDOW_CLOSED_AR };
  const token = opts.token(brand);
  const { data: cfg } = await db.from("meta_brand_config").select("facebook_page_id").eq("brand", brand).maybeSingle();
  if (!token || !cfg?.facebook_page_id) return { ok: false, error: "الصفحة مش متوصلة بميتا (التوكن أو رقم الصفحة ناقص)" };
  const sent = await gpostJson(`${cfg.facebook_page_id}/messages`, token, { recipient: { id: lastCustomer.sender_id }, messaging_type: "RESPONSE", message: { text } });
  if (!sent.ok) return { ok: false, error: "ميتا رفضت الإرسال: " + String(sent.error || "خطأ غير معروف").slice(0, 200) };
  const at = new Date(now).toISOString(), mid = sent.data?.message_id || `manual-${now}`;
  const ins = await db.from("social_messages").upsert({
    id: `${platform}:${mid}`, platform, brand, conversation_id: opts.conversationId, conversation_url: lastCustomer.conversation_url || null,
    sender_id: cfg.facebook_page_id, sender_name: null, is_page: true, message: text, sent_at: at, status: "replied", sent_by: opts.adminId, updated_at: at
  }, { onConflict: "id" });
  // Customer messages after the page's previous reply are now answered (by this person).
  const chrono = rows.slice().reverse();
  let lastPage = -1;
  chrono.forEach((m, i) => { if (m.is_page) lastPage = i; });
  const ids = chrono.slice(lastPage + 1).filter((m) => !m.is_page && ["new", "failed", "expired"].includes(m.status)).map((m) => m.id);
  if (ids.length) await db.from("social_messages").update({ status: "replied", reply_text: text, replied_at: at, reply_platform_id: mid, sent_by: opts.adminId, last_error: null, updated_at: at }).in("id", ids);
  return { ok: true, id: `${platform}:${mid}`, saved: !ins.error };
}
