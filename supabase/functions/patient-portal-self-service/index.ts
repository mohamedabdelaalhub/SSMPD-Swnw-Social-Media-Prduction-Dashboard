import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type User } from "npm:@supabase/supabase-js@2";

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
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return null;
  return { user, userClient };
}

async function ensurePatientAccount(admin: ReturnType<typeof createClient>, user: User) {
  const { data: staffRow } = await admin
    .from("admins")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (staffRow) {
    throw new Error("STAFF_ACCOUNT_NOT_ALLOWED");
  }

  const { data: existing, error: readError } = await admin
    .from("patient_accounts")
    .select("*")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (readError) throw readError;
  if (existing) {
    if (existing.status !== "active") throw new Error("PATIENT_ACCOUNT_DISABLED");
    const verified = Boolean(user.phone && (user as any).phone_confirmed_at);
    if (verified && !existing.phone_verified) {
      const { data: updated, error } = await admin
        .from("patient_accounts")
        .update({ phone_verified: true, updated_at: new Date().toISOString(), last_login_at: new Date().toISOString() })
        .eq("id", existing.id)
        .select("*")
        .single();
      if (error) throw error;
      return updated;
    }
    await admin.from("patient_accounts").update({ last_login_at: new Date().toISOString() }).eq("id", existing.id);
    return existing;
  }

  const { data: created, error } = await admin
    .from("patient_accounts")
    .insert({
      auth_user_id: user.id,
      status: "active",
      phone_verified: Boolean(user.phone && (user as any).phone_confirmed_at),
      last_login_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) throw error;
  return created;
}

function normalizeVerificationInput(body: any) {
  const verificationType = String(body.verification_type || "").trim();
  const allowedTypes = ["self_identity", "guardian_relationship", "authorized_representative"];
  if (!allowedTypes.includes(verificationType)) throw new Error("INVALID_VERIFICATION_TYPE");

  let relationship = String(body.relationship || "").trim() || null;
  if (verificationType === "self_identity") relationship = "self";

  const allowedRelationships = ["self", "father", "mother", "legal_guardian", "spouse", "other"];
  if (!relationship || !allowedRelationships.includes(relationship)) throw new Error("INVALID_RELATIONSHIP");
  if (verificationType === "guardian_relationship" && !["father", "mother", "legal_guardian"].includes(relationship)) {
    throw new Error("INVALID_GUARDIAN_RELATIONSHIP");
  }
  if (verificationType === "authorized_representative" && relationship === "self") {
    throw new Error("INVALID_AUTHORIZED_RELATIONSHIP");
  }
  return { verificationType, relationship };
}

async function statusPayload(admin: ReturnType<typeof createClient>, account: any) {
  const [{ data: accessRows, error: accessError }, { data: verifications, error: verificationError }] = await Promise.all([
    admin.from("patient_account_access")
      .select("id, patient_id, access_type, relationship, verification_status, is_primary, verified_at, expires_at, revoked_at, rejection_reason")
      .eq("account_id", account.id)
      .order("created_at", { ascending: false }),
    admin.from("patient_identity_verifications")
      .select("id, requested_patient_id, verification_type, requested_relationship, status, submitted_at, reviewed_at, rejection_reason, expires_at")
      .eq("account_id", account.id)
      .order("submitted_at", { ascending: false }),
  ]);
  if (accessError) throw accessError;
  if (verificationError) throw verificationError;

  const patientIds = Array.from(new Set([
    ...(accessRows || []).map((r: any) => r.patient_id),
    ...(verifications || []).map((r: any) => r.requested_patient_id).filter(Boolean),
  ]));
  let patientsById: Record<string, any> = {};
  if (patientIds.length) {
    const { data: patientRows, error } = await admin
      .from("patients")
      .select("id, patient_code, full_name")
      .in("id", patientIds);
    if (error) throw error;
    patientsById = Object.fromEntries((patientRows || []).map((p: any) => [p.id, p]));
  }

  const now = Date.now();
  const access = (accessRows || []).map((r: any) => ({
    ...r,
    effective: r.verification_status === "approved" && (!r.expires_at || new Date(r.expires_at).getTime() > now),
    patient: r.verification_status === "approved" ? patientsById[r.patient_id] || null : null,
  }));
  const verificationList = (verifications || []).map((r: any) => ({
    ...r,
    patient_code: r.requested_patient_id && patientsById[r.requested_patient_id]
      ? patientsById[r.requested_patient_id].patient_code
      : null,
  }));
  return { account, access, verifications: verificationList };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = await getAuthenticatedUser(req);
  if (!auth) return json({ error: "UNAUTHORIZED" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "INVALID_JSON" }, 400); }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  let account: any;
  try {
    account = await ensurePatientAccount(admin, auth.user);
  } catch (e) {
    const msg = String((e as Error).message || e);
    if (msg === "STAFF_ACCOUNT_NOT_ALLOWED") return json({ error: msg }, 403);
    if (msg === "PATIENT_ACCOUNT_DISABLED") return json({ error: msg }, 403);
    return json({ error: msg }, 500);
  }

  const op = String(body.op || "status");
  if (op === "ensure_account" || op === "status") {
    try { return json(await statusPayload(admin, account)); }
    catch (e) { return json({ error: String((e as Error).message || e) }, 500); }
  }

  if (op === "submit_verification") {
    if (!account.phone_verified) return json({ error: "PHONE_NOT_VERIFIED" }, 403);
    const patientCode = String(body.patient_code || "").trim().toUpperCase();
    if (!patientCode) return json({ error: "PATIENT_CODE_REQUIRED" }, 400);

    let normalized: { verificationType: string; relationship: string | null };
    try { normalized = normalizeVerificationInput(body); }
    catch (e) { return json({ error: String((e as Error).message || e) }, 400); }

    const { data: patient, error: patientError } = await admin
      .from("patients")
      .select("id, patient_code")
      .eq("patient_code", patientCode)
      .maybeSingle();
    if (patientError) return json({ error: patientError.message }, 500);
    if (!patient) return json({ error: "PATIENT_NOT_FOUND" }, 404);

    const { data: verification, error } = await admin
      .from("patient_identity_verifications")
      .insert({
        account_id: account.id,
        requested_patient_id: patient.id,
        verification_type: normalized.verificationType,
        requested_relationship: normalized.relationship,
        status: "pending",
      })
      .select("id, requested_patient_id, verification_type, requested_relationship, status, submitted_at")
      .single();

    if (error) {
      if ((error as any).code === "23505") return json({ error: "PENDING_REQUEST_EXISTS" }, 409);
      return json({ error: error.message }, 500);
    }
    return json({ verification, patient_code: patient.patient_code }, 201);
  }

  return json({ error: "UNKNOWN_OPERATION" }, 400);
});
