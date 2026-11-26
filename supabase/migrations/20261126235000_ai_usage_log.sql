-- One row per AI call of the edge functions (Claude / OpenAI): function, provider, model, token counts, time, ok/error kind.
-- NO prompt text, NO answers, NO customer data. Written by the functions with the service key (_shared/llm.ts); read by the owner/Main chats.
-- Rollback: supabase/rollbacks/20261126235000_ai_usage_log.rollback.sql
begin;
create table if not exists public.ai_usage_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  fn text not null check (char_length(fn) between 1 and 80),
  provider text not null check (provider in ('claude', 'openai')),
  model text not null check (char_length(model) between 1 and 120),
  ok boolean not null,
  error_kind text,
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cache_read_tokens integer not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  ms integer not null default 0,
  fallback boolean not null default false
);
create index if not exists ai_usage_log_created_idx on public.ai_usage_log (created_at desc);
create index if not exists ai_usage_log_fn_idx on public.ai_usage_log (fn, created_at desc);
alter table public.ai_usage_log enable row level security;
revoke all on public.ai_usage_log from public, anon, authenticated;
grant insert, select on public.ai_usage_log to service_role;

-- Monthly summary with an ESTIMATED cost for the Claude models (list prices per million tokens; cache reads at 10% of input,
-- cache writes at 125%). OpenAI rows show tokens only (price not tracked here). Read-only; service role / owner queries.
create or replace view public.ai_usage_monthly as
select date_trunc('month', created_at) as month, fn, provider, model,
       count(*) as calls, count(*) filter (where not ok) as failed, count(*) filter (where fallback) as fallbacks,
       sum(input_tokens) as input_tokens, sum(output_tokens) as output_tokens, sum(cache_read_tokens) as cache_read_tokens, sum(cache_write_tokens) as cache_write_tokens,
       round((sum(case when provider = 'claude' then
         (input_tokens * (case model when 'claude-haiku-5-5' then 0.10 when 'claude-sonnet-5-5' then 2.0 when 'claude-opus-5-5' then 4.0 else 2.0 end)
          + cache_read_tokens * (case model when 'claude-haiku-5-5' then 0.01 when 'claude-sonnet-5-5' then 0.10 when 'claude-opus-5-5' then 0.20 else 0.10 end)
          + cache_write_tokens * (case model when 'claude-haiku-5-5' then 0.125 when 'claude-sonnet-5-5' then 2.5 when 'claude-opus-5-5' then 5.0 else 2.5 end)
          + output_tokens * (case model when 'claude-haiku-5-5' then 0.50 when 'claude-sonnet-5-5' then 10.0 when 'claude-opus-5-5' then 20.0 else 10.0 end)) / 1000000.0
         end))::numeric, 4) as est_cost_usd_claude
  from public.ai_usage_log group by 1, 2, 3, 4;
revoke all on public.ai_usage_monthly from public, anon, authenticated;
grant select on public.ai_usage_monthly to service_role;
commit;
