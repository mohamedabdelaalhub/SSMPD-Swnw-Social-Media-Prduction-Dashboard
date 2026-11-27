// 20261125040000: worker-only definer functions → service_role only; staff wrapper content_learning_brief_staff keeps working;
// lead_capture_gap refuses signed-in callers without a leads role (service / cron unchanged); re-run refused; rollback restores
// the exact previous grants (incl. the accidental PUBLIC execute) and lead_capture_gap's old body.
const fs = require('fs'), assert = require('node:assert/strict'), { PGlite } = require('@electric-sql/pglite');
const MIG = fs.readFileSync('supabase/migrations/20261125040000_definer_functions_lockdown.sql', 'utf8');
const RB = fs.readFileSync('supabase/rollbacks/20261125040000_definer_functions_lockdown.rollback.sql', 'utf8');
const U = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
const RECEP = U(101), FM = U(102), PATIENT = U(103);
(async () => {
  const db = new PGlite(), q = (s, p) => db.query(s, p || []);
  const as = async (uid, sql) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid && uid !== 'service' ? uid : ''}', false); set role ${uid === 'service' ? 'service_role' : 'authenticated'};`);
    try { return (await q(sql)).rows; } finally { await db.exec('reset role'); }
  };
  const refused = async (uid, sql, re) => { let e = null; try { await as(uid, sql); } catch (x) { e = x; } assert.ok(e, 'refused: ' + sql); if (re) assert.match(e.message, re); };
  try {
    await db.exec(`create role authenticated; create role anon; create role service_role; create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated, service_role; grant execute on function auth.uid() to authenticated, service_role;
      create table public.admins(id uuid primary key default gen_random_uuid(), user_id uuid, role text, active boolean default true);
      insert into public.admins(user_id, role) values ('${RECEP}', 'reception'), ('${FM}', 'financial_manager');
      create function public.has_any_role(p text[]) returns boolean language sql stable security definer set search_path = public as $$
        select exists (select 1 from public.admins where user_id = auth.uid() and active and role = any(p)) $$;
      create function public.my_admin_id() returns uuid language sql stable security definer set search_path = public as $$
        select id from public.admins where user_id = auth.uid() and active limit 1 $$;
      create table public.social_messages(conversation_id text, is_page boolean, sent_at timestamptz);
      create table public.leads(received_at timestamptz, current_status text, updated_at timestamptz);
      insert into public.social_messages values ('a', false, now()), ('b', false, now()); insert into public.leads values (now(), 'new', now());
      -- live-like definitions (bodies trimmed)
      create function public.clinic_reception_message_claim(p_limit integer default 10) returns jsonb language plpgsql security definer as $$ begin return '["patient"]'; end $$;
      create function public.clinic_reception_message_ack(uuid, uuid, text, text) returns jsonb language sql security definer as $$ select '{}'::jsonb $$;
      create function public.clinic_reception_agent_health() returns jsonb language sql security definer as $$ select '{"pending_messages": 3}'::jsonb $$;
      create function public.content_archive_candidates(p_limit int, p_content uuid) returns jsonb language sql security definer as $$ select '[1]'::jsonb $$;
      create function public.content_archive_pending_cleanup(p_limit int) returns jsonb language sql security definer as $$ select '[1]'::jsonb $$;
      create function public.content_learning_brief_core(p_brand text) returns jsonb language sql stable security definer as $$ select jsonb_build_object('brand', p_brand) $$;
      create function public.content_learning_brief(p_brand text) returns jsonb language sql stable security definer as $$ select public.content_learning_brief_core(p_brand) $$;
      create function public.content_learning_brief_staff(p_brand text) returns jsonb language plpgsql stable security definer set search_path = public as $$
        begin if public.my_admin_id() is null then raise exception 'Authentication required'; end if; return public.content_learning_brief(p_brand); end $$;
      create function public.digital_dashboard() returns jsonb language sql security definer as $$ select public.clinic_reception_agent_health() $$;
      create function public.lead_capture_gap(p_day date default current_date) returns table(conversations integer, leads_logged integer, gap integer, stale_leads integer)
        language sql stable security definer set search_path to 'public' as $$ select 2, 1, 1, 0 $$;
      revoke all on function public.lead_capture_gap(date) from public, anon; grant execute on function public.lead_capture_gap(date) to authenticated, service_role;
      grant execute on function public.clinic_reception_message_claim(integer) to service_role;`);
    // before: anyone signed in (a patient-portal login too) can call the worker functions
    assert.deepEqual((await as(PATIENT, 'select public.clinic_reception_message_claim(5) x'))[0].x, ['patient']);
    await db.exec(MIG);
    await assert.rejects(() => db.exec(MIG), /تم تطبيق هذا الملف من قبل/); await db.exec('rollback');

    for (const f of ['clinic_reception_message_claim(5)', "clinic_reception_message_ack(null, null, null, null)", 'clinic_reception_agent_health()',
      'content_archive_candidates(1, null)', 'content_archive_pending_cleanup(1)', "content_learning_brief('sono')", "content_learning_brief_core('sono')"]) {
      for (const u of [PATIENT, RECEP, FM]) await refused(u, 'select public.' + f, /permission denied/);
      await as('service', 'select public.' + f);
    }
    // staff paths that embed them keep working (definer wrappers)
    assert.deepEqual((await as(RECEP, "select public.content_learning_brief_staff('sono') x"))[0].x, { brand: 'sono' });
    await refused(PATIENT, "select public.content_learning_brief_staff('sono')", /Authentication required/);
    assert.deepEqual((await as(FM, 'select public.digital_dashboard() x'))[0].x, { pending_messages: 3 });
    // lead_capture_gap: leads roles + service only; real numbers
    assert.deepEqual((await as(RECEP, 'select * from public.lead_capture_gap()'))[0], { conversations: 2, leads_logged: 1, gap: 1, stale_leads: 0 });
    for (const u of [FM, PATIENT]) await refused(u, 'select * from public.lead_capture_gap()', /لفريق الليدز والإدارة بس/);
    assert.equal((await as('service', 'select * from public.lead_capture_gap()'))[0].conversations, 2);

    // rollback: previous grants back exactly (PUBLIC execute on message_claim included), old body back
    await db.exec(RB);
    assert.deepEqual((await as(PATIENT, 'select public.clinic_reception_message_claim(5) x'))[0].x, ['patient']);
    assert.deepEqual((await as(FM, 'select * from public.lead_capture_gap()'))[0], { conversations: 2, leads_logged: 1, gap: 1, stale_leads: 0 });
    assert.equal((await q("select count(*)::int n from pg_class where relname = 'definer_lockdown_saved'")).rows[0].n, 0);
    assert.equal((await q("select has_function_privilege('anon', 'public.lead_capture_gap(date)', 'EXECUTE') x")).rows[0].x, false);
    console.log('PASS definer functions lockdown: worker functions service_role only, staff wrappers intact, lead_capture_gap role check, rollback exact.');
  } catch (e) { console.error(e); process.exitCode = 1; } finally { await db.close(); }
})();
