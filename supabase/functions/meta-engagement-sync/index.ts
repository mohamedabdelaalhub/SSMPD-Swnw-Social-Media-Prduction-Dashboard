import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
// Meta Engagement Sync — read-only.
//
// Called every 30 minutes by pg_cron (pg_net timeout 150 s — a run takes ~10 s) (net.http_post, X-Cron-Secret header —
// same secret already used by meta-publish-process). For each recently
// published Facebook post it does ONE Graph API GET call (likes/comments/
// shares summary counts) and stores the numbers on meta_publish_jobs so the
// dashboard can show them next to the post.
//
// This function NEVER calls a Meta write endpoint (no POST/DELETE to Graph
// API) — it only reads public engagement counts for posts this same system
// already published. No Meta Ads objects are touched at all.
// Platform JWT verification is off: pg_cron sends only X-Cron-Secret, checked below.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const CRON_SECRET = Deno.env.get("META_PUBLISH_CRON_SECRET");
const GRAPH_VERSION = "v26.0";
// How many posts to refresh per run — keeps each run well under the Edge
// Function time limit and under Graph API rate limits. At every 30 minutes
// this still refreshes every active post multiple times a day.
const BATCH_SIZE = 30;
// Stop refreshing a post once it's this old — organic engagement on Page
// posts is overwhelmingly front-loaded in the first ~30 days.
const MAX_POST_AGE_DAYS = 45;
function getServiceRoleKey() {
  const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretKeysRaw) {
    try {
      const parsed = JSON.parse(secretKeysRaw);
      if (parsed && typeof parsed === "object" && typeof parsed["default"] === "string" && parsed["default"]) {
        return parsed["default"];
      }
    } catch  {
    // fall through to legacy key
    }
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  return null;
}
const SERVICE_ROLE_KEY = getServiceRoleKey();
// Same per-brand page token secrets meta-publish-process already uses.
// Reused as-is — no new secrets needed for this function.
function pageTokenForBrand(brand) {
  if (brand === "sono") return Deno.env.get("META_PAGE_TOKEN_SONO") || null;
  if (brand === "dr_dina") return Deno.env.get("META_PAGE_TOKEN_DR_DINA") || null;
  return null;
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
// 2026-11-12 fix: photos and videos are stored by their photo/video id (no "_"). Those nodes have no
// "shares" field, so the old single query failed for them every run. Resolve them to their Page post first
// (video.post_id / photo.page_story_id); if there is none, read likes/comments from the node itself.
async function graphGet(id, fields, token) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${id}`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", token);
  const res = await fetch(url.toString());
  const data = await res.json().catch(()=>({}));
  return { ok: res.ok && !data.error, data };
}
const FULL = "likes.summary(true).limit(0),comments.summary(true).limit(0),shares";
const NO_SHARES = "likes.summary(true).limit(0),comments.summary(true).limit(0)";
async function fetchEngagement(postId, token) {
  let target = String(postId), fields = FULL;
  if (!target.includes("_")) {
    const r = await graphGet(target, "post_id,page_story_id", token);
    const pagePost = r.ok ? (r.data.post_id || r.data.page_story_id) : null;
    if (pagePost) target = String(pagePost).includes("_") ? String(pagePost) : target;
    if (!String(target).includes("_")) fields = NO_SHARES;
  }
  let r = await graphGet(target, fields, token);
  if (!r.ok && fields === FULL) r = await graphGet(target, NO_SHARES, token);
  if (!r.ok) return { ok: false, error: r.data.error?.message || "Graph error" };
  return {
    ok: true,
    likes: r.data.likes?.summary?.total_count ?? 0,
    comments: r.data.comments?.summary?.total_count ?? 0,
    shares: r.data.shares?.count ?? 0
  };
}
Deno.serve(async (req)=>{
  if (req.method !== "POST") return json({
    ok: false,
    error: "POST only"
  }, 405);
  if (!CRON_SECRET || req.headers.get("X-Cron-Secret") !== CRON_SECRET) {
    return json({
      ok: false,
      error: "unauthorized"
    }, 401);
  }
  if (!SERVICE_ROLE_KEY) return json({
    ok: false,
    error: "MISCONFIGURED: no service role key"
  }, 500);
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const cutoff = new Date(Date.now() - MAX_POST_AGE_DAYS * 24 * 60 * 60 * 1000).toISOString();
  // Oldest-synced-first (nulls first) so every eligible post gets a turn
  // across runs instead of the same handful being refreshed every time.
  const { data: jobs, error } = await admin.from("meta_publish_jobs").select("id, brand, facebook_post_id").not("facebook_post_id", "is", null).in("status", [
    "published",
    "partial"
  ]).gte("published_at", cutoff).order("engagement_last_synced_at", {
    ascending: true,
    nullsFirst: true
  }).limit(BATCH_SIZE);
  if (error) return json({
    ok: false,
    error: error.message
  }, 500);
  let synced = 0, skipped = 0, failed = 0;
  for (const job of jobs || []){
    const token = pageTokenForBrand(job.brand);
    if (!token || !job.facebook_post_id) {
      skipped++;
      continue;
    }
    const result = await fetchEngagement(job.facebook_post_id, token);
    if (!result.ok) {
      // Still stamp the attempt so a post that keeps failing goes to the back of the queue
      // instead of blocking the same 30 slots on every run (the bug since 2026-11-03).
      await admin.from("meta_publish_jobs").update({ engagement_last_synced_at: new Date().toISOString() }).eq("id", job.id);
      failed++;
      continue;
    }
    await admin.from("meta_publish_jobs").update({
      facebook_likes_count: result.likes,
      facebook_comments_count: result.comments,
      facebook_shares_count: result.shares,
      engagement_last_synced_at: new Date().toISOString()
    }).eq("id", job.id);
    synced++;
  }
  return json({
    ok: true,
    synced,
    skipped,
    failed,
    considered: (jobs || []).length
  });
});
