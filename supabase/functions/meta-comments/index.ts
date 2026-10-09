import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { decideReply, clinicInfo, withContact } from "./ai.ts";
import { syncMessages } from "./messages.ts";

// Meta Comments & Messages — inbox + autopilot replies.
//
// Cron (X-Cron-Secret, every 2 minutes): pulls Facebook/Instagram comments (social_comments) and private
// messages (social_messages, messages.ts). With autopilot on (social_settings.autopilot, the owner's
// choice) waiting comments/messages are answered directly: AI reply for general questions, the owner's
// fixed templates for sensitive medical / emergency / complaint (which also raise a red dashboard alert).
// Every reply ends with the booking contact block. Staff may call it to sync, suggest or send.
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
  // Watch every post of the last 60 days on the page/Instagram (not only dashboard posts), but only
  // re-read comments of a post when its comment count changed — keeps Graph calls low every 2 minutes.
  const since = Math.floor((Date.now() - 60 * 864e5) / 1000).toString();
  const counts = new Map<string, number>();
  const byFb = new Map(jobs.filter((j) => j.facebook_post_id).map((j) => [j.facebook_post_id, j]));
  const byIg = new Map(jobs.filter((j) => j.instagram_media_id).map((j) => [j.instagram_media_id, j]));
  if (cfg?.facebook_page_id) {
    const r = await gget(`${cfg.facebook_page_id}/published_posts`, { fields: "id,comments.summary(true).limit(0)", since, limit: "60", access_token: token });
    if (!r.ok) report.errors.push(`${brand} page posts: ${r.error}`);
    else for (const p of r.data.data || []) {
      counts.set(p.id, p.comments?.summary?.total_count ?? -1);
      if (!byFb.has(p.id)) byFb.set(p.id, { id: null, content_id: null, facebook_post_id: p.id });
    }
  }
  if (cfg?.instagram_business_account_id) {
    const r = await gget(`${cfg.instagram_business_account_id}/media`, { fields: "id,permalink,timestamp,comments_count", limit: "40", access_token: token });
    if (!r.ok) report.errors.push(`${brand} instagram media: ${r.error}`);
    else for (const m of r.data.data || []) {
      if (m.timestamp && Date.parse(m.timestamp) < Number(since) * 1000) continue;
      counts.set(m.id, m.comments_count ?? -1);
      const known = byIg.get(m.id);
      if (known) known.instagram_permalink = known.instagram_permalink || m.permalink || null;
      else byIg.set(m.id, { id: null, content_id: null, instagram_media_id: m.id, instagram_permalink: m.permalink || null });
    }
  }
  const { data: watched } = await db.from("social_comment_watch").select("post_ref,last_count,checked_at").eq("brand", brand);
  const watch = new Map((watched || []).map((w: any) => [w.post_ref, w]));
  const stale = (ref: string) => {
    const w: any = watch.get(ref), c = counts.get(ref);
    if (!w || c === undefined || c < 0 || w.last_count !== c) return true;
    return Date.now() - Date.parse(w.checked_at) > 6 * 3600e3; // safety re-read every 6 hours
  };
  const watchRows: Row[] = [];
  jobs = [
    ...[...byFb.values()].filter((j) => stale(j.facebook_post_id)).map((j) => ({ ...j, instagram_media_id: null })),
    ...[...byIg.values()].filter((j) => stale(j.instagram_media_id)).map((j) => ({ ...j, facebook_post_id: null }))
  ];
  for (const j of jobs) {
    const ref = j.facebook_post_id || j.instagram_media_id;
    watchRows.push({ post_ref: ref, platform: j.facebook_post_id ? "facebook" : "instagram", brand, last_count: counts.get(ref) ?? null, checked_at: new Date().toISOString() });
  }
  report.checked = (report.checked || 0) + jobs.length;
  const rows: Row[] = [];
  const failed = new Set<string>();
  const pageReplied = new Set<string>();
  for (const job of jobs) {
    if (job.facebook_post_id) {
      const r = await gget(`${job.facebook_post_id}/comments`, {
        fields: "id,message,from{id,name},created_time,permalink_url,comments.limit(50){id,message,from{id,name},created_time,permalink_url}",
        filter: "toplevel", order: "reverse_chronological", limit: "50", access_token: token
      });
      if (!r.ok) { report.errors.push(`${brand} facebook: ${r.error}`); failed.add(job.facebook_post_id); }
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
      if (!r.ok) { report.errors.push(`${brand} instagram: ${r.error}`); failed.add(job.instagram_media_id); }
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
    if (ins.error) { report.errors.push(`${brand} save: ${ins.error.message}`); report.saveFailed = true; }
    else report.seen += rows.length;
    // Rows saved before links were collected: fill comment/author links once.
    const ids = rows.map((r) => r.id as string);
    const missing: any[] = [];
    for (let i = 0; i < ids.length; i += 80) {
      const { data } = await db.from("social_comments").select("id").in("id", ids.slice(i, i + 80)).is("comment_url", null);
      missing.push(...(data || []));
    }
    const byId = new Map(rows.map((r) => [r.id as string, r]));
    for (const m of missing) {
      const r = byId.get(m.id);
      if (r?.comment_url) await db.from("social_comments").update({ comment_url: r.comment_url, author_url: r.author_url }).eq("id", m.id);
    }
  }
  const okWatch = watchRows.filter((w) => !failed.has(w.post_ref as string));
  if (okWatch.length && !report.saveFailed) await db.from("social_comment_watch").upsert(okWatch, { onConflict: "post_ref" });
  // Answered directly on Facebook/Instagram → no longer waiting in the dashboard.
  // In chunks: a single request with hundreds of ids is too long and fails silently.
  const answered = [...pageReplied];
  for (let i = 0; i < answered.length; i += 80) {
    await db.from("social_comments").update({ status: "replied", updated_at: new Date().toISOString() })
      .in("id", answered.slice(i, i + 80)).in("status", ["new", "drafted"]);
  }
}
function fbRow(brand: string, job: any, c: any, parent: string | null, isPage: boolean): Row {
  return {
    id: `facebook:${c.id}`, platform: "facebook", platform_comment_id: c.id, brand, content_id: job.content_id, job_id: job.id,
    post_ref: job.facebook_post_id, parent_comment_id: parent, author_name: c.from?.name || null, author_is_page: isPage,
    message: c.message || "", commented_at: c.created_time || null, status: isPage ? "replied" : "new",
    comment_url: c.permalink_url || null, author_url: null
  };
}
function igRow(brand: string, job: any, c: any, parent: string | null, isPage: boolean): Row {
  return {
    id: `instagram:${c.id}`, platform: "instagram", platform_comment_id: c.id, brand, content_id: job.content_id, job_id: job.id,
    post_ref: job.instagram_media_id, parent_comment_id: parent, author_name: c.username || null, author_is_page: isPage,
    message: c.text || "", commented_at: c.timestamp || null, status: isPage ? "replied" : "new",
    comment_url: job.instagram_permalink || null, author_url: c.username ? `https://www.instagram.com/${c.username}/` : null
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

// ---- Replies: AI writer + fixed templates (ai.ts); autopilot answers without waiting for approval ----
async function postContext(db: any, c: any): Promise<string> {
  if (!c.content_id) return "";
  const { data: item } = await db.from("content_items").select("title,caption_text").eq("id", c.content_id).maybeSingle();
  return item ? `${item.title || ""}\n${String(item.caption_text || "").slice(0, 600)}` : "";
}
async function suggestReply(db: any, id: string): Promise<{ ok: boolean; text?: string; error?: string }> {
  const { data: c } = await db.from("social_comments").select("*").eq("id", id).maybeSingle();
  if (!c || c.author_is_page || ["replied", "sending", "approved"].includes(c.status)) return { ok: false, error: "التعليق غير متاح" };
  const d = await decideReply({ brand: c.brand, channel: "comment", text: c.message, post: await postContext(db, c), clinicInfo: await clinicInfo() });
  if (!d.ok) return { ok: false, error: d.error };
  if (!d.reply) return { ok: false, error: "التعليق ده شكله سبام — مفيش رد مناسب" };
  await db.from("social_comments").update({
    suggested_reply: d.reply, category: d.category, status: c.status === "new" || c.status === "failed" ? "drafted" : c.status, updated_at: new Date().toISOString()
  }).eq("id", id).in("status", ["new", "drafted", "failed"]);
  return { ok: true, text: d.reply };
}
// Autopilot: answer waiting comments directly (owner's decision). Complaints/emergencies get the fixed
// templates and a red alert in the dashboard; spam is ignored.
async function autopilotComments(db: any, report: any) {
  const since = new Date(Date.now() - 60 * 864e5).toISOString();
  const { data } = await db.from("social_comments").select("*").in("status", ["new", "drafted"]).eq("author_is_page", false)
    .is("parent_comment_id", null).gte("commented_at", since)
    .or(`auto_checked.eq.true,commented_at.lt.${new Date(Date.now() - 7 * 864e5).toISOString()}`)
    .order("commented_at", { ascending: false }).limit(8);
  const info = await clinicInfo();
  for (const c of data || []) {
    const d = await decideReply({ brand: c.brand, channel: "comment", text: c.message, post: await postContext(db, c), clinicInfo: info });
    const now = new Date().toISOString();
    if (!d.ok) { report.errors.push(`autopilot ${c.id}: ${d.error}`); break; }
    if (d.category === "spam" || !d.reply) {
      await db.from("social_comments").update({ status: "ignored", category: d.category, updated_at: now }).eq("id", c.id).in("status", ["new", "drafted"]);
      continue;
    }
    const alert = d.category === "complaint" || d.category === "emergency";
    await db.from("social_comments").update({ final_reply: d.reply, category: d.category, alert, sensitive: c.sensitive || alert, status: "approved", updated_at: now })
      .eq("id", c.id).in("status", ["new", "drafted"]);
    report.autopilot = (report.autopilot || 0) + 1;
  }
}
async function autopilotSettings(db: any): Promise<{ comments: boolean; messages: boolean }> {
  const { data } = await db.from("social_settings").select("value").eq("key", "autopilot").maybeSingle();
  return { comments: data?.value?.comments !== false, messages: data?.value?.messages !== false };
}
// New comments get a suggestion ready before anyone opens the tab (a few per run to keep cost low).
async function autoSuggest(db: any, report: any) {
  // Recent comments wait for the approved-replies check first; older unanswered ones are drafted too.
  const since = new Date(Date.now() - 60 * 864e5).toISOString();
  const { data } = await db.from("social_comments").select("id").eq("status", "new").eq("author_is_page", false)
    .is("parent_comment_id", null).is("suggested_reply", null).gte("commented_at", since)
    .or(`auto_checked.eq.true,commented_at.lt.${new Date(Date.now() - 7 * 864e5).toISOString()}`)
    .order("commented_at", { ascending: false }).limit(5);
  for (const c of data || []) {
    const r = await suggestReply(db, c.id);
    if (r.ok) report.suggested = (report.suggested || 0) + 1; else { report.errors.push(`suggest ${c.id}: ${r.error}`); break; }
  }
}

async function runSync(db: any, report: any) {
  const cutoff = new Date(Date.now() - MAX_POST_AGE_DAYS * 864e5).toISOString();
  const { data: jobs, error } = await db.from("meta_publish_jobs")
    .select("id,brand,content_id,facebook_post_id,instagram_media_id,instagram_permalink")
    .in("status", ["published", "partial"]).gte("published_at", cutoff).limit(60);
  if (error) { report.errors.push(error.message); return; }
  const { data: cfgs } = await db.from("meta_brand_config").select("*");
  const byBrand: Record<string, any[]> = {};
  for (const c of cfgs || []) byBrand[c.brand] ||= [];
  for (const j of jobs || []) (byBrand[j.brand] ||= []).push(j);
  const auto = await autopilotSettings(db);
  for (const [brand, list] of Object.entries(byBrand)) {
    const cfg = (cfgs || []).find((c: any) => c.brand === brand);
    await syncBrand(db, brand, cfg, list, report);
    const token = pageToken(brand);
    if (token) await syncMessages(db, brand, cfg, token, report, auto.messages);
  }
  await autoReply(db, report);
  if (auto.comments) await autopilotComments(db, report);
  await sendApproved(db, report);
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
    const message = withContact(c.final_reply);
    const r = !token ? { ok: false, error: "no page token", data: {} as any }
      : c.platform === "facebook"
        ? await gpost(`${target}/comments`, { message, access_token: token })
        : await gpost(`${target}/replies`, { message, access_token: token });
    if (r.ok) {
      await db.from("social_comments").update({ status: "replied", final_reply: message, reply_platform_id: r.data.id || null, replied_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() }).eq("id", c.id);
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
    // admin_extra_roles has two FKs to admins (admin_id, added_by), so it is read separately.
    const { data: admin } = await db.from("admins").select("id,role").eq("user_id", user.data.user.id).eq("active", true).maybeSingle();
    const { data: extra } = admin ? await db.from("admin_extra_roles").select("role").eq("admin_id", admin.id) : { data: [] };
    const roles = admin ? [admin.role, ...(extra || []).map((r: any) => r.role)] : [];
    if (!roles.some((r: string) => ["page_manager", "approver", "general_manager", "super_admin"].includes(r))) return reply({ ok: false, error: "FORBIDDEN" }, 403);
    if (body.action === "suggest") {
      if (typeof body.id !== "string") return reply({ ok: false, error: "id required" }, 400);
      const r = await suggestReply(db, body.id);
      return reply(r);
    }
    if (body.action === "sync") {
      const report = { seen: 0, sent: 0, errors: [] as string[] };
      await runSync(db, report);
      return reply({ ok: true, ...report });
    }
    const report = { sent: 0, errors: [] as string[] };
    await sendApproved(db, report, typeof body.id === "string" ? body.id : undefined);
    return reply({ ok: true, ...report });
  }

  const report = { seen: 0, sent: 0, errors: [] as string[] };
  await runSync(db, report);
  if (!(await autopilotSettings(db)).comments) await autoSuggest(db, report);
  return reply({ ok: true, ...report });
});
