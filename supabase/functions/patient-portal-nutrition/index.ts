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

// All database access uses service_role; authorization is enforced here, not by staff RLS.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "INVALID_JSON" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "INVALID_BODY" }, 400);
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const ctx: any = await portalContext(req, admin);
    if (!ctx.account) return json({ error: ctx.error }, ctx.status || 500);
    if (body.op === "overview") {
      if (!ctx.patientIds.length) return json({ visits: [], next_offset: null });
      const offset = body.offset === undefined ? 0 : body.offset;
      if (!Number.isSafeInteger(offset) || offset < 0) return json({ error: "INVALID_OFFSET" }, 400);
      const { data, error } = await admin.from("patient_nutrition_visits")
        .select("id, patient_id, visit_date, doctor_name, template_name_snapshot, meals, patients(full_name, patient_code)")
        .in("patient_id", ctx.patientIds).order("visit_date", { ascending: false }).order("id")
        .range(offset, offset + 19);
      if (error) throw error;
      const visits = data || [];
      // Fetch completions per visit, paginated, without exposing staff/account identifiers.
      for (const visit of visits) {
        const completions: any[] = [];
        for (let start = 0; ; start += 500) {
          const { data: rows, error: readError } = await admin.from("patient_nutrition_meal_completions")
            .select("meal_id, completed, completed_at, updated_at").eq("visit_id", visit.id)
            .order("id").range(start, start + 499);
          if (readError) throw readError;
          completions.push(...(rows || []));
          if (!rows || rows.length < 500) break;
        }
        visit.completions = completions;
      }
      return json({ visits, next_offset: visits.length === 20 ? offset + 20 : null });
    }
    if (body.op !== "set_completion") return json({ error: "UNKNOWN_OPERATION" }, 400);
    if (typeof body.visit_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.visit_id)
      || typeof body.meal_id !== "string" || !body.meal_id || body.meal_id.length > 500
      || typeof body.completed !== "boolean") return json({ error: "INVALID_COMPLETION" }, 400);
    const { data: visit, error: visitError } = await admin.from("patient_nutrition_visits")
      .select("id, patient_id, meals").eq("id", body.visit_id).maybeSingle();
    if (visitError) throw visitError;
    // Same response for missing and unauthorized visits; client cannot choose the patient or actor.
    if (!visit || !ctx.patientIds.includes(visit.patient_id)) return json({ error: "NO_APPROVED_MEDICAL_ACCESS" }, 403);
    const matches = Array.isArray(visit.meals) ? visit.meals.filter((m: any) => m && m.id === body.meal_id) : [];
    if (matches.length !== 1) return json({ error: "MEAL_NOT_FOUND" }, 400);
    const now = new Date().toISOString();
    const { data: completion, error: writeError } = await admin.from("patient_nutrition_meal_completions")
      .upsert({ visit_id: visit.id, meal_id: body.meal_id, completed: body.completed,
        completed_at: body.completed ? now : null, updated_at: now,
        recorded_by_account_id: ctx.account.id, recorded_by_admin_id: null }, { onConflict: "visit_id,meal_id" })
      .select("id, visit_id, meal_id, completed, completed_at, updated_at").single();
    if (writeError) throw writeError;
    const { error: auditError } = await admin.from("patient_portal_audit_log").insert({
      account_id: ctx.account.id, patient_id: visit.patient_id,
      action: "nutrition_meal_completion_set", entity_type: "patient_nutrition_meal_completions",
      entity_id: completion.id, metadata: { visit_id: visit.id, meal_id: body.meal_id, completed: body.completed },
    });
    // Like experience, these are separate writes. Never report a failed save after it committed.
    if (auditError) console.error("nutrition audit failed", auditError.code);
    return json({ ok: true, completion, audit_recorded: !auditError });
  } catch {
    return json({ error: "NUTRITION_REQUEST_FAILED" }, 500);
  }
});
