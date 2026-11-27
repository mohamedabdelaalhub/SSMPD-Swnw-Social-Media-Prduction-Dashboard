// Migration 20261126235000 on PGlite: usage table (no content columns), checks, service_role only, monthly view with the Claude cost estimate, rollback.
const fs = require("fs"), assert = require("node:assert/strict");
(async () => {
  const { PGlite } = require("@electric-sql/pglite"); const db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  await db.exec(fs.readFileSync("supabase/migrations/20261126235000_ai_usage_log.sql", "utf8"));
  const cols = (await db.query("select column_name from information_schema.columns where table_name='ai_usage_log' order by ordinal_position")).rows.map((r) => r.column_name);
  assert.deepEqual(cols, ["id", "created_at", "fn", "provider", "model", "ok", "error_kind", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "ms", "fallback"]);
  assert(!cols.some((c) => /prompt|text|content|message|answer|reply|input$/.test(c) && !/tokens/.test(c)), "no content column");
  await db.exec(`insert into public.ai_usage_log(fn, provider, model, ok, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, ms, fallback) values
    ('meta-comments','claude','claude-sonnet-5-5',true, 1000000, 100000, 2000000, 0, 800, false),
    ('meta-comments','claude','claude-sonnet-5-5',false, 0, 0, 0, 0, 20000, false),
    ('operations-advisor','claude','claude-haiku-5-5',true, 1000000, 1000000, 0, 0, 900, false),
    ('meta-comments','openai','gpt-5.6-sol',true, 5000, 100, 0, 0, 1500, true)`);
  const v = (await db.query("select fn, provider, model, calls, failed, fallbacks, input_tokens, est_cost_usd_claude from public.ai_usage_monthly order by fn, provider")).rows;
  const sonnet = v.find((r) => r.model === "claude-sonnet-5-5"), haiku = v.find((r) => r.model === "claude-haiku-5-5"), oa = v.find((r) => r.provider === "openai");
  // sonnet: 1M in * $2 + 2M cache read * $0.10 + 0.1M out * $10 = 2 + 0.2 + 1 = $3.20
  assert.equal(Number(sonnet.est_cost_usd_claude), 3.2); assert.equal(Number(sonnet.calls), 2); assert.equal(Number(sonnet.failed), 1);
  // haiku: 1M in * $0.10 + 1M out * $0.50 = $0.60
  assert.equal(Number(haiku.est_cost_usd_claude), 0.6); assert.equal(oa.est_cost_usd_claude, null); assert.equal(Number(oa.fallbacks), 1);
  await assert.rejects(() => db.query("insert into public.ai_usage_log(fn, provider, model, ok) values ('x','gemini','m',true)"), /check/i, "provider check");
  assert.equal((await db.query("select has_table_privilege('authenticated','public.ai_usage_log','select') s, has_table_privilege('anon','public.ai_usage_log','insert') i, has_table_privilege('service_role','public.ai_usage_log','insert') w, has_table_privilege('authenticated','public.ai_usage_monthly','select') v")).rows[0].s, false);
  const g = (await db.query("select has_table_privilege('anon','public.ai_usage_log','insert') i, has_table_privilege('service_role','public.ai_usage_log','insert') w, has_table_privilege('authenticated','public.ai_usage_monthly','select') v")).rows[0];
  assert.deepEqual(g, { i: false, w: true, v: false }); assert.equal((await db.query("select relrowsecurity r from pg_class where relname='ai_usage_log'")).rows[0].r, true);
  await db.exec(fs.readFileSync("supabase/rollbacks/20261126235000_ai_usage_log.rollback.sql", "utf8"));
  assert.equal((await db.query("select count(*)::int n from pg_class where relname in ('ai_usage_log','ai_usage_monthly')")).rows[0].n, 0, "rollback clean");
  console.log("PASS ai_usage_log: no content columns, checks, RLS + service_role only, monthly Claude cost estimate (sonnet 3.20 / haiku 0.60 on the fixture), rollback clean.");
})().catch((e) => { console.error(e); process.exit(1); });
