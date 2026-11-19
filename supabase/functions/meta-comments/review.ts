// After the bot hands a conversation to a human: watch what the staff member does.
//  1) no human reply within NO_REPLY_MIN  -> alert the owner (once)
//  2) human replied and the chat went quiet -> AI review: outcome, summary, staff quality -> lead note/status + owner alert if poor
const GRAPH = "https://graph.facebook.com/v26.0/";
const NO_REPLY_MIN = 30, QUIET_MIN = 60;

async function conversationMessages(convId: string, token: string) {
  const u = new URL(GRAPH + convId + "/messages");
  u.searchParams.set("fields", "id,message,from,created_time"); u.searchParams.set("limit", "50"); u.searchParams.set("access_token", token);
  const r = await fetch(u.toString()); const d = await r.json().catch(() => ({}));
  return r.ok && !d.error ? (d.data || []).slice().reverse() : null;
}
function responseText(data: any): string {
  if (typeof data?.output_text === "string") return data.output_text;
  const parts: string[] = [];
  for (const item of data?.output || []) for (const c of item?.content || []) if (typeof c?.text === "string") parts.push(c.text);
  return parts.join("");
}
const RULES = `أنت مراجع جودة لمحادثات مركز عيادات سونو. هتقرا محادثة ماسنجر/انستجرام اتحوّلت من بوت لموظف بشري ("الموظف" = رسائل الصفحة بعد التحويل).
حدّد: outcome (booked لو اتحدد ميعاد حجز فعلاً، declined لو العميل رفض، pending لو لسه مفتوح، unclear)، summary جملتين بالعامية المصرية، booking_time لو اتحدد.
قيّم الموظف: staff_quality = good/ok/poor. اكتب issues لأي مشكلة (مثلاً: ماعرفش يجاوب، رد متأخر أو ناقص، أسلوب غير مهذب أو جاف، معلومة طبية/سعر غير مؤكد، تجاهل سؤال). needs_owner=true لو الموظف ماعرفش يرد أو سلوكه غير مناسب. بدون بيانات تعريفية للعميل غير الاسم الأول.`;

async function aiReview(transcript: string) {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return null;
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST", headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-5.6-sol", instructions: RULES, input: transcript.slice(0, 12000),
      text: { format: { type: "json_schema", name: "flow_review", strict: true, schema: {
        type: "object", additionalProperties: false, required: ["outcome", "summary", "booking_time", "staff_quality", "issues", "needs_owner"],
        properties: { outcome: { type: "string", enum: ["booked", "pending", "declined", "unclear"] }, summary: { type: "string" }, booking_time: { type: "string" },
          staff_quality: { type: "string", enum: ["good", "ok", "poor"] }, issues: { type: "array", items: { type: "string" } }, needs_owner: { type: "boolean" } } } } } })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return null;
  try { return JSON.parse(responseText(d)); } catch { return null; }
}

export async function reviewHandoffs(db: any, brand: string, pageToken: string, selfIds: Set<string>, report: any) {
  const { data: states } = await db.from("messenger_flow_state").select("*").eq("brand", brand).in("stage", ["handoff", "ready"]).gt("updated_at", new Date(Date.now() - 7 * 864e5).toISOString()).limit(30);
  for (const st of states || []) {
    const msgs = await conversationMessages(st.conversation_id, pageToken);
    if (!msgs) continue;
    const { data: botRows } = await db.from("social_messages").select("reply_platform_id").eq("conversation_id", st.conversation_id).not("reply_platform_id", "is", null);
    const botIds = new Set((botRows || []).map((x: any) => x.reply_platform_id));
    const since = Date.parse(st.handoff_at || st.updated_at);
    const human = msgs.filter((m: any) => selfIds.has(m.from?.id) && !botIds.has(m.id) && Date.parse(m.created_time) >= since - 60e3);
    const last = msgs.length ? Date.parse(msgs[msgs.length - 1].created_time) : since;
    const now = Date.now();

    if (!human.length) {
      if (!st.no_reply_alerted && now - since > NO_REPLY_MIN * 60e3 && now - since < 24 * 3600e3) {
        await db.rpc("messenger_flow_notify", { p_message: `تنبيه: محادثة ${brand === "dr_dina" ? "د. دينا" : "سونو"} (${st.handoff_reason || "حجز"}) متحوّلة لموظف من أكتر من ${NO_REPLY_MIN} دقيقة ولسه محدش رد.`, p_role: "super_admin" });
        await db.from("messenger_flow_state").update({ no_reply_alerted: true }).eq("conversation_id", st.conversation_id);
        report.flowAlerts = (report.flowAlerts || 0) + 1;
      }
      continue;
    }
    if (human.length <= (st.reviewed_human_count || 0) || now - last < QUIET_MIN * 60e3) continue;
    const transcript = msgs.filter((m: any) => m.message).map((m: any) => `${botIds.has(m.id) ? "البوت" : selfIds.has(m.from?.id) ? "الموظف" : "العميل"}: ${m.message}`).join("\n");
    const rv = await aiReview(transcript);
    if (!rv) { report.errors.push(`${brand} flow review: تعذر`); continue; }
    const needs = !!rv.needs_owner || rv.staff_quality === "poor";
    await db.from("messenger_flow_reviews").insert({ conversation_id: st.conversation_id, lead_id: st.lead_id, brand, outcome: rv.outcome, summary: rv.summary,
      booking_time: rv.booking_time || null, staff_quality: rv.staff_quality, issues: rv.issues, needs_owner: needs, human_messages: human.length });
    if (st.lead_id) await db.rpc("messenger_flow_apply_review", { p_lead: st.lead_id, p_outcome: rv.outcome, p_summary: rv.summary + (rv.issues?.length ? " | ملاحظات: " + rv.issues.join("، ") : "") });
    if (needs) await db.rpc("messenger_flow_notify", { p_message: `مراجعة محادثة: ${rv.summary} — ملاحظات على الموظف: ${(rv.issues || []).join("، ") || "الموظف ماعرفش يرد"}`.slice(0, 290), p_role: "super_admin" });
    await db.from("messenger_flow_state").update({ reviewed_at: new Date().toISOString(), reviewed_human_count: human.length }).eq("conversation_id", st.conversation_id);
    report.flowReviews = (report.flowReviews || 0) + 1;
  }
}
