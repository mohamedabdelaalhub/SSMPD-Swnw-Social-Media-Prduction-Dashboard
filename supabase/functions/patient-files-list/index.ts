import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
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
    .select("id, role, has_archive_access, active")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  return row ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const caller = await getCallerAdmin(req);
  if (!caller) return json({ error: "غير مصرح — سجّل دخولك تاني" }, 401);
  const allowed = caller.has_archive_access || caller.role === "super_admin";
  if (!allowed) return json({ error: "مفيش صلاحية أرشيف المرضى" }, 403);

  const url = new URL(req.url);
  const patientId = url.searchParams.get("patient_id");
  const search = url.searchParams.get("search")?.trim();
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const pageSize = Math.min(50, Math.max(1, Number(url.searchParams.get("page_size") ?? "20") || 20));

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // لو patient_id متبعت، رجّع بيانات المريض + كل ملفاته مصنّفة
  if (patientId) {
    const { data: patient, error: pErr } = await admin
      .from("patients")
      .select("id, patient_code, full_name, phone, status, created_at")
      .eq("id", patientId)
      .maybeSingle();
    if (pErr || !patient) return json({ error: "المريض غير موجود" }, 404);

    const { data: files, error: fErr } = await admin
      .from("patient_files")
      .select("id, category, file_name, file_size, mime_type, uploaded_at, uploaded_by")
      .eq("patient_id", patientId)
      .order("uploaded_at", { ascending: false });
    if (fErr) return json({ error: fErr.message }, 500);

    await admin.from("archive_access_log").insert({
      patient_id: patientId,
      employee_id: caller.id,
      action: "view",
    });

    return json({ patient, files: files ?? [] });
  }

  // من غير patient_id: قائمة/بحث المرضى (اسم أو رقم أو patient_code)
  let query = admin
    .from("patients")
    .select("id, patient_code, full_name, phone, status, created_at", { count: "exact" })
    .order("created_at", { ascending: false });

  if (search) {
    query = query.or(
      `full_name.ilike.%${search}%,phone.ilike.%${search}%,phone_normalized.ilike.%${search}%,patient_code.ilike.%${search}%`,
    );
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const { data: patients, error, count } = await query.range(from, to);
  if (error) return json({ error: error.message }, 500);

  return json({ patients: patients ?? [], total: count ?? 0, page, page_size: pageSize });
});
