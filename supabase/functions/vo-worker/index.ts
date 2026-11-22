import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Instinct voice-over worker endpoint (migration 20261122100000_vo_jobs.sql). Only the worker on swnw-vps calls it
// (ops/vo-worker/vo.py), with header X-VO-Worker-Secret = Edge secret VO_WORKER_SECRET (server copy:
// ~/vo-worker/.vo-worker-secret, mode 600). It can only lease voice-over jobs and report them sent / done / failed —
// no other table. Body: {action: "lease"|"sent"|"done"|"fail", payload: {...}} -> {ok, result}.
// To switch it off: unset VO_WORKER_SECRET (every call then answers 401).

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

Deno.serve(async (req) => {
  if (req.method !== "POST") return reply({ ok: false, error: "POST only" }, 405);
  const secret = Deno.env.get("VO_WORKER_SECRET") || "";
  if (secret.length < 32 || !sameSecret(req.headers.get("X-VO-Worker-Secret") || "", secret)) return reply({ ok: false, error: "unauthorized" }, 401);
  const key = serviceKey(), url = Deno.env.get("SUPABASE_URL");
  if (!key || !url) return reply({ ok: false, error: "misconfigured" }, 503);
  // deno-lint-ignore no-explicit-any
  let body: any;
  try { body = await req.json(); } catch { return reply({ ok: false, error: "invalid_json" }, 400); }
  const action = String(body?.action || "");
  if (!["lease", "sent", "done", "fail"].includes(action)) return reply({ ok: false, error: "invalid_action" }, 400);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await admin.rpc("vo_worker_api", { p_action: action, p_payload: body?.payload || {} });
  if (error) { console.error("vo_worker_api", error.message); return reply({ ok: false, error: "rejected" }, 400); }
  return reply({ ok: true, result: data });
});
