import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const BUCKET = "patient-verification-documents";

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

async function caller(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user) return null;
  const { data: allowed, error: permissionError } = await userClient.rpc("can_manage_patient_identity_verification");
  if (permissionError || !allowed) return null;
  return { user, userClient };
}

async function listItems(admin: ReturnType<typeof createClient>, status: string) {
  let q = admin.from("patient_identity_verifications")
    .select("id, account_id, requested_patient_id, verification_type, requested_relationship, status, submitted_at, reviewed_at, rejection_reason, expires_at")
    .order("submitted_at", { ascending: false })
    .limit(100);
  if (status && status !== "all") q = q.eq("status", status);
  const { data: rows, error } = await q;
  if (error) throw error;
  const verifications = rows || [];
  const accountIds = Array.from(new Set(verifications.map((r: any) => r.account_id)));
  const patientIds = Array.from(new Set(verifications.map((r: any) => r.requested_patient_id).filter(Boolean)));
  const verificationIds = verifications.map((r: any) => r.id);

  const [{ data: accounts }, { data: patients }, { data: docs }, { data: access }] = await Promise.all([
    accountIds.length ? admin.from("patient_accounts").select("id, auth_user_id, status, phone_verified").in("id", accountIds) : Promise.resolve({ data: [] } as any),
    patientIds.length ? admin.from("patients").select("id, patient_code, full_name, phone").in("id", patientIds) : Promise.resolve({ data: [] } as any),
    verificationIds.length ? admin.from("patient_verification_documents").select("id, verification_id, document_type, created_at").in("verification_id", verificationIds) : Promise.resolve({ data: [] } as any),
    verificationIds.length ? admin.from("patient_account_access").select("id, verification_id, account_id, patient_id, verification_status, access_type, relationship, verified_at, expires_at, revoked_at").in("verification_id", verificationIds) : Promise.resolve({ data: [] } as any),
  ]);

  const accountMap = Object.fromEntries((accounts || []).map((r: any) => [r.id, r]));
  const patientMap = Object.fromEntries((patients || []).map((r: any) => [r.id, r]));
  const docsByVerification: Record<string, any[]> = {};
  for (const d of docs || []) (docsByVerification[d.verification_id] ||= []).push(d);
  const accessByVerification = Object.fromEntries((access || []).map((r: any) => [r.verification_id, r]));

  const authUserIds = Array.from(new Set((accounts || []).map((a: any) => a.auth_user_id).filter(Boolean)));
  const identityMap: Record<string, any> = {};
  await Promise.all(authUserIds.map(async (uid: string) => {
    const { data } = await admin.auth.admin.getUserById(uid);
    if (data?.user) identityMap[uid] = { phone: data.user.phone || null, email: data.user.email || null };
  }));

  return verifications.map((v: any) => {
    const acc = accountMap[v.account_id] || null;
    return {
      ...v,
      account: acc ? { id: acc.id, status: acc.status, phone_verified: acc.phone_verified, identity: identityMap[acc.auth_user_id] || null } : null,
      patient: v.requested_patient_id ? patientMap[v.requested_patient_id] || null : null,
      documents: docsByVerification[v.id] || [],
      access: accessByVerification[v.id] || null,
    };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const auth = await caller(req);
  if (!auth) return json({ error: "FORBIDDEN" }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: "INVALID_JSON" }, 400); }
  const op = String(body.op || "list");
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  if (op === "list") {
    try { return json({ items: await listItems(admin, String(body.status || "pending")) }); }
    catch (e) { return json({ error: String((e as Error).message || e) }, 500); }
  }

  if (op === "approve") {
    const id = String(body.verification_id || "");
    if (!id) return json({ error: "verification_id required" }, 400);
    const { data, error } = await auth.userClient.rpc("approve_patient_identity_verification", { p_verification_id: id });
    if (error) return json({ error: error.message }, 400);
    return json({ access: data });
  }

  if (op === "reject") {
    const id = String(body.verification_id || "");
    if (!id) return json({ error: "verification_id required" }, 400);
    const { data, error } = await auth.userClient.rpc("reject_patient_identity_verification", {
      p_verification_id: id,
      p_reason: body.reason ? String(body.reason).slice(0, 500) : null,
    });
    if (error) return json({ error: error.message }, 400);
    return json({ verification: data });
  }

  if (op === "revoke") {
    const id = String(body.access_id || "");
    if (!id) return json({ error: "access_id required" }, 400);
    const { data, error } = await auth.userClient.rpc("revoke_patient_account_access", {
      p_access_id: id,
      p_reason: body.reason ? String(body.reason).slice(0, 500) : null,
      p_new_status: "revoked",
    });
    if (error) return json({ error: error.message }, 400);
    return json({ access: data });
  }

  if (op === "document_url") {
    const documentId = String(body.document_id || "");
    if (!documentId) return json({ error: "document_id required" }, 400);
    const { data: doc, error: docError } = await admin
      .from("patient_verification_documents")
      .select("id, storage_ref")
      .eq("id", documentId)
      .maybeSingle();
    if (docError || !doc) return json({ error: "DOCUMENT_NOT_FOUND" }, 404);

    const { error: logError } = await auth.userClient.rpc("log_verification_document_access", {
      p_document_id: documentId,
      p_action: "viewed",
    });
    if (logError) return json({ error: logError.message }, 403);

    const { data: signed, error: signedError } = await admin.storage.from(BUCKET).createSignedUrl(doc.storage_ref, 120);
    if (signedError || !signed?.signedUrl) return json({ error: signedError?.message || "SIGNED_URL_FAILED" }, 500);
    return json({ url: signed.signedUrl, expires_in: 120 });
  }

  return json({ error: "UNKNOWN_OPERATION" }, 400);
});
