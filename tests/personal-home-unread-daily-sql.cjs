// SQL test for 20261118020000_personal_home_unread_daily.sql (stacked on 20261118010000_personal_home_charts.sql):
// personal_home_inbox() records the caller's latest unread count of the Cairo day, personal_home_charts() returns
// trend.unread (stored past days, live today, null for missing days), 60-day retention, no client access, rollback.
// The inbox itself is stubbed (same signature, same login rule, 'unread' from a fixture) — its body is never edited here.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..'), id = n => '30000000-0000-4000-8000-' + String(n).padStart(12, '0');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;
create table admins(id uuid primary key,name text,email text,role text,active boolean default true);
create table admin_extra_roles(admin_id uuid,role text);
create function my_admin_id() returns uuid language sql stable security definer as $$select nullif(current_setting('test.admin',true),'')::uuid$$;
create function has_role(r text) returns boolean language sql stable security definer as $$select exists(select 1 from admins where id=my_admin_id() and active and role=r) or exists(select 1 from admin_extra_roles x join admins a on a.id=x.admin_id where a.id=my_admin_id() and a.active and x.role=r)$$;
create function finance_module_allowed(m text,a text) returns boolean language sql stable security definer as $$select not has_role('accountant')$$;
create function personal_home_module_allowed(p_module text,p_action text) returns boolean language sql stable security definer as $$select finance_module_allowed(p_module,p_action)$$;
create function personal_home_tasks_allowed() returns boolean language sql stable security definer as $$select exists(select 1 from admins where id=my_admin_id() and active) and personal_home_module_allowed('tasks','view')$$;
create table task_projects(id uuid primary key,title text,manager_id uuid,archived_at timestamptz);
create table task_project_members(project_id uuid,admin_id uuid,role_name text);
create table tasks(id uuid primary key,project_id uuid not null,title text,assignee_id uuid not null,status text not null,due_at timestamptz,completed_at timestamptz,created_at timestamptz);
create table operational_task_events(id uuid primary key default gen_random_uuid(),task_id uuid,from_status text,to_status text,old_assignee_id uuid,new_assignee_id uuid,happened_at timestamptz);
create table content_items(id uuid primary key,title text,stage text,stage_history jsonb,created_at timestamptz);
create function task_can_manage_project(p_project_id uuid) returns boolean language sql stable security definer as $$
  select exists(select 1 from task_projects p where p.id=p_project_id and p.archived_at is null and finance_module_allowed('tasks','view')
   and (has_role('super_admin') or has_role('general_manager') or p.manager_id=my_admin_id()
        or exists(select 1 from task_project_members m where m.project_id=p.id and m.admin_id=my_admin_id() and m.role_name='manager')))$$;
create function task_list_visible() returns table(id uuid,project_id uuid,assignee_id uuid,assignee_name text,status text,due_at timestamptz,can_manage boolean)
 language sql stable security definer as $$
  select t.id,t.project_id,t.assignee_id,coalesce(nullif(a.name,''),a.email),t.status,t.due_at,task_can_manage_project(t.project_id)
  from tasks t join admins a on a.id=t.assignee_id
  where finance_module_allowed('tasks','view') and (task_can_manage_project(t.project_id) or t.assignee_id=my_admin_id())$$;
create table perf_fixture(admin_id uuid primary key,timed integer,on_time integer);
create function employee_task_performance(p_period text default 'month',p_from date default null,p_to date default null,p_admin uuid default null) returns jsonb
 language plpgsql stable security definer as $$begin
  if not finance_module_allowed('tasks','view') then raise exception 'ليس لديك صلاحية عرض المهام' using errcode='42501'; end if;
  return coalesce((select jsonb_build_object('period',p_period,'timed',timed,'on_time',on_time) from perf_fixture where admin_id=my_admin_id()),jsonb_build_object('period',p_period,'timed',0,'on_time',0));
 end$$;
create schema clinic_people;
create table clinic_people.people(id uuid primary key,admin_id uuid unique,full_name text,kind text default 'staff',status text default 'active',department text);
create table clinic_people.att_fixture(day date,person_id uuid,status text,excused boolean default false);
create function clinic_people.attendance_eval(p_day date,p_now timestamptz) returns table(person_id uuid,status text,excused boolean)
 language sql stable as $$select person_id,status,excused from clinic_people.att_fixture where day=p_day$$;
grant usage on schema public to authenticated,anon;`);
    // Supabase grants every new public table to the API roles by default: the migration must take that away.
    await db.exec(`alter default privileges in schema public grant all on tables to anon, authenticated;
create schema clinic_finance;
create table inbox_fixture(admin_id uuid primary key,unread integer,no_inbox boolean default false);
create function personal_home_inbox() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare f inbox_fixture; begin
  if not exists(select 1 from admins where id=my_admin_id() and active) then raise exception 'سجّل الدخول'; end if;
  select * into f from inbox_fixture where admin_id=my_admin_id();
  if f.no_inbox then raise exception 'لا يوجد صندوق' using errcode='42501'; end if;
  return jsonb_build_object('notices','[]'::jsonb,'unread',coalesce(f.unread,0),'limited',false);
end$$;
grant execute on function personal_home_inbox() to anon,authenticated;`);

    const charts010 = read('supabase/migrations/20261118010000_personal_home_charts.sql');
    const mig = read('supabase/migrations/20261118020000_personal_home_unread_daily.sql');
    const rollback = read('supabase/rollbacks/20261118020000_personal_home_unread_daily.rollback.sql');
    await assert.rejects(db.exec(mig), /20261118010000/, 'refuses to run before #550'); await db.exec('rollback');
    await db.exec(charts010); await db.exec(mig); await db.exec(mig); // repeatable: must not wrap the wrapper

    for (const [n, role, active] of [[1, 'super_admin', true], [2, 'reception', true], [3, 'approver', true], [4, 'reception', true], [5, 'reception', false]])
      await db.query('insert into admins(id,name,email,role,active) values($1,$2,$3,$4,$5)', [id(n), 'User ' + n, 'u' + n + '@example.invalid', role, active]);
    await db.query('insert into inbox_fixture values($1,3,false),($2,0,false),($3,7,false),($4,2,true)', [id(2), id(1), id(3), id(4)]);

    async function as(n) { await db.exec('reset role'); await db.query("select set_config('test.admin',$1,false)", [id(n)]); await db.exec('set role authenticated'); }
    const su = () => db.exec('reset role');
    const inbox = async () => (await db.query('select public.personal_home_inbox() r')).rows[0].r;
    const charts = async () => (await db.query('select public.personal_home_charts() r')).rows[0].r;
    const rows = async () => { await su(); return (await db.query("select admin_id,((now() at time zone 'Africa/Cairo')::date - day) ago,unread,recorded_at from personal_home_unread_daily order by admin_id,day")).rows; };
    const setUnread = async (n, v) => { await su(); await db.query('update inbox_fixture set unread=$2 where admin_id=$1', [id(n), v]); };
    const pastRow = async (n, ago, v) => { await su(); await db.query("insert into personal_home_unread_daily(admin_id,day,unread,recorded_at) values($1,(now() at time zone 'Africa/Cairo')::date - $2::integer,$3,now()-make_interval(days=>$2::integer)) on conflict(admin_id,day) do update set unread=excluded.unread", [id(n), ago, v]); };

    // shape of the change
    await su();
    const vol = (await db.query("select p.oid::regprocedure::text f,p.provolatile v from pg_proc p where p.oid in ('public.personal_home_inbox()'::regprocedure,'clinic_finance.home_inbox_before_unread_daily()'::regprocedure,'public.personal_home_charts()'::regprocedure) order by 1")).rows;
    assert.deepEqual(vol, [{ f: 'clinic_finance.home_inbox_before_unread_daily()', v: 's' }, { f: 'personal_home_charts()', v: 's' }, { f: 'personal_home_inbox()', v: 'v' }],
      'original inbox moved aside unchanged (stable), wrapper volatile, charts still stable');
    assert.match((await db.query("select prosrc s from pg_proc where oid='clinic_finance.home_inbox_before_unread_daily()'::regprocedure")).rows[0].s, /inbox_fixture/, 'the moved function is the original body, not the wrapper');

    // 1. recording: value equals the returned inbox 'unread'; latest of the day wins; unchanged value is not rewritten
    await as(2); let r = await inbox();
    assert.deepEqual(r, { notices: [], unread: 3, limited: false }, 'wrapper returns the inbox jsonb untouched');
    let x = await rows(); assert.equal(x.length, 1); assert.deepEqual([x[0].admin_id, x[0].ago, x[0].unread], [id(2), 0, 3]);
    const firstAt = x[0].recorded_at;
    await as(2); await inbox(); x = await rows(); assert.equal(+x[0].recorded_at, +firstAt, 'same value: row not rewritten');
    await setUnread(2, 5); await as(2); r = await inbox(); assert.equal(r.unread, 5);
    x = await rows(); assert.equal(x.length, 1, 'one row per account per day'); assert.equal(x[0].unread, 5, 'latest value of the day');
    await setUnread(2, 1); await as(2); await inbox(); x = await rows(); assert.equal(x[0].unread, 1, 'goes down as well as up');

    // 2. read-only transaction (PostgREST runs stable calls read-only): inbox still answers, nothing recorded
    await setUnread(2, 9); await as(2);
    await db.exec('begin read only'); r = await inbox(); await db.exec('commit');
    assert.equal(r.unread, 9); x = await rows(); assert.equal(x[0].unread, 1, 'skipped in a read-only transaction');

    // 3. inactive account: inbox refuses, nothing recorded
    await as(5); await assert.rejects(inbox, /سجّل الدخول/); x = await rows(); assert(!x.some(q => q.admin_id === id(5)));

    // 4. charts: nulls for days without a row, stored value for past days, live value for today
    await setUnread(2, 4); await as(2); r = await charts();
    assert.deepEqual(r.trend.unread, [null, null, null, null, null, null, 1], "today = today's stored row (1), not a live recompute (4); the rest null (no backfill)");
    x = await rows(); assert.equal(x.find(q => q.admin_id === id(2)).unread, 1, 'charts reads, it does not record');
    await pastRow(2, 1, 6); await pastRow(2, 3, 2); await pastRow(2, 6, 0); await pastRow(2, 7, 99);
    await as(2); r = await charts();
    assert.equal(r.trend.days.length, 7); assert.equal(r.trend.unread.length, 7);
    assert.deepEqual(r.trend.unread, [0, null, null, 2, null, 6, 1], 'aligned to trend.days; day 7 ago is outside the window; 0 is kept, not null');
    await as(2); assert.equal((await inbox()).unread, 4); await as(2); r = await charts();
    assert.equal(r.trend.unread[6], 4, "after the inbox is loaded, today's point = the value the tile showed");
    await as(1); r = await charts(); assert.deepEqual(r.trend.unread, [null, null, null, null, null, null, null], 'no recording yet: all null (the line stays hidden)');
    await as(1); await inbox(); await as(1); r = await charts(); assert.deepEqual(r.trend.unread, [null, null, null, null, null, null, 0], 'other accounts see only their own rows; 0 unread is a value');
    // charts never calls the inbox: an account whose inbox fails still gets the recorded series
    await as(4); r = await charts(); assert.deepEqual(r.trend.unread, [null, null, null, null, null, null, null]); assert(Array.isArray(r.trend.approvals));
    await as(5); await assert.rejects(charts, /سجّل الدخول/);

    // 5. retention: 60 Cairo days kept (today and the 59 before), older rows deleted when a day's first row is inserted
    await pastRow(1, 59, 1); await pastRow(1, 60, 1); await pastRow(1, 200, 1); await pastRow(2, 61, 1);
    await as(3); await inbox();
    x = await rows();
    assert.deepEqual(x.filter(q => q.admin_id === id(1)).map(q => q.ago), [59, 0], '60 and 200 days ago deleted; 59 days ago and today kept');
    assert(!x.some(q => q.ago > 59), 'retention applies to every account');
    assert.deepEqual(x.filter(q => q.admin_id === id(3)).map(q => [q.ago, q.unread]), [[0, 7]]);

    // 6. no client access to the table or to the moved inbox body
    await su();
    const priv = (await db.query(`select has_table_privilege('authenticated','public.personal_home_unread_daily','select,insert,update,delete') ua,
      has_table_privilege('anon','public.personal_home_unread_daily','select,insert,update,delete') aa,
      has_function_privilege('authenticated','clinic_finance.home_inbox_before_unread_daily()','execute') uf,
      has_function_privilege('anon','clinic_finance.home_inbox_before_unread_daily()','execute') af,
      has_function_privilege('anon','public.personal_home_inbox()','execute') ai,
      has_function_privilege('authenticated','public.personal_home_inbox()','execute') ui,
      (select relrowsecurity from pg_class where oid='public.personal_home_unread_daily'::regclass) rls`)).rows[0];
    assert.deepEqual(priv, { ua: false, aa: false, uf: false, af: false, ai: false, ui: true, rls: true });
    await as(2);
    await assert.rejects(db.query('select * from public.personal_home_unread_daily'), /permission denied/);
    await assert.rejects(db.query("insert into public.personal_home_unread_daily values($1,current_date,0,now())", [id(2)]), /permission denied/);
    await assert.rejects(db.query('select clinic_finance.home_inbox_before_unread_daily()'), /permission denied/);
    await su(); await db.exec('set role anon'); await assert.rejects(db.query('select count(*) from public.personal_home_unread_daily'), /permission denied/);

    // 7. rollback: inbox back to the original (stable, grants restored, no recording), charts back to #550, table gone
    await su(); await db.exec(rollback); await db.exec(rollback);
    const back = (await db.query("select to_regclass('public.personal_home_unread_daily') t,to_regprocedure('clinic_finance.home_inbox_before_unread_daily()') m,(select provolatile from pg_proc where oid='public.personal_home_inbox()'::regprocedure) v,has_function_privilege('authenticated','public.personal_home_inbox()','execute') g")).rows[0];
    assert.deepEqual(back, { t: null, m: null, v: 's', g: true });
    await as(2); assert.equal((await inbox()).unread, 4); r = await charts(); assert(!('unread' in r.trend), 'charts back to the #550 body');
    await su(); await db.exec(mig); await as(2); await inbox(); r = await charts();
    assert.deepEqual(r.trend.unread, [null, null, null, null, null, null, 4], 're-applied after rollback: starts again from today');
    await su(); assert.doesNotMatch((await db.query("select prosrc s from pg_proc where oid='public.personal_home_charts()'::regprocedure")).rows[0].s, /home_inbox_before_unread_daily|:=\s*public\.personal_home_inbox|perform\s+public\.personal_home_inbox/, 'charts does not recompute the inbox');
    console.log('PASS home unread daily SQL: requires #550, repeatable, wrapper returns inbox untouched, latest-of-day upsert, no rewrite when unchanged, read-only skip, inactive refused, trend.unread aligned (stored/null, today = stored row, no inbox recompute), 60-day retention, no client access, rollback + re-apply');
  } finally { await db.close(); }
})().catch(e => { console.error(e); process.exit(1); });
