import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Role-checked proxy for the ads-expenses Apps Script bridge (bank movements, card last4, balances).
// The bridge itself requires ?token=<ADS_EXPENSES_BRIDGE_TOKEN>, so the browser never talks to it.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const BRIDGE_URL = Deno.env.get("ADS_EXPENSES_BRIDGE_URL") || "";
const BRIDGE_TOKEN = Deno.env.get("ADS_EXPENSES_BRIDGE_TOKEN") || "";
// Roles that may see real bank/ad-spend data. Edit here if the owner wants others to see it.
const ALLOWED_ROLES = ["super_admin", "general_manager", "page_manager"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function callerRoles(req: Request): Promise<string[] | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return null;
  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: row } = await db.from("admins")
    .select("id, role, admin_extra_roles!admin_id(role)").eq("user_id", user.id).eq("active", true).maybeSingle();
  if (!row) return null;
  const extra = (row as unknown as { admin_extra_roles?: { role: string }[] }).admin_extra_roles ?? [];
  return [row.role as string, ...extra.map((r) => r.role)];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  const roles = await callerRoles(req);
  if (!roles) return json({ error: "غير مصرح — سجّل دخولك تاني" }, 401);
  if (!roles.some((r) => ALLOWED_ROLES.includes(r))) return json({ error: "مفيش صلاحية لمصروفات الإعلانات" }, 403);
  if (!BRIDGE_URL) return json({ error: "جسر المصروفات مش متظبط على السيرفر" }, 503);
  const url = BRIDGE_TOKEN ? `${BRIDGE_URL}${BRIDGE_URL.includes("?") ? "&" : "?"}token=${encodeURIComponent(BRIDGE_TOKEN)}` : BRIDGE_URL;
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return json({ error: `تعذّر الوصول للجسر (${res.status})` }, 502);
    return json(await res.json());
  } catch (e) {
    return json({ error: "تعذّر الوصول للجسر: " + String((e as Error).message ?? e) }, 502);
  }
});
