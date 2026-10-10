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
  const queue = (jobs || []).sort((a: any, b: any) => String(last.get(a.id) || "").localeCompare(String(last.get(b.id) || ""))).slice(0, BATCH);

  let synced = 0;
  const report: string[] = [];
  for (const job of queue) {
    const token = pageToken(job.brand);
    if (!token) continue;
    const row: Record<string, unknown> = { job_id: job.id, brand: job.brand, content_id: job.content_id, published_at: job.published_at, synced_at: new Date().toISOString() };
    const raw: Record<string, unknown> = {};
    const errs: string[] = [];
    if (job.facebook_post_id && !String(job.facebook_post_id).includes("_")) {
      // Reels are stored by their VIDEO id (Reels API), which has no /insights edge and no
      // reactions field. Read /video_insights, then the reel's feed post for the counts.
      const vid = String(job.facebook_post_id);
      const vi = await gget(`${vid}/video_insights`, { access_token: token });
      const vm: Record<string, number | null> = {};
      if (vi.ok) for (const e of (vi.data.data || [])) vm[e.name] = metricValue(e);
      else errs.push("fb video_insights: " + vi.error);
      raw.facebook = vm;
      row.fb_reach = first(vm.post_impressions_unique, vm.post_total_media_view_unique);
      row.fb_views = first(vm.blue_reels_play_count, vm.fb_reels_total_plays, vm.post_video_views, vm.post_impressions);
      const info = await gget(vid, { fields: "post_id", access_token: token });
      const postId = info.ok && info.data.post_id ? String(info.data.post_id) : null;
      const counts = postId
        ? await gget(postId, { fields: "reactions.summary(true).limit(0),comments.summary(true).limit(0),shares", access_token: token })
        : await gget(vid, { fields: "likes.summary(true).limit(0),comments.summary(true).limit(0)", access_token: token });
      if (counts.ok) {
        row.fb_reactions = (counts.data.reactions ?? counts.data.likes)?.summary?.total_count ?? 0;
        row.fb_comments = counts.data.comments?.summary?.total_count ?? 0;
        row.fb_shares = counts.data.shares?.count ?? vm.post_video_social_actions_share ?? 0;
      } else errs.push("fb reel counts: " + counts.error);
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
    const up = await db.from("post_insights").upsert(row, { onConflict: "job_id" });
    if (up.error) report.push(up.error.message); else synced++;
    if (errs.length && report.length < 5) report.push(...errs.slice(0, 3));
  }
  return json({ ok: true, synced, considered: queue.length, notes: report.slice(0, 10) });
});
