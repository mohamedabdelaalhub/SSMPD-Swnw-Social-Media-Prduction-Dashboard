import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function getCallerAdmin(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return null;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: row } = await admin
    .from("admins")
    .select("id, role, active, admin_extra_roles!admin_id(role)")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!row) return null;
  const extra = (row as unknown as { admin_extra_roles?: { role: string }[] }).admin_extra_roles;
  return { ...row, extra_roles: (extra ?? []).map((r: { role: string }) => r.role) };
}

function isSuperAdmin(caller: { role: string; extra_roles?: string[] }): boolean {
  return caller.role === "super_admin" || (caller.extra_roles ?? []).includes("super_admin");
}

// السوبر أدمن بس يقدر يغيّر كلمة سر أي مستخدم مباشرة (من لوحة "المستخدمون
// والصلاحيات") — مفيد لو موظف نسي كلمة سره ومحتاج حد يعمله باسورد جديد
// فوراً من غير ما يستنى إيميل استرجاع (خصوصاً مع محدودية خدمة الإيميل
// الموثّقة في CLAUDE.md).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const caller = await getCallerAdmin(req);
  if (!caller) return json({ error: "غير مصرح — سجّل دخولك تاني" }, 401);
  if (!isSuperAdmin(caller)) return json({ error: "السوبر أدمن بس يقدر يغيّر كلمة سر مستخدم تاني" }, 403);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "بيانات غير صالحة" }, 400);
  }

  const targetAdminId = (body.admin_id ?? "").toString().trim();
  const newPassword = (body.new_password ?? "").toString();
  if (!targetAdminId) return json({ error: "admin_id مطلوب" }, 400);
  if (!newPassword || newPassword.length < 6) return json({ error: "كلمة السر لازم تكون ٦ حروف/أرقام على الأقل" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: targetRow, error: findErr } = await admin
    .from("admins")
    .select("id, user_id, name, email")
    .eq("id", targetAdminId)
    .maybeSingle();
  if (findErr || !targetRow) return json({ error: "المستخدم غير موجود" }, 404);
  if (!targetRow.user_id) return json({ error: "المستخدم ده لسه معلّق — ماعملش حساب بعد، مفيش كلمة سر تتغيّر" }, 400);

  const { error: updateErr } = await admin.auth.admin.updateUserById(targetRow.user_id, { password: newPassword });
  if (updateErr) return json({ error: updateErr.message }, 500);

  return json({ ok: true });
});
