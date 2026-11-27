import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// «مساعد إنستنكت» e-mail notice endpoint (migration 20261124200000: instinct_notify_outbox). Only the worker on swnw-vps calls it
// (ops/vo-worker/vo.py, step instinct_notify), with the SAME header and secret as vo-worker: X-VO-Worker-Secret =
// Edge secret VO_WORKER_SECRET (server copy ~/vo-worker/.vo-worker-secret). It can only lease outbox lines (item id, staff
// display name, role label, time, link — no message text, no patient data) and ack them. No other table.
// Body: {action: "lease"|"ack", payload: {...}} -> {ok, result}. To switch it off: unset VO_WORKER_SECRET (401).

function serviceKey(): string | null {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) { try { const p = JSON.parse(raw); if (typeof p?.default === "string" && p.default) return p.default; } catch { /* legacy */ } }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null;
}
const reply = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0 && x.length > 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// deno-lint-ignore no-explicit-any
export function rpcArgs(action: string, p: any): { fn: string; args: Record<string, unknown> } | null {
  if (action === "lease") {
    const limit = Math.max(1, Math.min(Number(p?.limit) || 10, 20));
    return { fn: "instinct_outbox_lease", args: { p_limit: limit, p_lease_seconds: 300 } };
  }
  if (action === "ack") {
    const ids = Array.isArray(p?.ids) ? p.ids.filter((x: unknown) => typeof x === "string" && UUID.test(x)).slice(0, 20) : [];
    if (typeof p?.lease_token !== "string" || !UUID.test(p.lease_token) || !ids.length) return null;
    return { fn: "instinct_outbox_ack", args: { p_lease_token: p.lease_token, p_ids: ids, p_ok: p.ok === true, p_error: p.ok === true ? null : String(p.error || "send failed").slice(0, 300) } };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ ok: false, error: "POST only" }, 405);
  const secret = Deno.env.get("VO_WORKER_SECRET") || "";
  if (secret.length < 32 || !sameSecret(req.headers.get("X-VO-Worker-Secret") || "", secret)) return reply({ ok: false, error: "unauthorized" }, 401);
  const key = serviceKey(), url = Deno.env.get("SUPABASE_URL");
  if (!key || !url) return reply({ ok: false, error: "misconfigured" }, 503);
  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return reply({ ok: false, error: "invalid_json" }, 400); }
  const call = rpcArgs(String(body?.action || ""), body?.payload || {});
  if (!call) return reply({ ok: false, error: "invalid_action" }, 400);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.rpc(call.fn, call.args);
  if (error) { console.error(call.fn, error.message); return reply({ ok: false, error: "rejected" }, 400); }
  return reply({ ok: true, result: data });
});
