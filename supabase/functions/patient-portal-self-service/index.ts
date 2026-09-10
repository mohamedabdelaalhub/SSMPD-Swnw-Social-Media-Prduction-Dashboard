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
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

function normalizeEmail(v: unknown) {
  return String(v || "").trim().toLowerCase();
}

function validEmail(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  let s = "";
  for (const b of a) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomPassword() {
  return randomToken(48) + "!Aa7";
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

async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return null;
  return user;
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

  return {
    account: {
      id: account.id,
      status: account.status,
      login_email: account.login_email,
      email_verified: account.email_verified,
      activation_completed_at: account.activation_completed_at,
    },
    access,
    verifications: verificationList,
  };
}

async function createOrGetAccount(admin: ReturnType<typeof createClient>, email: string) {
  const { data: existing, error: readError } = await admin
    .from("patient_accounts")
    .select("id, auth_user_id, status, login_email, activation_completed_at")
    .eq("login_email", email)
    .maybeSingle();
  if (readError) throw readError;
  if (existing) {
    if (existing.status === "disabled") throw new Error("PATIENT_ACCOUNT_DISABLED");
    return existing;
  }

  const { data: staff } = await admin
    .from("admins")
    .select("id")
    .ilike("email", email)
    .maybeSingle();
  if (staff) throw new Error("STAFF_EMAIL_NOT_ALLOWED");

  const { data: createdAuth, error: createAuthError } = await admin.auth.admin.createUser({
    email,
    password: randomPassword(),
    email_confirm: false,
    user_metadata: { patient_portal: true },
  });
  if (createAuthError || !createdAuth.user) {
    const msg = String(createAuthError?.message || "AUTH_USER_CREATE_FAILED");
    if (/already|registered|exists/i.test(msg)) throw new Error("EMAIL_ALREADY_REGISTERED_CONTACT_CENTER");
    throw new Error(msg);
  }

  const { data: account, error: accountError } = await admin
    .from("patient_accounts")
    .insert({
      auth_user_id: createdAuth.user.id,
      status: "pending_activation",
      login_email: email,
      email_verified: false,
      phone_verified: false,
    })
    .select("id, auth_user_id, status, login_email, activation_completed_at")
    .single();

  if (accountError) {
    await admin.auth.admin.deleteUser(createdAuth.user.id);
    throw accountError;
  }
  return account;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "INVALID_JSON" }, 400); }

  const op = String(body.op || "status");
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  if (op === "submit_request") {
    const email = normalizeEmail(body.email);
    const patientCode = String(body.patient_code || "").trim().toUpperCase();
    if (!validEmail(email) || !patientCode) return json({ error: "DETAILS_NOT_MATCHED" }, 400);

    let normalized: { verificationType: string; relationship: string | null };
    try { normalized = normalizeVerificationInput(body); }
    catch (e) { return json({ error: String((e as Error).message || e) }, 400); }

    const { data: patient, error: patientError } = await admin
      .from("patients")
      .select("id, patient_code, email, status")
      .eq("patient_code", patientCode)
      .maybeSingle();
    if (patientError) return json({ error: patientError.message }, 500);

    const patientEmail = normalizeEmail(patient?.email);
    if (!patient || patient.status !== "active" || !patientEmail || patientEmail !== email) {
      return json({ error: "DETAILS_NOT_MATCHED" }, 400);
    }

    let account: any;
    try { account = await createOrGetAccount(admin, email); }
    catch (e) {
      const msg = String((e as Error).message || e);
      const status = msg === "STAFF_EMAIL_NOT_ALLOWED" ? 403 : 400;
      return json({ error: msg }, status);
    }

    const token = randomToken(32);
    const tokenHash = await sha256(token);
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    const { data: verification, error } = await admin
      .from("patient_identity_verifications")
      .insert({
        account_id: account.id,
        requested_patient_id: patient.id,
        requested_email: email,
        verification_type: normalized.verificationType,
        requested_relationship: normalized.relationship,
        status: "pending",
        submission_token_hash: tokenHash,
        submission_token_expires_at: expiresAt,
      })
      .select("id, requested_patient_id, verification_type, requested_relationship, status, submitted_at")
      .single();

    if (error) {
      if ((error as any).code === "23505") return json({ error: "PENDING_REQUEST_EXISTS" }, 409);
      return json({ error: error.message }, 500);
    }

    return json({
      verification: { ...verification, patient_code: patient.patient_code },
      upload_token: token,
      upload_token_expires_at: expiresAt,
    }, 201);
  }

  if (op === "activate") {
    const email = normalizeEmail(body.email);
    const code = String(body.code || "").replace(/\D/g, "");
    const newPassword = String(body.new_password || "");
    if (!validEmail(email) || code.length !== 8) return json({ error: "INVALID_ACTIVATION_CODE" }, 400);
    if (newPassword.length < 10) return json({ error: "PASSWORD_TOO_SHORT" }, 400);

    const { data: account, error: accountError } = await admin
      .from("patient_accounts")
      .select("id, auth_user_id, status, login_email, activation_completed_at")
      .eq("login_email", email)
      .maybeSingle();
    if (accountError) return json({ error: accountError.message }, 500);
    if (!account) return json({ error: "INVALID_ACTIVATION_CODE" }, 400);
    if (account.status === "disabled") return json({ error: "PATIENT_ACCOUNT_DISABLED" }, 403);
    if (account.activation_completed_at) return json({ error: "ALREADY_ACTIVATED" }, 409);

    const { data: codes, error: codesError } = await admin
      .from("patient_activation_codes")
      .select("id, code_hash, expires_at, attempts, max_attempts")
      .eq("account_id", account.id)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(5);
    if (codesError) return json({ error: codesError.message }, 500);

    const inputHash = await sha256(code);
    const matched = (codes || []).find((r: any) => r.code_hash === inputHash && r.attempts < r.max_attempts);
    if (!matched) {
      const newest = (codes || [])[0];
      if (newest) {
        await admin.from("patient_activation_codes")
          .update({ attempts: Number(newest.attempts || 0) + 1 })
          .eq("id", newest.id);
      }
      return json({ error: "INVALID_ACTIVATION_CODE" }, 400);
    }

    const { count: approvedCount, error: accessError } = await admin
      .from("patient_account_access")
      .select("id", { count: "exact", head: true })
      .eq("account_id", account.id)
      .eq("verification_status", "approved");
    if (accessError) return json({ error: accessError.message }, 500);
    if (!approvedCount) return json({ error: "NO_APPROVED_MEDICAL_ACCESS" }, 403);

    const { error: authUpdateError } = await admin.auth.admin.updateUserById(account.auth_user_id, {
      password: newPassword,
      email_confirm: true,
      user_metadata: { patient_portal: true },
    });
    if (authUpdateError) return json({ error: authUpdateError.message }, 500);

    const now = new Date().toISOString();
    const { error: updateError } = await admin
      .from("patient_accounts")
      .update({
        status: "active",
        email_verified: true,
        activation_completed_at: now,
        updated_at: now,
      })
      .eq("id", account.id);
    if (updateError) return json({ error: updateError.message }, 500);

    await admin.from("patient_activation_codes").update({ used_at: now }).eq("id", matched.id);
    await admin.from("patient_portal_audit_log").insert({
      account_id: account.id,
      action: "account_activated",
      entity_type: "patient_accounts",
      entity_id: account.id,
      metadata: { channel: "email_activation_code" },
    });

    return json({ ok: true });
  }

  if (op === "status") {
    const user = await getAuthenticatedUser(req);
    if (!user) return json({ error: "UNAUTHORIZED" }, 401);

    const { data: staff } = await admin.from("admins").select("id").eq("user_id", user.id).maybeSingle();
    if (staff) return json({ error: "STAFF_ACCOUNT_NOT_ALLOWED" }, 403);

    const { data: account, error } = await admin
      .from("patient_accounts")
      .select("*")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (error) return json({ error: error.message }, 500);
    if (!account) return json({ error: "PATIENT_ACCOUNT_NOT_FOUND" }, 404);
    if (account.status !== "active" || !account.activation_completed_at) {
      return json({ error: "PATIENT_ACCOUNT_NOT_ACTIVATED" }, 403);
    }

    await admin.from("patient_accounts")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", account.id);

    try { return json(await statusPayload(admin, account)); }
    catch (e) { return json({ error: String((e as Error).message || e) }, 500); }
  }

  return json({ error: "UNKNOWN_OPERATION" }, 400);
});
