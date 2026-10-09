-- Comment/author links + post performance (insights) — CONTENT dashboard project uuijfbpgvtdxgaosqpxo.
-- Requires 20261009_social_comments.sql. meta-insights (hourly) fills post_insights; staff with
-- the publishing roles read it in the "أداء البوستات" tab.
alter table public.social_comments add column if not exists comment_url text;
alter table public.social_comments add column if not exists author_url text;

create table if not exists public.post_insights (
 job_id uuid primary key,
 brand text not null,
 content_id uuid references public.content_items(id) on delete set null,
 published_at timestamptz,
 fb_reach int, fb_views int, fb_clicks int, fb_reactions int, fb_comments int, fb_shares int,
 ig_reach int, ig_views int, ig_likes int, ig_comments int, ig_saves int, ig_shares int, ig_interactions int,
 raw jsonb not null default '{}'::jsonb,
 errors text,
 synced_at timestamptz not null default now()
);
alter table public.post_insights enable row level security;
drop policy if exists post_insights_read on public.post_insights;
create policy post_insights_read on public.post_insights for select to authenticated using (public.social_comments_access());
grant select on public.post_insights to authenticated;

-- Per-post comment counts so meta-comments only re-reads posts whose comments changed.
create table if not exists public.social_comment_watch (
 post_ref text primary key,
 platform text not null,
 brand text not null,
 last_count int,
 checked_at timestamptz not null default now()
);
alter table public.social_comment_watch enable row level security;
