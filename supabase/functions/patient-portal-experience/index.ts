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

const ENCOUNTER_TYPES = new Set([
  "checkup",
  "follow_up",
  "emergency",
  "session",
  "lab",
  "radiology",
  "home_visit",
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store, max-age=0",
    },
  });
}

async function authenticatedUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) return null;
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null;
  return user;
}

function isEffectiveAccess(row: any) {
  if (!row || row.verification_status !== "approved" || row.revoked_at) return false;
  return !row.expires_at || new Date(row.expires_at).getTime() > Date.now();
}

async function portalContext(req: Request, admin: ReturnType<typeof createClient>) {
  const user = await authenticatedUser(req);
  if (!user) return { error: "UNAUTHORIZED", status: 401 } as const;

  const { data: account, error } = await admin
    .from("patient_accounts")
    .select("id, status, activation_completed_at")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (error) return { error: error.message, status: 500 } as const;
  if (!account || account.status !== "active" || !account.activation_completed_at) {
    return { error: "PATIENT_ACCOUNT_NOT_ACTIVATED", status: 403 } as const;
  }

  const { data: accessRows, error: accessError } = await admin
    .from("patient_account_access")
    .select("patient_id, verification_status, expires_at, revoked_at")
    .eq("account_id", account.id)
    .eq("verification_status", "approved");

  if (accessError) return { error: accessError.message, status: 500 } as const;

  const patientIds = Array.from(new Set(
    (accessRows || []).filter(isEffectiveAccess).map((r: any) => r.patient_id).filter(Boolean),
  ));

  return { user, account, patientIds } as const;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const ctx: any = await portalContext(req, admin);
  if (!ctx.account) return json({ error: ctx.error }, ctx.status || 500);

  const op = String(body.op || "status");

  if (op === "status") {
    if (!ctx.patientIds.length) return json({ rated_visit_ids: [] });

    const { data, error } = await admin
      .from("patient_experience_ratings")
      .select("patient_visit_id")
      .in("patient_id", ctx.patientIds)
      .not("patient_visit_id", "is", null);

    if (error) return json({ error: error.message }, 500);
    return json({
      rated_visit_ids: Array.from(new Set((data || []).map((r: any) => r.patient_visit_id).filter(Boolean))),
    });
  }

  if (op !== "submit") return json({ error: "UNKNOWN_OPERATION" }, 400);

  const visitId = String(body.visit_id || "").trim();
  const ratings = body.ratings;
  const comment = String(body.comment || "").trim().slice(0, 1000);

  if (!visitId) return json({ error: "VISIT_ID_REQUIRED" }, 400);
  if (!Array.isArray(ratings) || ratings.length !== 6 || !ratings.every((n: any) => Number.isInteger(n) && n >= 1 && n <= 5)) {
    return json({ error: "INVALID_RATINGS" }, 400);
  }

  const { data: visit, error: visitError } = await admin
    .from("patient_visits")
    .select("id, patient_id, visit_date, encounter_type")
    .eq("id", visitId)
    .maybeSingle();

  if (visitError) return json({ error: visitError.message }, 500);
  if (!visit) return json({ error: "VISIT_NOT_FOUND" }, 404);
  if (!ctx.patientIds.includes(visit.patient_id)) return json({ error: "NO_APPROVED_MEDICAL_ACCESS" }, 403);

  const encounterType = ENCOUNTER_TYPES.has(String(visit.encounter_type || ""))
    ? String(visit.encounter_type)
    : "checkup";

  const { data: existing, error: existingError } = await admin
    .from("patient_experience_ratings")
    .select("id")
    .eq("patient_visit_id", visit.id)
    .maybeSingle();
  if (existingError) return json({ error: existingError.message }, 500);
  if (existing) return json({ error: "ALREADY_RATED", rating_id: existing.id }, 409);

  const { data: rating, error: insertError } = await admin
    .from("patient_experience_ratings")
    .insert({
      patient_id: visit.patient_id,
      visit_date: visit.visit_date,
      ratings,
      comment,
      created_by: null,
      patient_visit_id: visit.id,
      portal_account_id: ctx.account.id,
      encounter_type: encounterType,
      source: "patient_portal",
    })
    .select("id, patient_visit_id, created_at")
    .single();

  if (insertError) {
    if ((insertError as any).code === "23505") return json({ error: "ALREADY_RATED" }, 409);
    return json({ error: insertError.message }, 500);
  }

  const { error: auditError } = await admin.from("patient_portal_audit_log").insert({
    account_id: ctx.account.id,
    patient_id: visit.patient_id,
    action: "experience_rating_submitted",
    entity_type: "patient_experience_ratings",
    entity_id: rating.id,
    metadata: {
      patient_visit_id: visit.id,
      encounter_type: encounterType,
    },
  });
  if (auditError) console.error("experience audit failed", auditError.message);

  return json({ ok: true, rating });
});
