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
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}

function normalizeEmail(v: unknown) {
  return String(v || "").trim().toLowerCase();
}

function normalizePhone(v: unknown) {
  let s = String(v || "").trim().replace(/[^\d+]/g, "");
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("00")) s = s.slice(2);
  return s.replace(/\D/g, "");
}

async function getAuthenticatedUser(req: Request) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) return null;

  const client = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null;
  return user;
}

async function getPortalAccount(req: Request, admin: ReturnType<typeof createClient>) {
  const user = await getAuthenticatedUser(req);
  if (!user) return { error: "UNAUTHORIZED", status: 401 };

  const { data: account, error } = await admin
    .from("patient_accounts")
    .select("id, auth_user_id, status, login_email, activation_completed_at")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (error) return { error: error.message, status: 500 };
  if (!account) return { error: "PATIENT_ACCOUNT_NOT_FOUND", status: 404 };
  if (account.status !== "active" || !account.activation_completed_at) {
    return { error: "PATIENT_ACCOUNT_NOT_ACTIVATED", status: 403 };
  }

  return { account, user };
}

function isEffectiveAccess(row: any) {
  if (!row || row.verification_status !== "approved" || row.revoked_at) return false;
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return false;
  return true;
}

async function audit(
  admin: ReturnType<typeof createClient>,
  accountId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
) {
  const { error } = await admin.from("patient_portal_audit_log").insert({
    account_id: accountId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    metadata,
  });
  if (error) console.error("audit_failed", error.message);
}

async function getDisplayNames(admin: ReturnType<typeof createClient>, accountIds: string[]) {
  const ids = Array.from(new Set(accountIds.filter(Boolean)));
  if (!ids.length) return {} as Record<string, { display_name: string; login_email: string | null }>;

  const { data: accounts, error: accountError } = await admin
    .from("patient_accounts")
    .select("id, login_email")
    .in("id", ids);
  if (accountError) throw accountError;

  const { data: accessRows, error: accessError } = await admin
    .from("patient_account_access")
    .select("account_id, patient_id, access_type, relationship, verification_status, expires_at, revoked_at, is_primary")
    .in("account_id", ids)
    .eq("access_type", "self")
    .eq("verification_status", "approved");
  if (accessError) throw accessError;

  const effective = (accessRows || []).filter(isEffectiveAccess);
  const patientIds = Array.from(new Set(effective.map((r: any) => r.patient_id).filter(Boolean)));

  let patientById: Record<string, any> = {};
  if (patientIds.length) {
    const { data: patients, error: patientError } = await admin
      .from("patients")
      .select("id, full_name")
      .in("id", patientIds);
    if (patientError) throw patientError;
    patientById = Object.fromEntries((patients || []).map((p: any) => [p.id, p]));
  }

  const ownPatientByAccount: Record<string, any> = {};
  for (const row of effective) {
    if (!ownPatientByAccount[row.account_id] || row.is_primary) {
      ownPatientByAccount[row.account_id] = patientById[row.patient_id] || null;
    }
  }

  const result: Record<string, { display_name: string; login_email: string | null }> = {};
  for (const a of accounts || []) {
    const patient = ownPatientByAccount[a.id];
    result[a.id] = {
      display_name: patient?.full_name || a.login_email || "مستخدم SwnW",
      login_email: a.login_email || null,
    };
  }
  return result;
}

async function findTargetAccount(
  admin: ReturnType<typeof createClient>,
  matchMethod: string,
  rawValue: unknown,
) {
  let patient: any = null;

  if (matchMethod === "patient_code") {
    const value = String(rawValue || "").trim().toUpperCase();
    if (!value) return null;
    const { data, error } = await admin
      .from("patients")
      .select("id, patient_code, status")
      .eq("patient_code", value)
      .eq("status", "active")
      .maybeSingle();
    if (error) throw error;
    patient = data;
  } else if (matchMethod === "phone") {
    const value = normalizePhone(rawValue);
    if (value.length < 8 || value.length > 16) return null;

    const { data, error } = await admin
      .from("patients")
      .select("id, patient_code, phone_normalized, status")
      .eq("phone_normalized", value)
      .eq("status", "active")
      .limit(2);
    if (error) throw error;

    if ((data || []).length !== 1) return null;
    patient = data![0];
  } else if (matchMethod === "email") {
    const value = normalizeEmail(rawValue);
    if (!value || value.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;

    const { data, error } = await admin
      .from("patients")
      .select("id, patient_code, email, status")
      .eq("email", value)
      .eq("status", "active")
      .limit(2);
    if (error) throw error;

    if ((data || []).length !== 1) return null;
    patient = data![0];
  } else {
    return null;
  }

  if (!patient) return null;

  const { data: accessRows, error: accessError } = await admin
    .from("patient_account_access")
    .select("account_id, patient_id, access_type, relationship, verification_status, expires_at, revoked_at")
    .eq("patient_id", patient.id)
    .eq("access_type", "self")
    .eq("verification_status", "approved");
  if (accessError) throw accessError;

  const effective = (accessRows || []).filter(isEffectiveAccess);
  if (effective.length !== 1) return null;

  const targetAccountId = effective[0].account_id;
  const { data: account, error: accountError } = await admin
    .from("patient_accounts")
    .select("id, status, activation_completed_at")
    .eq("id", targetAccountId)
    .maybeSingle();
  if (accountError) throw accountError;
  if (!account || account.status !== "active" || !account.activation_completed_at) return null;

  return { account_id: account.id, patient_id: patient.id };
}

async function pairLink(
  admin: ReturnType<typeof createClient>,
  accountA: string,
  accountB: string,
) {
  const { data, error } = await admin
    .from("patient_family_links")
    .select("id, account_a_id, account_b_id, status, created_at")
    .eq("status", "active")
    .or(
      `and(account_a_id.eq.${accountA},account_b_id.eq.${accountB}),and(account_a_id.eq.${accountB},account_b_id.eq.${accountA})`,
    )
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function familyOverview(admin: ReturnType<typeof createClient>, account: any) {
  const nowIso = new Date().toISOString();

  await admin
    .from("patient_family_requests")
    .update({ status: "expired", responded_at: nowIso })
    .eq("status", "pending")
    .lt("expires_at", nowIso)
    .or(`requester_account_id.eq.${account.id},target_account_id.eq.${account.id}`);

  const [
    { data: incoming, error: incomingError },
    { data: outgoing, error: outgoingError },
    { data: links, error: linksError },
  ] = await Promise.all([
    admin
      .from("patient_family_requests")
      .select("id, requester_account_id, target_account_id, match_method, status, created_at, expires_at")
      .eq("target_account_id", account.id)
      .eq("status", "pending")
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false }),
    admin
      .from("patient_family_requests")
      .select("id, requester_account_id, target_account_id, match_method, status, created_at, expires_at")
      .eq("requester_account_id", account.id)
      .eq("status", "pending")
      .gt("expires_at", nowIso)
      .order("created_at", { ascending: false }),
    admin
      .from("patient_family_links")
      .select("id, account_a_id, account_b_id, status, created_at")
      .eq("status", "active")
      .or(`account_a_id.eq.${account.id},account_b_id.eq.${account.id}`)
      .order("created_at", { ascending: false }),
  ]);

  if (incomingError) throw incomingError;
  if (outgoingError) throw outgoingError;
  if (linksError) throw linksError;

  const otherIds = [
    ...(incoming || []).map((r: any) => r.requester_account_id),
    ...(outgoing || []).map((r: any) => r.target_account_id),
    ...(links || []).map((l: any) => l.account_a_id === account.id ? l.account_b_id : l.account_a_id),
  ];

  const names = await getDisplayNames(admin, otherIds);

  return {
    incoming: (incoming || []).map((r: any) => ({
      id: r.id,
      from: names[r.requester_account_id] || { display_name: "مستخدم SwnW", login_email: null },
      created_at: r.created_at,
      expires_at: r.expires_at,
    })),
    outgoing: (outgoing || []).map((r: any) => ({
      id: r.id,
      to: names[r.target_account_id] || { display_name: "مستخدم SwnW", login_email: null },
      created_at: r.created_at,
      expires_at: r.expires_at,
    })),
    family: (links || []).map((l: any) => {
      const otherId = l.account_a_id === account.id ? l.account_b_id : l.account_a_id;
      return {
        link_id: l.id,
        member_account_id: otherId,
        member: names[otherId] || { display_name: "مستخدم SwnW", login_email: null },
        created_at: l.created_at,
        medical_access_shared: false,
      };
    }),
  };
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
  const ctx: any = await getPortalAccount(req, admin);
  if (!ctx.account) return json({ error: ctx.error }, ctx.status || 500);
  const account = ctx.account;

  try {
    const op = String(body.op || "overview");

    if (op === "overview") {
      return json(await familyOverview(admin, account));
    }

    if (op === "send_request") {
      const matchMethod = String(body.match_method || "").trim();
      if (!["patient_code", "phone", "email"].includes(matchMethod)) {
        return json({ error: "INVALID_MATCH_METHOD" }, 400);
      }

      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { count, error: countError } = await admin
        .from("patient_family_requests")
        .select("id", { count: "exact", head: true })
        .eq("requester_account_id", account.id)
        .gte("created_at", oneHourAgo);
      if (countError) throw countError;
      if ((count || 0) >= 10) return json({ error: "RATE_LIMITED" }, 429);

      const target = await findTargetAccount(admin, matchMethod, body.value);

      if (!target || target.account_id === account.id) {
        await audit(admin, account.id, "family_request_attempted", "family_request", null, {
          match_method: matchMethod,
          delivered: false,
        });
        return json({ ok: true, status: "processed" }, 202);
      }

      const existingLink = await pairLink(admin, account.id, target.account_id);
      if (existingLink) {
        await audit(admin, account.id, "family_request_attempted", "family_link", existingLink.id, {
          match_method: matchMethod,
          delivered: false,
          reason: "already_family",
        });
        return json({ ok: true, status: "processed" }, 202);
      }

      const { data: pendingRows, error: pendingError } = await admin
        .from("patient_family_requests")
        .select("id, requester_account_id, target_account_id, status")
        .eq("status", "pending")
        .or(
          `and(requester_account_id.eq.${account.id},target_account_id.eq.${target.account_id}),and(requester_account_id.eq.${target.account_id},target_account_id.eq.${account.id})`,
        )
        .limit(1);
      if (pendingError) throw pendingError;

      if (!(pendingRows || []).length) {
        const { data: created, error: createError } = await admin
          .from("patient_family_requests")
          .insert({
            requester_account_id: account.id,
            target_account_id: target.account_id,
            match_method: matchMethod,
            status: "pending",
          })
          .select("id")
          .single();

        if (createError && (createError as any).code !== "23505") throw createError;

        await audit(admin, account.id, "family_request_sent", "family_request", created?.id || null, {
          match_method: matchMethod,
          target_account_id: target.account_id,
        });
      }

      return json({ ok: true, status: "processed" }, 202);
    }

    if (op === "respond_request") {
      const requestId = String(body.request_id || "").trim();
      const decision = String(body.decision || "").trim();
      if (!requestId || !["accept", "reject"].includes(decision)) {
        return json({ error: "INVALID_REQUEST_RESPONSE" }, 400);
      }

      const { data: invitation, error: invitationError } = await admin
        .from("patient_family_requests")
        .select("id, requester_account_id, target_account_id, status, expires_at")
        .eq("id", requestId)
        .maybeSingle();
      if (invitationError) throw invitationError;
      if (!invitation || invitation.target_account_id !== account.id) {
        return json({ error: "REQUEST_NOT_FOUND" }, 404);
      }
      if (invitation.status !== "pending") return json({ error: "REQUEST_NOT_PENDING" }, 409);
      if (new Date(invitation.expires_at).getTime() <= Date.now()) {
        await admin
          .from("patient_family_requests")
          .update({ status: "expired", responded_at: new Date().toISOString() })
          .eq("id", requestId)
          .eq("status", "pending");
        return json({ error: "REQUEST_EXPIRED" }, 409);
      }

      if (decision === "reject") {
        const { error } = await admin
          .from("patient_family_requests")
          .update({ status: "rejected", responded_at: new Date().toISOString() })
          .eq("id", requestId)
          .eq("status", "pending");
        if (error) throw error;

        await audit(admin, account.id, "family_request_rejected", "family_request", requestId, {
          requester_account_id: invitation.requester_account_id,
        });
        return json({ ok: true, status: "rejected" });
      }

      const existingLink = await pairLink(admin, invitation.requester_account_id, account.id);
      let linkId = existingLink?.id || null;
      let insertedNewLink = false;

      if (!linkId) {
        const [accountA, accountB] = [invitation.requester_account_id, account.id].sort();
        const { data: createdLink, error: linkError } = await admin
          .from("patient_family_links")
          .insert({
            account_a_id: accountA,
            account_b_id: accountB,
            created_from_request_id: requestId,
            status: "active",
          })
          .select("id")
          .single();

        if (linkError) {
          if ((linkError as any).code === "23505") {
            const raced = await pairLink(admin, invitation.requester_account_id, account.id);
            linkId = raced?.id || null;
          } else {
            throw linkError;
          }
        } else {
          linkId = createdLink.id;
          insertedNewLink = true;
        }
      }

      if (!linkId) throw new Error("FAMILY_LINK_CREATE_FAILED");

      const { error: requestUpdateError } = await admin
        .from("patient_family_requests")
        .update({ status: "accepted", responded_at: new Date().toISOString() })
        .eq("id", requestId)
        .eq("status", "pending");

      if (requestUpdateError) {
        if (insertedNewLink) {
          await admin.from("patient_family_links").delete().eq("id", linkId);
        }
        throw requestUpdateError;
      }

      await audit(admin, account.id, "family_request_accepted", "family_link", linkId, {
        request_id: requestId,
        requester_account_id: invitation.requester_account_id,
      });

      return json({ ok: true, status: "accepted", link_id: linkId });
    }

    if (op === "cancel_request") {
      const requestId = String(body.request_id || "").trim();
      if (!requestId) return json({ error: "REQUEST_ID_REQUIRED" }, 400);

      const { data: invitation, error: invitationError } = await admin
        .from("patient_family_requests")
        .select("id, requester_account_id, status")
        .eq("id", requestId)
        .maybeSingle();
      if (invitationError) throw invitationError;
      if (!invitation || invitation.requester_account_id !== account.id) {
        return json({ error: "REQUEST_NOT_FOUND" }, 404);
      }
      if (invitation.status !== "pending") return json({ error: "REQUEST_NOT_PENDING" }, 409);

      const { error } = await admin
        .from("patient_family_requests")
        .update({ status: "cancelled", responded_at: new Date().toISOString() })
        .eq("id", requestId)
        .eq("status", "pending");
      if (error) throw error;

      await audit(admin, account.id, "family_request_cancelled", "family_request", requestId);
      return json({ ok: true, status: "cancelled" });
    }

    if (op === "remove_member") {
      const linkId = String(body.link_id || "").trim();
      if (!linkId) return json({ error: "LINK_ID_REQUIRED" }, 400);

      const { data: link, error: linkError } = await admin
        .from("patient_family_links")
        .select("id, account_a_id, account_b_id, status")
        .eq("id", linkId)
        .maybeSingle();
      if (linkError) throw linkError;
      if (!link || ![link.account_a_id, link.account_b_id].includes(account.id)) {
        return json({ error: "FAMILY_LINK_NOT_FOUND" }, 404);
      }
      if (link.status !== "active") return json({ ok: true, status: "already_removed" });

      const now = new Date().toISOString();
      const { error } = await admin
        .from("patient_family_links")
        .update({
          status: "removed",
          ended_at: now,
          ended_by_account_id: account.id,
        })
        .eq("id", linkId)
        .eq("status", "active");
      if (error) throw error;

      await admin
        .from("patient_family_record_shares")
        .update({
          status: "revoked",
          revoked_at: now,
          revoked_by_account_id: account.id,
        })
        .eq("family_link_id", linkId)
        .eq("status", "active");

      await audit(admin, account.id, "family_member_removed", "family_link", linkId);
      return json({ ok: true, status: "removed" });
    }

    return json({ error: "UNKNOWN_OPERATION" }, 400);
  } catch (e) {
    console.error("patient-family error", e);
    return json({ error: "FAMILY_OPERATION_FAILED" }, 500);
  }
});
