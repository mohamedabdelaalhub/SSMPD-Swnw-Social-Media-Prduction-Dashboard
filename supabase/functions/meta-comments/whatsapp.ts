// WhatsApp replies from the dashboard (owner 2026-11-22: «عايز الرد على الواتساب من الداشبورد»).
// The number is answered by the swnw-agent, so the dashboard never calls Meta for WhatsApp: it only QUEUES a command
// (ops_private.whatsapp_outbox, migration 20261122170000). The agent leases it, takes the conversation over (the bot goes
// quiet), sends, and acks. The 24h window is checked in the database (and again in the agent). index.ts checks the role first.

export const isWhatsApp = (conversationId: unknown) => typeof conversationId === "string" && /^whatsapp:\d{8,15}$/.test(conversationId);

async function enqueue(db: any, args: Record<string, unknown>) {
  const { data, error } = await db.rpc("whatsapp_outbox_enqueue", args);
  if (error || !data) return { ok: false, error: "ما قدرناش نحط الرسالة في الطابور — جرّب تاني" };
  return { ...data, queued: !!data.ok };
}

export function queueText(db: any, o: { conversationId: string; text: string; adminId: string }) {
  return enqueue(db, { p_type: "send", p_conversation_id: o.conversationId, p_admin: o.adminId, p_text: String(o.text || "") });
}

export function queueTemplate(db: any, o: { conversationId: string; name: string; language: string; adminId: string }) {
  return enqueue(db, { p_type: "template", p_conversation_id: o.conversationId, p_admin: o.adminId, p_template_name: String(o.name || ""), p_template_language: String(o.language || "") });
}

export function queueReturn(db: any, o: { conversationId: string; adminId: string }) {
  return enqueue(db, { p_type: "return", p_conversation_id: o.conversationId, p_admin: o.adminId });
}

export async function listTemplates(db: any) {
  const { data, error } = await db.rpc("whatsapp_templates_list");
  if (error) return { ok: false, error: "ما قدرناش نجيب القوالب" };
  return { ok: true, templates: Array.isArray(data) ? data : [] };
}

export async function outboxStatus(db: any, id: string) {
  const { data, error } = await db.rpc("whatsapp_outbox_get", { p_id: id });
  if (error || !data) return { ok: false, error: "outbox" };
  return { ok: true, status: data.status, error: data.error ?? null };
}
