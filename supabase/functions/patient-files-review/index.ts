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

// ---------- تحقق من JWT + صلاحية المراجعة (منفصلة تماماً عن صلاحية الرفع) ----------
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
    .select("id, role, has_archive_review_access, active, admin_extra_roles(role)")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();
  if (!row) return null;
  // تعدد الأدوار: مضمومة في نفس استعلام admins فوق (join) بدل نداء منفصل —
  // أسرع (رحلة شبكة واحدة بدل اتنين) لكل استدعاء للدالة دي
  const extra = (row as unknown as { admin_extra_roles?: { role: string }[] }).admin_extra_roles;
  return { ...row, extra_roles: (extra ?? []).map((r: { role: string }) => r.role) };
}

function isSuperAdmin(caller: { role: string; extra_roles?: string[] }): boolean {
  return caller.role === "super_admin" || (caller.extra_roles ?? []).includes("super_admin");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const caller = await getCallerAdmin(req);
  if (!caller) return json({ error: "غير مصرح — سجّل دخولك تاني" }, 401);
  const allowed = caller.has_archive_review_access || isSuperAdmin(caller);
  if (!allowed) return json({ error: "مفيش صلاحية مراجعة أرشيف المرضى — دي صلاحية منفصلة عن صلاحية الرفع" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "بيانات غير صالحة" }, 400);
  }

  const fileId = (body.file_id ?? "").toString().trim();
  const decision = (body.decision ?? "").toString().trim(); // "approve" | "reject"
  const notes = body.notes ? body.notes.toString().trim() : null;

  if (!fileId) return json({ error: "file_id مطلوب" }, 400);
  if (decision !== "approve" && decision !== "reject") {
    return json({ error: "decision لازم يكون approve أو reject" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: file, error: fErr } = await admin
    .from("patient_files")
    .select("id, patient_id, review_status")
    .eq("id", fileId)
    .maybeSingle();
  if (fErr || !file) return json({ error: "الملف غير موجود" }, 404);
  if (file.review_status !== "pending") {
    return json({ error: "الملف ده اتراجع قبل كده (الحالة الحالية: " + file.review_status + ")" }, 409);
  }

  const newStatus = decision === "approve" ? "approved" : "rejected";
  const { data: updated, error: updateErr } = await admin
    .from("patient_files")
    .update({
      review_status: newStatus,
      reviewed_by: caller.id,
      reviewed_at: new Date().toISOString(),
      review_notes: notes,
    })
    .eq("id", fileId)
    .select("id, review_status, reviewed_by, reviewed_at, review_notes")
    .single();
  if (updateErr) return json({ error: updateErr.message }, 500);

  await admin.from("archive_access_log").insert({
    file_id: fileId,
    patient_id: file.patient_id,
    employee_id: caller.id,
    action: decision === "approve" ? "review_approve" : "review_reject",
  });

  return json({ file: updated });
});
