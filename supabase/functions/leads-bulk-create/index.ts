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

// "booked"/"booked_on_system" بقوا حالات "لسه شغالة" بعد إضافة خطوة الاستقبال
const CLOSED_STATUSES = ["service_done", "rejected", "no_response", "invalid_number"];
const MAX_ROWS = 500;

// نفس منطق تطبيع الهاتف بالظبط زي leads-create/patients-create
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

function roleIn(caller: { role: string; extra_roles?: string[] }, roles: string[]): boolean {
  return roles.includes(caller.role) || (caller.extra_roles ?? []).some((r) => roles.includes(r));
}

// موديول الرفع الجماعي: بياخد مصفوفة صفوف (الفرونت إند بيقرأ ملف الإكسيل بمكتبة
// SheetJS في المتصفح ويحوّله لـ JSON عادي، الدالة دي بس بتستقبل الناتج وتعالجه
// صف صف — بدون معالجة تكرار تفاعلية زي leads-create (مفيش مستخدم يرد على كل صف)،
// أي رقم مكرر (مع ليد مفتوح موجود بالفعل أو مكرر جوه نفس الملف) بيتسجل في skipped
// ويُتخطى، مش بيوقف باقي الاستيراد
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

  const rows = Array.isArray(body.leads) ? body.leads : null;
  if (!rows) return json({ error: "leads لازم تكون مصفوفة صفوف" }, 400);
  if (rows.length === 0) return json({ error: "الملف فاضي" }, 400);
  if (rows.length > MAX_ROWS) return json({ error: `أقصى عدد صفوف دفعة واحدة ${MAX_ROWS}` }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: csAdmins } = await admin
    .from("admins")
    .select("id")
    .eq("role", "customer_service")
    .eq("active", true);

  const created: unknown[] = [];
  const missingData: unknown[] = [];
  const skipped: { row: number; reason: string; data: unknown }[] = [];
  const seenInBatch = new Set<string>();

  // نفس منطق "أقل موظف خدمة عملاء عنده ليدز مفتوحة" — بيتنادى لكل صف عادي أو
  // ناقص بيانات على حد سواء، عشان الصف الناقص برضه يتسند لموظف يقدر يشوفه/يكمله
  // (سياسة RLS بتاعة تحديث leads مقصورة على assigned_to = المستخدم نفسه)
  async function pickAssignee(): Promise<string | null> {
    if (!csAdmins || csAdmins.length === 0) return null;
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
    return counts[0].id;
  }

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] ?? {};
    const customerName = (r.customer_name ?? r["اسم العميل"] ?? "").toString().trim();
    const phoneRaw = (r.phone ?? r["رقم الهاتف"] ?? "").toString().trim();
    const source = (r.source ?? r["المصدر"] ?? "whatsapp").toString().trim().toLowerCase();
    const messageText = (r.message_text ?? r["نص الرسالة"] ?? "").toString().trim() || null;
    const interestedService = (r.interested_service ?? r["الخدمة"] ?? "").toString().trim() || null;
    const acquisitionTypeRaw = (r.acquisition_type ?? r["مصدر الاهتمام"] ?? "").toString().trim().toLowerCase();
    const acquisitionType = ["organic", "ad"].includes(acquisitionTypeRaw) ? acquisitionTypeRaw : null;
    const sourceValid = ["whatsapp", "messenger"].includes(source) ? source : "whatsapp";

    // اسم أو تليفون ناقص (مش الاتنين مع بعض) — بيتحفظ في قائمة "عملاء ناقصين
    // بيانات" بدل ما يتجاهل، عشان الموظف يكلم العميل ويكمل الناقص. لو الاتنين
    // ناقصين مفيش أي حاجة تحدد العميل بيها، فبيتخطى زي الأول بالظبط.
    if (!customerName && !phoneRaw) {
      skipped.push({ row: i + 1, reason: "اسم العميل ورقم الهاتف ناقصين مع بعض", data: r });
      continue;
    }

    const phoneNormalized = phoneRaw ? normalizePhone(phoneRaw) : null;
    if (phoneNormalized) {
      if (seenInBatch.has(phoneNormalized)) {
        skipped.push({ row: i + 1, reason: "رقم مكرر جوه نفس الملف", data: r });
        continue;
      }
      const { data: dup } = await admin
        .from("leads")
        .select("id")
        .eq("phone_normalized", phoneNormalized)
        .not("current_status", "in", `(${CLOSED_STATUSES.join(",")})`)
        .limit(1)
        .maybeSingle();
      if (dup) {
        skipped.push({ row: i + 1, reason: "فيه ليد مفتوح بالفعل بنفس الرقم", data: r });
        continue;
      }
      seenInBatch.add(phoneNormalized);
    }

    if (!customerName || !phoneNormalized) {
      const assignedTo = await pickAssignee();
      const { data: lead, error } = await admin
        .from("leads")
        .insert({
          customer_name: customerName || "بدون اسم",
          phone_raw: phoneRaw || null,
          phone_normalized: phoneNormalized,
          source: sourceValid,
          message_text: messageText,
          received_by: caller.id,
          interested_service: interestedService,
          acquisition_type: acquisitionType,
          assigned_to: assignedTo,
          current_status: "missing_data",
        })
        .select("id, customer_name, phone_normalized")
        .single();
      if (error) {
        skipped.push({ row: i + 1, reason: error.message, data: r });
        continue;
      }
      missingData.push(lead);
      continue;
    }

    const { data: matchedPatient } = await admin
      .from("patients")
      .select("id")
      .eq("phone_normalized", phoneNormalized)
      .maybeSingle();

    const assignedTo = await pickAssignee();

    const { data: lead, error } = await admin
      .from("leads")
      .insert({
        customer_name: customerName,
        phone_raw: phoneRaw,
        phone_normalized: phoneNormalized,
        source: sourceValid,
        message_text: messageText,
        received_by: caller.id,
        interested_service: interestedService,
        acquisition_type: acquisitionType,
        patient_id: matchedPatient?.id ?? null,
        patient_type: matchedPatient ? "existing" : "new",
        assigned_to: assignedTo,
      })
      .select("id, customer_name, phone_normalized")
      .single();

    if (error) {
      skipped.push({ row: i + 1, reason: error.message, data: r });
      continue;
    }
    created.push(lead);
  }

  return json({
    created_count: created.length,
    missing_data_count: missingData.length,
    skipped_count: skipped.length,
    created,
    missing_data: missingData,
    skipped,
  });
});
