// Pure logic for whatsapp-sync (tested in tests/whatsapp-dashboard-reply.cjs with a fake db).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");

export async function handle(db: any, b: any): Promise<{ status: number; body: unknown }> {
  const action = b.action || "event";
  if (action === "lease" || action === "ack" || action === "templates") {
    const payload = action === "lease" ? { limit: b.limit } : action === "ack" ? { id: b.id, status: b.status, error: b.error ?? null } : { templates: b.templates };
    const { data, error } = await db.rpc("whatsapp_outbox_api", { p_action: action, p_payload: payload });
    if (error) return { status: 500, body: { ok: false, error: "outbox" } };
    return { status: 200, body: data };
  }
  if (action !== "event") return { status: 400, body: { ok: false, error: "action" } };
  return saveEvent(db, b);
}

export async function saveEvent(db: any, b: any): Promise<{ status: number; body: unknown }> {
  const wa = clip(b.wa_id, 20).replace(/[^\d]/g, "");
  if (wa.length < 8 || wa.length > 15) return { status: 400, body: { ok: false, error: "wa_id" } };
  const dir = b.direction === "out" ? "out" : b.direction === "in" ? "in" : "";
  if (!dir) return { status: 400, body: { ok: false, error: "direction" } };
  const text = clip(b.text, 4000);
  if (!text) return { status: 400, body: { ok: false, error: "text" } };
  const at = b.at && !isNaN(Date.parse(b.at)) ? new Date(b.at).toISOString() : new Date().toISOString();
  const mid = clip(b.message_id, 160).replace(/[^\w:.=+-]/g, "") || `${dir}-${crypto.randomUUID()}`;
  const conv = `whatsapp:${wa}`;
  const botState = b.bot_state === "human" ? "human" : b.bot_state === "ai" ? "ai" : null;
  let sentBy: string | null = null;
  if (dir === "out" && b.by === "human" && typeof b.operator_id === "string" && UUID.test(b.operator_id)) {
    const { data: adm } = await db.from("admins").select("id").eq("id", b.operator_id).maybeSingle();
    sentBy = adm?.id || null;
  }
  const now = new Date().toISOString();
  const row: Record<string, unknown> = {
    id: `whatsapp:${mid}`, platform: "whatsapp", brand: "sono", conversation_id: conv, conversation_url: `https://wa.me/${wa}`,
    sender_id: dir === "in" ? wa : "page", sender_name: dir === "in" ? (clip(b.name, 120) || null) : null, is_page: dir === "out",
    message: text, sent_at: at, status: dir === "in" ? "new" : "replied", bot_state: botState, updated_at: now,
  };
  if (sentBy) row.sent_by = sentBy;
  const { error } = await db.from("social_messages").upsert(row, { onConflict: "id", ignoreDuplicates: true });
  if (error) return { status: 500, body: { ok: false, error: "save failed" } };
  if (dir === "out") {
    // The customer's waiting messages are answered now (by the bot or by this staff member).
    const patch: Record<string, unknown> = { status: "replied", reply_text: text, replied_at: at, updated_at: now };
    if (sentBy) patch.sent_by = sentBy;
    await db.from("social_messages").update(patch).eq("conversation_id", conv).eq("is_page", false).eq("status", "new").lte("sent_at", at);
  }
  return { status: 200, body: { ok: true } };
}
