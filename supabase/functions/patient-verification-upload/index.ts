import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "patient-verification-documents";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

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

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(-100) || "document";
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let form: FormData;
  try { form = await req.formData(); } catch { return json({ error: "INVALID_FORM_DATA" }, 400); }

  const verificationId = String(form.get("verification_id") || "").trim();
  const submissionToken = String(form.get("submission_token") || "").trim();
  const documentType = String(form.get("document_type") || "").trim().slice(0, 80);
  const fileValue = form.get("file");

  if (!verificationId || !submissionToken || !documentType || !(fileValue instanceof File)) {
    return json({ error: "verification_id, submission_token, document_type and file are required" }, 400);
  }
  if (!ALLOWED_TYPES.has(fileValue.type)) return json({ error: "UNSUPPORTED_FILE_TYPE" }, 400);
  if (fileValue.size <= 0 || fileValue.size > MAX_BYTES) return json({ error: "INVALID_FILE_SIZE" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: verification, error: verificationError } = await admin
    .from("patient_identity_verifications")
    .select("id, account_id, status, submission_token_hash, submission_token_expires_at")
    .eq("id", verificationId)
    .maybeSingle();

  if (verificationError) return json({ error: verificationError.message }, 500);
  if (!verification || verification.status !== "pending") return json({ error: "VERIFICATION_NOT_PENDING" }, 403);
  if (!verification.submission_token_hash || !verification.submission_token_expires_at) {
    return json({ error: "UPLOAD_TOKEN_INVALID" }, 403);
  }
  if (new Date(verification.submission_token_expires_at).getTime() <= Date.now()) {
    return json({ error: "UPLOAD_TOKEN_EXPIRED" }, 403);
  }

  const tokenHash = await sha256(submissionToken);
  if (tokenHash !== verification.submission_token_hash) return json({ error: "UPLOAD_TOKEN_INVALID" }, 403);

  const path = verificationId + "/" + crypto.randomUUID() + "-" + safeFileName(fileValue.name);
  const bytes = new Uint8Array(await fileValue.arrayBuffer());

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(path, bytes, { contentType: fileValue.type, upsert: false });
  if (uploadError) return json({ error: uploadError.message }, 500);

  const { data: document, error: insertError } = await admin
    .from("patient_verification_documents")
    .insert({
      verification_id: verificationId,
      storage_ref: path,
      document_type: documentType,
      uploaded_by: verification.account_id,
    })
    .select("id, verification_id, document_type, created_at")
    .single();

  if (insertError) {
    await admin.storage.from(BUCKET).remove([path]);
    return json({ error: insertError.message }, 500);
  }

  return json({ document }, 201);
});
