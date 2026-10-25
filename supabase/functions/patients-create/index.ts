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
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

function normalizePhone(raw: string): string {
  if (!raw) return "";
  let s = raw.replace(/[\u200E\u200F\u202A-\u202E\s\-()]/g, "");
  s = s.replace(/^00/, "+");
  if (/^01[0125]\d{8}$/.test(s)) s = "+2" + s;
  else if (/^1[0125]\d{8}$/.test(s)) s = "+20" + s;
  else if (!s.startsWith("+")) s = "+" + s.replace(/^0+/, "");
  return s;
}

async function hashNationalId(id: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(id + PEPPER);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getCallerAdmin(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return null;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: row } = await admin.from("admins").select("id, role, has_archive_access, active, admin_extra_roles!admin_id(role)").eq("user_id", user.id).eq("active", true).maybeSingle();
  if (!row) return null;
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
  const allowed = caller.has_archive_access || isSuperAdmin(caller);
  if (!allowed) return json({ error: "مفيش صلاحية أرشيف المرضى" }, 403);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "بيانات غير صالحة" }, 400); }

  const fullName = (body.full_name ?? "").toString().trim();
  const phoneRaw = (body.phone ?? "").toString().trim();
  const email = (body.email ?? "").toString().trim().toLowerCase() || null;
  const nationalId = (body.national_id ?? "").toString().trim();
  const genderRaw = (body.gender ?? "").toString().trim();
  const gender = genderRaw === "male" || genderRaw === "female" ? genderRaw : null;
  const ageRaw = body.age;
  const age = ageRaw === undefined || ageRaw === null || ageRaw === "" ? null : Number(ageRaw);
  const medicalRecordNo = (body.medical_record_no ?? "").toString().trim() || null;
  const contractId = (body.contract_id ?? "").toString().trim() || null;
  const insurancePlanId = (body.insurance_plan_id ?? "").toString().trim() || null;
  const memberReference = (body.member_reference ?? "").toString().trim() || null;

  if (fullName.split(/\s+/).filter(Boolean).length < 2) return json({ error: "اسم المريض مطلوب من كلمتين على الأقل" }, 400);
  if (!phoneRaw || normalizePhone(phoneRaw).replace(/[^0-9]/g, "").length < 8) return json({ error: "رقم تليفون المريض مطلوب ويجب أن يكون صحيحًا" }, 400);
  if (age === null || !Number.isInteger(age) || age < 0 || age > 130) return json({ error: "سن المريض مطلوب من صفر إلى130 سنة" }, 400);
  if (insurancePlanId && !contractId) return json({ error: "اختيار فئة الكارنيه يحتاج شركة/عقد تأمين" }, 400);

  const phoneNormalized = phoneRaw ? normalizePhone(phoneRaw) : null;
  const nationalIdHash = nationalId ? await hashNationalId(nationalId) : null;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: patient, error } = await admin.from("patients").insert({
    full_name: fullName,
    phone: phoneRaw || null,
    phone_normalized: phoneNormalized,
    email,
    national_id_hash: nationalIdHash,
    gender,
    age: age !== null && !Number.isNaN(age) ? age : null,
    medical_record_no: medicalRecordNo,
    last_visit_date: new Date().toISOString().slice(0, 10),
    created_by: caller.id,
  }).select("id, patient_code, full_name, phone, email, status, gender, age, medical_record_no, last_visit_date, created_at").single();

  if (error) return json({ error: error.message }, 500);

  if (contractId) {
    const { data: contract, error: contractError } = await admin.from("contracting_entity_contracts").select("id, entity_id, status, start_date, end_date").eq("id", contractId).maybeSingle();
    const nowDate = new Date().toISOString().slice(0, 10);
    if (contractError || !contract || contract.status !== "active" || contract.start_date > nowDate || (contract.end_date && contract.end_date < nowDate)) {
      await admin.from("patients").delete().eq("id", patient.id);
      return json({ error: "عقد جهة التعاقد غير نشط أو غير صالح اليوم" }, 400);
    }

    if (insurancePlanId) {
      const { data: plan, error: planError } = await admin.from("insurance_plans").select("id, contract_id, active, valid_from, valid_to").eq("id", insurancePlanId).maybeSingle();
      if (planError || !plan || plan.contract_id !== contractId || !plan.active || plan.valid_from > nowDate || (plan.valid_to && plan.valid_to < nowDate)) {
        await admin.from("patients").delete().eq("id", patient.id);
        return json({ error: "فئة الكارنيه لا تخص العقد أو غير سارية" }, 400);
      }
    }

    const { error: linkError } = await admin.from("contract_patient_links").insert({
      contract_id: contractId,
      patient_id: patient.id,
      linked_from: nowDate,
      linked_by: caller.id,
      insurance_plan_id: insurancePlanId,
      member_reference: memberReference,
    });
    if (linkError) {
      await admin.from("patients").delete().eq("id", patient.id);
      return json({ error: "تعذر ربط المريض بجهة التعاقد: " + linkError.message }, 400);
    }
  }

  return json({ patient });
});
