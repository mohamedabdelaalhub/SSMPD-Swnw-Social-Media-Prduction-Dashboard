import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const PEPPER = Deno.env.get("NATIONAL_ID_PEPPER") ?? "";

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

// تطبيع رقم التليفون: إزالة مسافات/رموز اتجاه نص مخفية/شرط، توحيد كود مصر (+20)
function normalizePhone(raw: string): string {
  if (!raw) return "";
  let s = raw.replace(/[\u200E\u200F\u202A-\u202E\s\-()]/g, "");
  s = s.replace(/^00/, "+");
  if (/^01[0125]\d{8}$/.test(s)) s = "+2" + s;
  else if (/^1[0125]\d{8}$/.test(s)) s = "+20" + s;
  else if (!s.startsWith("+")) s = "+" + s.replace(/^0+/, "");
  return s;
}

// هاش SHA-256 + pepper سري — الرقم القومي الخام ميتخزنش أبداً
async function hashNationalId(id: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(id + PEPPER);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// تحقق من JWT الخاص بالمستخدم + جلب صف الـ admin المرتبط به
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
    .select("id, role, has_archive_access, active")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  return row ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const caller = await getCallerAdmin(req);
  if (!caller) return json({ error: "غير مصرح — سجّل دخولك تاني" }, 401);
  const allowed = caller.has_archive_access || caller.role === "super_admin";
  if (!allowed) return json({ error: "مفيش صلاحية أرشيف المرضى" }, 403);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "بيانات غير صالحة" }, 400);
  }

  const fullName = (body.full_name ?? "").toString().trim();
  const phoneRaw = (body.phone ?? "").toString().trim();
  const nationalId = (body.national_id ?? "").toString().trim();

  if (!fullName) return json({ error: "الاسم مطلوب" }, 400);

  const phoneNormalized = phoneRaw ? normalizePhone(phoneRaw) : null;
  const nationalIdHash = nationalId ? await hashNationalId(nationalId) : null;

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: patient, error } = await admin
    .from("patients")
    .insert({
      full_name: fullName,
      phone: phoneRaw || null,
      phone_normalized: phoneNormalized,
      national_id_hash: nationalIdHash,
      created_by: caller.id,
    })
    .select("id, patient_code, full_name, phone, status, created_at")
    .single();

  if (error) return json({ error: error.message }, 500);

  return json({ patient });
});
