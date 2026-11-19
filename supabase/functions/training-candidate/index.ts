// Public edge function for the training-center candidate exam link (PR 4).
// No JWT: the only credential is the one-time token. It accepts a fixed set of actions, hashes the browser's device id,
// and calls the token-scoped RPCs (service_role only). It never returns a score, grade or answer key (the RPCs do not).
// Rate limit: per token and per IP, in memory per isolate (the token is 244 random bits; this only slows noise).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
function getServiceRoleKey(): string | null {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.default === "string" && parsed.default) return parsed.default;
    } catch { /* fall through */ }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null;
}
const SERVICE_ROLE_KEY = getServiceRoleKey();
const ALLOWED_ORIGINS = new Set([
  "https://mohamedabdelaalhub.github.io",
  "https://swnwclinics.com", "https://www.swnwclinics.com",
]);

function cors(req: Request): Record<string, string> {
  const o = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS.has(o) ? o : "https://mohamedabdelaalhub.github.io",
    "Access-Control-Allow-Headers": "content-type, apikey, authorization",
    "Access-Control-Allow-Methods": "POST, OPTIONS", "Vary": "Origin",
  };
}
function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...cors(req) } });
}

const hits = new Map<string, { n: number; t: number }>();
function limited(key: string, max: number): boolean {
  const now = Date.now(), h = hits.get(key);
  if (!h || now - h.t > 60_000) { hits.set(key, { n: 1, t: now }); return false; }
  h.n++;
  if (hits.size > 5000) hits.clear();
  return h.n > max;
}
async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const str = (v: unknown, max: number) => typeof v === "string" && v.length <= max ? v : "";

// Postgres error → short public code. Messages never include data.
function publicError(msg: string, code?: string): { status: number; error: string } {
  if (/link is bound to another device/.test(msg)) return { status: 403, error: "other_device" };
  if (/link expired/.test(msg)) return { status: 410, error: "expired" };
  if (/link closed/.test(msg)) return { status: 410, error: "closed" };
  if (/invalid link/.test(msg)) return { status: 404, error: "invalid_link" };
  if (code === "22023") return { status: 422, error: "invalid_request" };
  return { status: 500, error: "server_error" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(req) });
  if (req.method !== "POST") return json(req, { ok: false, error: "POST only" }, 405);
  if (!SERVICE_ROLE_KEY) return json(req, { ok: false, error: "misconfigured" }, 500);

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json(req, { ok: false, error: "invalid_json" }, 400); }
  if (!b || typeof b !== "object" || Array.isArray(b)) return json(req, { ok: false, error: "invalid_json" }, 400);
  const action = str(b.action, 20), token = str(b.token, 200), device = str(b.device, 100);
  // «result» is the view-once result link (separate token, no device binding); every other action needs a device id.
  if (token.length < 40 || (action !== "result" && device.length < 16)) return json(req, { ok: false, error: "invalid_link" }, 404);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "?";
  if (limited("t:" + token.slice(0, 16), 120) || limited("i:" + ip, 300)) {
    return json(req, { ok: false, error: "slow_down" }, 429);
  }
  const dev = await sha256("training-candidate:" + device);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  let res;
  switch (action) {
    case "open": res = await admin.rpc("training_candidate_open", { p_token: token, p_device: dev }); break;
    case "consent": res = await admin.rpc("training_candidate_consent", { p_token: token, p_device: dev, p_version: str(b.version, 40) }); break;
    case "profile": res = await admin.rpc("training_candidate_profile", {
      p_token: token, p_device: dev, p_phone: str(b.phone, 40), p_email: str(b.email, 200),
      p_experience: str(b.experience, 3000), p_qualifications: str(b.qualifications, 3000) }); break;
    case "start": res = await admin.rpc("training_candidate_start", { p_token: token, p_device: dev }); break;
    case "save": res = await admin.rpc("training_candidate_save", {
      p_token: token, p_device: dev, p_question: str(b.question, 40), p_option: str(b.option, 4) }); break;
    case "blur": res = await admin.rpc("training_candidate_blur", { p_token: token, p_device: dev }); break;
    case "submit": res = await admin.rpc("training_candidate_submit", { p_token: token, p_device: dev }); break;
    case "result": res = await admin.rpc("training_candidate_result", { p_token: token }); break;
    default: return json(req, { ok: false, error: "unknown_action" }, 400);
  }
  if (res.error) {
    const e = publicError(res.error.message || "", res.error.code);
    return json(req, { ok: false, error: e.error }, e.status);
  }
  return json(req, { ok: true, data: res.data ?? null });
});
