// Private messages (Messenger + Instagram Direct): pull recent conversations into public.social_messages
// and answer the latest customer message within Meta's 24-hour window (autopilot), using the same
// reply rules as comments. Complaints raise a red alert in the dashboard.
import { decideReply, clinicInfo } from "./ai.ts";

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
    const r = await gget(`${pageId}/conversations`, {
      platform, fields: "id,link,updated_time,messages.limit(6){id,message,from,created_time}",
      limit: platform === "instagram" ? "8" : "20", access_token: token
    });
    if (!r.ok) { report.errors.push(`${brand} ${platform} messages: ${r.error}`); continue; }
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

      const decision = await decideReply({
        brand, channel: "message", text: waiting.map((m: any) => m.message || "").join("\n"),
        history: msgs.slice(Math.max(0, lastPage - 3), lastPage + 1).map((m: any) => `${selfIds.has(m.from?.id) ? "الصفحة" : "العميل"}: ${m.message || ""}`),
        clinicInfo: await clinicInfo()
      });
      const now = new Date().toISOString();
      if (!decision.ok) { report.errors.push(`${brand} message reply: ${decision.error}`); break; }
      if (decision.category === "spam" || !decision.reply) {
        await db.from("social_messages").update({ status: "skipped", category: decision.category, updated_at: now }).in("id", ids);
        continue;
      }
      const recipient = latest.from?.id;
      const sent = await gpostJson(`${pageId}/messages`, token, { recipient: { id: recipient }, messaging_type: "RESPONSE", message: { text: decision.reply } });
      const alert = decision.category === "complaint" || decision.category === "emergency";
      if (sent.ok) {
        await db.from("social_messages").update({ status: "replied", category: decision.category, alert, reply_text: decision.reply, replied_at: now, reply_platform_id: sent.data.message_id || null, updated_at: now }).in("id", ids);
        report.messagesReplied = (report.messagesReplied || 0) + 1;
      } else {
        await db.from("social_messages").update({ status: "failed", category: decision.category, alert, reply_text: decision.reply, last_error: String(sent.error).slice(0, 300), updated_at: now }).in("id", ids);
        report.errors.push(`${brand} send message: ${sent.error}`);
      }
    }
  }
}
