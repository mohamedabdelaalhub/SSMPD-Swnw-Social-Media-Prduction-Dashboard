import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Meta Comments — inbox + approved replies.
//
// Cron (X-Cron-Secret, every 5 minutes): pulls Facebook/Instagram comments on posts this system
// published in the last 30 days into public.social_comments, then sends replies a person approved
// in the dashboard (status = 'approved'). Staff may also call it with their session to send
// right after approving. Nothing is ever replied without a human approval row.
// Page tokens stay in Edge Function secrets; nothing token-related is logged or returned.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const CRON_SECRET = Deno.env.get("META_PUBLISH_CRON_SECRET");
const GRAPH = "https://graph.facebook.com/v26.0/";
const MAX_POST_AGE_DAYS = 30;
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function serviceKey(): string | null {
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (raw) { try { const p = JSON.parse(raw); if (typeof p?.default === "string" && p.default) return p.default; } catch { /* legacy */ } }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || null;
}
function pageToken(brand: string): string | null {
  if (brand === "sono") return Deno.env.get("META_PAGE_TOKEN_SONO") || null;
  if (brand === "dr_dina") return Deno.env.get("META_PAGE_TOKEN_DR_DINA") || null;
  return null;
}
function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
async function gget(path: string, params: Record<string, string>) {
  const u = new URL(GRAPH + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u.toString());
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok && !d.error, data: d, error: d.error?.message as string | undefined };
}
async function gpost(path: string, params: Record<string, string>) {
  const r = await fetch(GRAPH + path, { method: "POST", body: new URLSearchParams(params) });
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok && !d.error, data: d, error: d.error?.message as string | undefined };
}

type Row = Record<string, unknown>;

async function syncBrand(db: any, brand: string, cfg: any, jobs: any[], report: any) {
  const token = pageToken(brand);
  if (!token) { report.errors.push(`${brand}: no page token`); return; }
  let igUsername: string | null = null;
  if (cfg?.instagram_business_account_id) {
    const me = await gget(cfg.instagram_business_account_id, { fields: "username", access_token: token });
    igUsername = me.ok ? me.data.username : null;
  }
  const rows: Row[] = [];
  const pageReplied = new Set<string>();
  for (const job of jobs) {
    if (job.facebook_post_id) {
      const r = await gget(`${job.facebook_post_id}/comments`, {
        fields: "id,message,from{id,name},created_time,comments.limit(50){id,message,from{id,name},created_time}",
        filter: "toplevel", order: "reverse_chronological", limit: "50", access_token: token
      });
      if (!r.ok) { report.errors.push(`${brand} facebook: ${r.error}`); }
      else for (const c of r.data.data || []) {
        const isPage = c.from?.id === cfg?.facebook_page_id;
        rows.push(fbRow(brand, job, c, null, isPage));
        for (const s of c.comments?.data || []) {
          const sIsPage = s.from?.id === cfg?.facebook_page_id;
          if (sIsPage) pageReplied.add(`facebook:${c.id}`);
          rows.push(fbRow(brand, job, s, c.id, sIsPage));
        }
      }
    }
    if (job.instagram_media_id) {
      const r = await gget(`${job.instagram_media_id}/comments`, {
        fields: "id,text,username,timestamp,replies{id,text,username,timestamp}", limit: "50", access_token: token
      });
      if (!r.ok) { report.errors.push(`${brand} instagram: ${r.error}`); }
      else for (const c of r.data.data || []) {
        const isPage = !!igUsername && c.username === igUsername;
        rows.push(igRow(brand, job, c, null, isPage));
        for (const s of c.replies?.data || []) {
          const sIsPage = !!igUsername && s.username === igUsername;
          if (sIsPage) pageReplied.add(`instagram:${c.id}`);
          rows.push(igRow(brand, job, s, c.id, sIsPage));
        }
      }
    }
  }
  if (rows.length) {
    // New comments only; existing rows keep their drafts/status.
    const ins = await db.from("social_comments").upsert(rows, { onConflict: "id", ignoreDuplicates: true });
    if (ins.error) report.errors.push(`${brand} save: ${ins.error.message}`);
    else report.seen += rows.length;
  }
  // Answered directly on Facebook/Instagram → no longer waiting in the dashboard.
  if (pageReplied.size) {
    await db.from("social_comments").update({ status: "replied", updated_at: new Date().toISOString() })
      .in("id", [...pageReplied]).in("status", ["new", "drafted"]);
  }
}
function fbRow(brand: string, job: any, c: any, parent: string | null, isPage: boolean): Row {
  return {
    id: `facebook:${c.id}`, platform: "facebook", platform_comment_id: c.id, brand, content_id: job.content_id, job_id: job.id,
    post_ref: job.facebook_post_id, parent_comment_id: parent, author_name: c.from?.name || null, author_is_page: isPage,
    message: c.message || "", commented_at: c.created_time || null, status: isPage ? "replied" : "new"
  };
}
function igRow(brand: string, job: any, c: any, parent: string | null, isPage: boolean): Row {
  return {
    id: `instagram:${c.id}`, platform: "instagram", platform_comment_id: c.id, brand, content_id: job.content_id, job_id: job.id,
    post_ref: job.instagram_media_id, parent_comment_id: parent, author_name: c.username || null, author_is_page: isPage,
    message: c.text || "", commented_at: c.timestamp || null, status: isPage ? "replied" : "new"
  };
}

// ---- Approved replies library: auto-answer comments that closely match an approved example ----
const SENSITIVE = /(شكو|زعلان|سيء|سيئ|وحش|نصب|حرام عليكم|إهمال|اهمال|غلط طبي|خطأ طبي|بلاغ|محامي|نزيف|إغماء|اغماء|تشنج|جلط|طوارئ|ضيق نفس|ألم شديد|الم شديد|انتحار|بموت)/;
export function normalizeAr(text: string): string {
  return String(text || "").toLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, "")           // tashkeel + tatweel
    .replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")                 // punctuation + emoji
    .replace(/(.)\1{2,}/g, "$1")                        // stretched letters (كتيييير → كتير)
    .replace(/\s+/g, " ").trim();
}
// Filler words that never decide meaning.
const STOP = new Set(["يا","جماعه","لو","سمحت","سمحتي","فضلك","حضرتك","ممكن","اعرف","من","هو","هي","انا","بس","طيب","لوسمحت","استفسار","مساء","صباح","الخير","النور","السلام","عليكم","ورحمه","الله","وبركاته"]);
export function similarity(a: string, b: string): number {
  const na = normalizeAr(a), nb = normalizeAr(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const keep = (t: string) => !STOP.has(t);
  const ta = new Set(na.split(" ").filter(keep)), tb = new Set(nb.split(" ").filter(keep));
  if (!ta.size || !tb.size) return 0;
  if ([...ta].join(" ") === [...tb].join(" ")) return 1;
  let common = 0; for (const t of ta) if (tb.has(t)) common++;
  if (common < 2) return 0;                             // one shared word is never enough
  return common / (ta.size + tb.size - common);         // Jaccard
}
const AUTO_THRESHOLD = 0.6;
async function autoReply(db: any, report: any) {
  const { data: templates } = await db.from("social_reply_templates").select("*").eq("active", true);
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const { data: rows } = await db.from("social_comments").select("id,brand,message,commented_at")
    .eq("status", "new").eq("auto_checked", false).eq("author_is_page", false).gte("commented_at", since).limit(200);
  for (const c of rows || []) {
    const now = new Date().toISOString();
    if (SENSITIVE.test(c.message)) {
      await db.from("social_comments").update({ sensitive: true, auto_checked: true, updated_at: now }).eq("id", c.id);
      continue;
    }
    let best: any = null, bestScore = 0;
    for (const t of templates || []) {
      if (t.brand !== c.brand) continue;
      for (const ex of t.examples || []) {
        const s = similarity(c.message, ex);
        if (s > bestScore) { bestScore = s; best = t; }
      }
    }
    if (best && bestScore >= AUTO_THRESHOLD) {
      const upd = await db.from("social_comments").update({ final_reply: best.reply_text, status: "approved", auto_template_id: best.id, auto_checked: true, updated_at: now })
        .eq("id", c.id).eq("status", "new").select("id");
      if (upd.data?.length) {
        await db.from("social_reply_templates").update({ uses_count: (best.uses_count || 0) + 1, last_used_at: now }).eq("id", best.id);
        best.uses_count = (best.uses_count || 0) + 1;
        report.auto = (report.auto || 0) + 1;
      }
    } else {
      await db.from("social_comments").update({ auto_checked: true }).eq("id", c.id);
    }
  }
}

async function sendApproved(db: any, report: any, onlyId?: string) {
  let q = db.from("social_comments").select("*").eq("status", "approved").limit(20);
  if (onlyId) q = q.eq("id", onlyId);
  const { data } = await q;
  for (const c of data || []) {
    // Claim the row so two runs never send the same reply twice.
    const claim = await db.from("social_comments").update({ status: "sending", updated_at: new Date().toISOString() })
      .eq("id", c.id).eq("status", "approved").select("id");
    if (!claim.data?.length) continue;
    const token = pageToken(c.brand);
    const target = c.parent_comment_id || c.platform_comment_id; // reply in the same thread
    const r = !token ? { ok: false, error: "no page token", data: {} as any }
      : c.platform === "facebook"
        ? await gpost(`${target}/comments`, { message: c.final_reply, access_token: token })
        : await gpost(`${target}/replies`, { message: c.final_reply, access_token: token });
    if (r.ok) {
      await db.from("social_comments").update({ status: "replied", reply_platform_id: r.data.id || null, replied_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("id", c.id);
      report.sent++;
    } else {
      await db.from("social_comments").update({ status: "failed", last_error: String(r.error || "send failed").slice(0, 300), updated_at: new Date().toISOString() }).eq("id", c.id);
      report.errors.push(`send ${c.id}: ${r.error}`);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ ok: false, error: "POST only" }, 405);
  const key = serviceKey();
  if (!key) return reply({ ok: false, error: "MISCONFIGURED" }, 500);
  const db = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });
  const body = await req.json().catch(() => ({}));

  const isCron = !!CRON_SECRET && req.headers.get("X-Cron-Secret") === CRON_SECRET;
  if (!isCron) {
    // Staff session: may only trigger sending (and only of rows they already approved through RLS-checked RPCs).
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer /i, "");
    const user = await db.auth.getUser(jwt);
    if (user.error || !user.data.user) return reply({ ok: false, error: "AUTH_REQUIRED" }, 401);
    const { data: admin } = await db.from("admins").select("id,role,admin_extra_roles(role)").eq("user_id", user.data.user.id).eq("active", true).maybeSingle();
    const roles = admin ? [admin.role, ...(admin.admin_extra_roles || []).map((r: any) => r.role)] : [];
    if (!roles.some((r: string) => ["page_manager", "approver", "general_manager", "super_admin"].includes(r))) return reply({ ok: false, error: "FORBIDDEN" }, 403);
    const report = { sent: 0, errors: [] as string[] };
    await sendApproved(db, report, typeof body.id === "string" ? body.id : undefined);
    return reply({ ok: true, ...report });
  }

  const report = { seen: 0, sent: 0, errors: [] as string[] };
  const cutoff = new Date(Date.now() - MAX_POST_AGE_DAYS * 864e5).toISOString();
  const { data: jobs, error } = await db.from("meta_publish_jobs")
    .select("id,brand,content_id,facebook_post_id,instagram_media_id")
    .in("status", ["published", "partial"]).gte("published_at", cutoff).limit(60);
  if (error) return reply({ ok: false, error: error.message }, 500);
  const { data: cfgs } = await db.from("meta_brand_config").select("*");
  const byBrand: Record<string, any[]> = {};
  for (const j of jobs || []) (byBrand[j.brand] ||= []).push(j);
  for (const [brand, list] of Object.entries(byBrand)) {
    await syncBrand(db, brand, (cfgs || []).find((c: any) => c.brand === brand), list, report);
  }
  await autoReply(db, report);
  await sendApproved(db, report);
  return reply({ ok: true, ...report });
});
