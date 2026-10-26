import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Meta Insights — read-only. Hourly via pg_cron (X-Cron-Secret).
// For posts published from the dashboard in the last 60 days it reads Facebook post insights and
// Instagram media insights and stores one row per publish job in public.post_insights, which the
// "أداء البوستات" tab uses to compare formats and posting times. Never writes to Meta.
// Metric names change between Graph versions, so every metric is requested on its own and a
// metric Meta no longer offers is simply recorded as missing instead of failing the whole post.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const CRON_SECRET = Deno.env.get("META_PUBLISH_CRON_SECRET");
const GRAPH = "https://graph.facebook.com/v26.0/";
const MAX_AGE_DAYS = 60;
const BATCH = 25;

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
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
async function gget(path: string, params: Record<string, string>) {
  const u = new URL(GRAPH + path);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u.toString());
  const d = await r.json().catch(() => ({}));
  return { ok: r.ok && !d.error, data: d, error: d.error?.message as string | undefined };
}
function metricValue(entry: any): number | null {
  const v = entry?.values?.[0]?.value ?? entry?.total_value?.value;
  if (typeof v === "number") return v;
  if (v && typeof v === "object") return Object.values(v).reduce((a: number, b: any) => a + (Number(b) || 0), 0);
  return null;
}
async function metrics(objectId: string, names: string[], token: string, extra: Record<string, string> = {}) {
  const out: Record<string, number | null> = {};
  const errs: string[] = [];
  for (const name of names) {
    const r = await gget(`${objectId}/insights`, { metric: name, access_token: token, ...extra });
    if (!r.ok) { out[name] = null; errs.push(`${name}: ${r.error}`); continue; }
    out[name] = metricValue((r.data.data || [])[0]);
  }
  return { out, errs };
}
const first = (...v: (number | null | undefined)[]) => { for (const x of v) if (typeof x === "number") return x; return null; };
// Page id per brand (the reel's post id must be called as {pageId}_{postId}).
const pageIds = new Map<string, string | null>();
async function pageIdFor(brand: string, token: string): Promise<string | null> {
  if (!pageIds.has(brand)) { const me = await gget("me", { fields: "id", access_token: token }); pageIds.set(brand, me.ok && me.data.id ? String(me.data.id) : null); }
  return pageIds.get(brand) ?? null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  if (!CRON_SECRET || req.headers.get("X-Cron-Secret") !== CRON_SECRET) return json({ ok: false, error: "unauthorized" }, 401);
  const key = serviceKey();
  if (!key) return json({ ok: false, error: "MISCONFIGURED" }, 500);
  const db = createClient(SUPABASE_URL, key, { auth: { persistSession: false } });

  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 864e5).toISOString();
  const { data: jobs, error } = await db.from("meta_publish_jobs")
    .select("id,brand,content_id,published_at,facebook_post_id,instagram_media_id")
    .in("status", ["published", "partial"]).gte("published_at", cutoff);
  if (error) return json({ ok: false, error: error.message }, 500);
  const { data: existing } = await db.from("post_insights").select("job_id,synced_at");
  const last = new Map((existing || []).map((e: any) => [e.job_id, e.synced_at]));
  // Never-synced first, then the stalest.
  // Dry run (same secret): {"dry_run_job":"<meta_publish_jobs.id>"} reads that one post and returns the row WITHOUT saving it.
  const body = await req.json().catch(() => ({}));
  const dryJob = typeof body?.dry_run_job === "string" ? body.dry_run_job : "";
  const queue = dryJob ? (jobs || []).filter((j: any) => j.id === dryJob)
    : (jobs || []).sort((a: any, b: any) => String(last.get(a.id) || "").localeCompare(String(last.get(b.id) || ""))).slice(0, BATCH);
  const dryRows: unknown[] = [];

  let synced = 0;
  const report: string[] = [];
  for (const job of queue) {
    const token = pageToken(job.brand);
    if (!token) continue;
    const row: Record<string, unknown> = { job_id: job.id, brand: job.brand, content_id: job.content_id, published_at: job.published_at, synced_at: new Date().toISOString() };
    const raw: Record<string, unknown> = {};
    const errs: string[] = [];
    if (job.facebook_post_id && !String(job.facebook_post_id).includes("_")) {
      // Reels are stored by their VIDEO id (Reels API). Fixed 2026-10-26 (Mohamed's task «تصليح قراءة إحصائيات ريلز فيسبوك»):
      // - reach is NOT in video_insights any more (post_impressions_unique is rejected since v25) → read it from the reel's
      //   page post: {pageId}_{post_id}/insights?metric=post_total_media_view_unique (same metric as normal posts).
      // - counts: the bare post_id call was the "(#12) singular statuses API is deprecated" error → use {pageId}_{post_id},
      //   with video_insights (post_video_likes_by_reaction_type / post_video_social_actions) as the fallback.
      // - an error is only recorded when every source for that number failed; nothing is invented (missing = null).
      const vid = String(job.facebook_post_id);
      const vi = await gget(`${vid}/video_insights`, { access_token: token });
      const vm: Record<string, number | null> = {};
      const vobj: Record<string, Record<string, number>> = {};
      if (vi.ok) for (const e of (vi.data.data || [])) {
        vm[e.name] = metricValue(e);
        const v = e?.values?.[0]?.value;
        if (v && typeof v === "object") vobj[e.name] = v;
      }
      raw.facebook = vm;
      row.fb_views = first(vm.blue_reels_play_count, vm.fb_reels_total_plays, vm.post_video_views, vm.post_impressions);
      const viReactions = vm.post_video_likes_by_reaction_type ?? null;
      const social = vobj.post_video_social_actions || {};
      const pick = (o: Record<string, number>, k: string) => { for (const [kk, vv] of Object.entries(o)) if (kk.toUpperCase() === k) return Number(vv) || 0; return null; };
      const viComments = vi.ok ? (pick(social, "COMMENT") ?? (vm.post_video_social_actions != null ? 0 : null)) : null;
      const viShares = vi.ok ? (pick(social, "SHARE") ?? (vm.post_video_social_actions != null ? 0 : null)) : null;

      // The reel's page post (for reach + counts).
      const pageId = await pageIdFor(job.brand, token);
      const info = await gget(vid, { fields: "post_id", access_token: token });
      const postId = info.ok && info.data.post_id ? String(info.data.post_id) : null;
      const full = pageId && postId ? (postId.includes("_") ? postId : `${pageId}_${postId}`) : null;
      let postErr: string | null = !full ? ("reel post id: " + (info.error || (pageId ? "no post_id" : "no page id"))) : null;
      let reach: number | null = null, clicks: number | null = null;
      let pReactions: number | null = null, pComments: number | null = null, pShares: number | null = null;
      if (full) {
        const m = await metrics(full, ["post_total_media_view_unique", "post_clicks"], token);
        raw.facebook_post = { id: full, ...m.out };
        reach = m.out.post_total_media_view_unique ?? null;
        clicks = m.out.post_clicks ?? null;
        if (reach == null) postErr = "reel reach: " + (m.errs[0] || "empty");
        const counts = await gget(full, { fields: "reactions.summary(true).limit(0),comments.summary(true).limit(0),shares", access_token: token });
        if (counts.ok) {
          pReactions = counts.data.reactions?.summary?.total_count ?? 0;
          pComments = counts.data.comments?.summary?.total_count ?? 0;
          pShares = counts.data.shares?.count ?? 0;
        } else postErr = (postErr ? postErr + " | " : "") + "reel post counts: " + counts.error;
      }
      if (pComments == null && viComments == null) {
        const c = await gget(`${vid}/comments`, { summary: "true", limit: "0", access_token: token });
        if (c.ok) pComments = c.data.summary?.total_count ?? 0;
      }
      row.fb_reach = reach;
      row.fb_clicks = clicks;
      row.fb_reactions = first(pReactions, viReactions);
      row.fb_comments = first(pComments, viComments);
      row.fb_shares = first(pShares, viShares);
      if (!vi.ok) errs.push("fb video_insights: " + vi.error);
      if (reach == null && postErr) errs.push("fb " + postErr);
      if (row.fb_reactions == null || row.fb_comments == null) errs.push("fb reel counts: no source answered");
    } else if (job.facebook_post_id) {
      const m = await metrics(job.facebook_post_id, ["post_total_media_view_unique", "post_media_view", "post_clicks"], token);
      if (m.out.post_total_media_view_unique == null && m.out.post_media_view == null) {
        // Older metric names, for Graph versions that still serve them.
        const old = await metrics(job.facebook_post_id, ["post_impressions_unique", "post_impressions"], token);
        Object.assign(m.out, old.out); m.errs.push(...old.errs);
      }
      raw.facebook = m.out; errs.push(...m.errs.map((e) => "fb " + e));
      const counts = await gget(job.facebook_post_id, { fields: "reactions.summary(true).limit(0),comments.summary(true).limit(0),shares", access_token: token });
      row.fb_reach = first(m.out.post_total_media_view_unique, m.out.post_impressions_unique);
      row.fb_views = first(m.out.post_media_view, m.out.post_impressions);
      row.fb_clicks = m.out.post_clicks ?? null;
      if (counts.ok) {
        row.fb_reactions = counts.data.reactions?.summary?.total_count ?? 0;
        row.fb_comments = counts.data.comments?.summary?.total_count ?? 0;
        row.fb_shares = counts.data.shares?.count ?? 0;
      } else errs.push("fb counts: " + counts.error);
    }
    if (job.instagram_media_id) {
      const m = await metrics(job.instagram_media_id, ["reach", "views", "likes", "comments", "saved", "shares", "total_interactions"], token);
      raw.instagram = m.out; errs.push(...m.errs.map((e) => "ig " + e));
      row.ig_reach = m.out.reach; row.ig_views = m.out.views; row.ig_likes = m.out.likes; row.ig_comments = m.out.comments;
      row.ig_saves = m.out.saved; row.ig_shares = m.out.shares; row.ig_interactions = m.out.total_interactions;
    }
    row.raw = raw;
    row.errors = errs.length ? errs.join(" | ").slice(0, 1500) : null;
    if (dryJob) { dryRows.push(row); continue; }
    const up = await db.from("post_insights").upsert(row, { onConflict: "job_id" });
    if (up.error) report.push(up.error.message); else synced++;
    if (errs.length && report.length < 5) report.push(...errs.slice(0, 3));
  }
  if (dryJob) return json({ ok: true, dry_run: true, rows: dryRows });
  return json({ ok: true, synced, considered: queue.length, notes: report.slice(0, 10) });
});
