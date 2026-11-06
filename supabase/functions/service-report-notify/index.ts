import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { buildEmail, parseBody, sendEmail } from "./core.mjs";

// Runs under the CALLER's JWT only (staff). No service-role key. Email target comes from a security-definer RPC
// that returns it only for a verified portal account. The email contains no medical details.
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return json({ error: "UNAUTHORIZED" }, 401);
  let body;
  try { body = parseBody(await req.json()); } catch { return json({ error: "INVALID_REQUEST" }, 400); }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
  const prep = await db.rpc("clinic_reception_so_notify_prepare", { p_workspace: body.workspace, p_order: body.order });
  if (prep.error) return json({ error: "NOT_ALLOWED_OR_NOT_FOUND" }, 403);
  const p = prep.data as { status: string; id?: string; to?: string; reason?: string };
  if (p.status !== "ready") return json({ status: p.status, reason: p.reason || null });
  const sent = await sendEmail({
    from: Deno.env.get("CONTRACTING_EMAIL_FROM") || "",
    resend: Deno.env.get("RESEND_API_KEY") || "",
    brevo: Deno.env.get("BREVO_API_KEY") || "",
    sendgrid: Deno.env.get("SENDGRID_API_KEY") || "",
  }, p.to!, buildEmail());
  await db.rpc("clinic_reception_so_notify_result", { p_id: p.id, p_ok: sent.ok, p_error: sent.ok ? null : (sent.code || "EMAIL_SEND_FAILED") });
  return json(sent.ok ? { status: "sent" } : { status: "failed", code: sent.code });
});
