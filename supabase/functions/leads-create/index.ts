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

// "booked"/"booked_on_system" بقوا حالات "لسه شغالة" بعد إضافة خطوة الاستقبال —
// الإقفال الفعلي بقى بس عند "تم إجراء الخدمة" أو أي حالة رفض/عدم رد
const CLOSED_STATUSES = ["service_done", "rejected", "no_response", "invalid_number"];

// تطبيع رقم التليفون — نفس منطق موديول الأرشيف بالضبط عشان المطابقة تشتغل بين الجدولين
function normalizePhone(raw: string): string {
  if (!raw) return "";
  let s = raw.replace(/[‎‏‪-‮\s\-()]/g, "");
  s = s.replace(/^00/, "+");
  if (/^01[0125]\d{8}$/.test(s)) s = "+2" + s;
  else if (/^1[0125]\d{8}$/.test(s)) s = "+20" + s;
  else if (!s.startsWith("+")) s = "+" + s.replace(/^0+/, "");
  return s;
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
  // تعدد الأدوار: مضمومة في نفس استعلام admins فوق (join) بدل نداء منفصل —
  // أسرع (رحلة شبكة واحدة بدل اتنين) لكل استدعاء للدالة دي
  const extra = (row as unknown as { admin_extra_roles?: { role: string }[] }).admin_extra_roles;
  return { ...row, extra_roles: (extra ?? []).map((r: { role: string }) => r.role) };
}

// true لو الرول الأساسي أو أي من الأدوار الإضافية موجود في القائمة
function roleIn(caller: { role: string; extra_roles?: string[] }, roles: string[]): boolean {
  return roles.includes(caller.role) || (caller.extra_roles ?? []).some((r) => roles.includes(r));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const caller = await getCallerAdmin(req);
  if (!caller) return json({ error: "غير مصرح — سجّل دخولك تاني" }, 401);
  const allowed = roleIn(caller, ["reception", "customer_service", "general_manager", "super_admin"]);
  if (!allowed) return json({ error: "مفيش صلاحية موديول الليدز" }, 403);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "بيانات غير صالحة" }, 400);
  }

  const customerName = (body.customer_name ?? "").toString().trim();
  const phoneRaw = (body.phone ?? "").toString().trim();
  const source = (body.source ?? "").toString().trim();
  const messageText = (body.message_text ?? "").toString().trim() || null;
  const attachmentUrl = (body.attachment_url ?? "").toString().trim() || null;
  const interestedService = (body.interested_service ?? "").toString().trim() || null;
  const requestedDepartment = (body.requested_department ?? "").toString().trim() || null;
  const acquisitionTypeRaw = (body.acquisition_type ?? "").toString().trim().toLowerCase();
  const acquisitionType = ["organic", "ad"].includes(acquisitionTypeRaw) ? acquisitionTypeRaw : null;
  const confirmDuplicate = body.confirm_duplicate === true;
  const linkToLeadId = body.link_to_lead_id?.toString();

  if (!customerName) return json({ error: "اسم العميل مطلوب" }, 400);
  if (!phoneRaw) return json({ error: "رقم التليفون مطلوب" }, 400);
  if (!["whatsapp", "messenger", "phone", "clinic"].includes(source)) {
    return json({ error: "source لازم يكون whatsapp أو messenger أو phone أو clinic" }, 400);
  }

  const phoneNormalized = normalizePhone(phoneRaw);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // 1) لو الموظف طلب ربط الرسالة الجديدة بليد موجود، سجّلها كمحاولة/رسالة إضافية بدل إنشاء ليد جديد
  if (linkToLeadId) {
    const { data: existing, error: exErr } = await admin
      .from("leads")
      .select("id")
      .eq("id", linkToLeadId)
      .maybeSingle();
    if (exErr || !existing) return json({ error: "الليد المطلوب الربط بيه غير موجود" }, 404);

    await admin.from("lead_attempts").insert({
      lead_id: linkToLeadId,
      employee_id: caller.id,
      result: "other",
      notes: `رسالة جديدة مرتبطة: ${messageText ?? "(بدون نص)"}`,
    });

    return json({ linked_to: linkToLeadId });
  }

  // 2) كشف التكرار: ليد مفتوح بنفس الرقم بعد التطبيع
  if (!confirmDuplicate) {
    const { data: dup } = await admin
      .from("leads")
      .select("id, customer_name, current_status, created_at")
      .eq("phone_normalized", phoneNormalized)
      .not("current_status", "in", `(${CLOSED_STATUSES.join(",")})`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (dup) {
      return json({
        duplicate: dup,
        message: "فيه ليد مفتوح بالفعل بنفس الرقم — أعد الإرسال مع confirm_duplicate:true للإنشاء رغم ذلك، أو link_to_lead_id للربط به",
      }, 409);
    }
  }

  // 3) مطابقة تلقائية مع جدول المرضى (جديد/قديم)
  const { data: matchedPatient } = await admin
    .from("patients")
    .select("id")
    .eq("phone_normalized", phoneNormalized)
    .maybeSingle();
  const patientType = matchedPatient ? "existing" : "new";

  // 4) توزيع تلقائي: موظف customer_service الأقل عدد ليدز مفتوحة حالياً — بيشمل
  // برضه أي موظف عنده customer_service كرول إضافي (مش بس أساسي)، من غير تكرار
  const [{ data: csPrimary }, { data: csExtra }] = await Promise.all([
    admin.from("admins").select("id").eq("role", "customer_service").eq("active", true),
    admin.from("admin_extra_roles").select("admin_id, admins!inner(active)").eq("role", "customer_service").eq("admins.active", true),
  ]);
  const csIds = new Set<string>();
  (csPrimary ?? []).forEach((a: { id: string }) => csIds.add(a.id));
  (csExtra ?? []).forEach((r: { admin_id: string }) => csIds.add(r.admin_id));
  const csAdmins = Array.from(csIds).map((id) => ({ id }));

  let assignedTo: string | null = null;
  if (csAdmins && csAdmins.length > 0) {
    const counts = await Promise.all(
      csAdmins.map(async (a) => {
        const { count } = await admin
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("assigned_to", a.id)
          .not("current_status", "in", `(${CLOSED_STATUSES.join(",")})`);
        return { id: a.id, count: count ?? 0 };
      }),
    );
    counts.sort((a, b) => a.count - b.count);
    assignedTo = counts[0].id;
  }

  const { data: lead, error } = await admin
    .from("leads")
    .insert({
      customer_name: customerName,
      phone_raw: phoneRaw,
      phone_normalized: phoneNormalized,
      source,
      message_text: messageText,
      attachment_url: attachmentUrl,
      received_by: caller.id,
      interested_service: interestedService,
      requested_department: requestedDepartment,
      acquisition_type: acquisitionType,
      patient_id: matchedPatient?.id ?? null,
      patient_type: patientType,
      assigned_to: assignedTo,
    })
    .select("id, customer_name, phone_normalized, current_status, patient_type, assigned_to, created_at")
    .single();

  if (error) return json({ error: error.message }, 500);

  return json({ lead });
});
