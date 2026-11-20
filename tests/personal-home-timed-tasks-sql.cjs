// SQL test for 20261118030000_personal_home_charts_timed_tasks.sql (stacked on 20261118020000, PR #551):
// my_month.timed_tasks = employee_task_performance('month').timed (0 included), tasks_on_time_pct still omitted at 0,
// and nothing else in personal_home_charts() changes. Rollback restores the #551 body.
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
    const m010 = read('supabase/migrations/20261118010000_personal_home_charts.sql');
    const m020 = read('supabase/migrations/20261118020000_personal_home_unread_daily.sql');
    const m030 = read('supabase/migrations/20261118030000_personal_home_charts_timed_tasks.sql');
    const rb030 = read('supabase/rollbacks/20261118030000_personal_home_charts_timed_tasks.rollback.sql');
    await db.exec(m010);
    await assert.rejects(db.exec(m030), /20261118020000/, 'refuses to run before #551'); await db.exec('rollback');
    await db.exec(m020);

    // 1 super admin (0 timed), 2 reception (4 timed, 3 on time, linked person with attendance), 3 approver (no perf row),
    // 4 accountant (tasks module denied), 5 inactive
    for (const [n, role, active] of [[1, 'super_admin', true], [2, 'reception', true], [3, 'approver', true], [4, 'accountant', true], [5, 'reception', false]])
      await db.query('insert into admins(id,name,email,role,active) values($1,$2,$3,$4,$5)', [id(n), 'User ' + n, 'u' + n + '@example.invalid', role, active]);
    await db.query('insert into perf_fixture values($1,4,3),($2,0,0)', [id(2), id(1)]);
    await db.query("insert into clinic_people.people(id,admin_id,full_name,department) values($1,$2,'P2','reception')", [id(90), id(2)]);
    await db.exec(`insert into clinic_people.att_fixture values((now() at time zone 'Africa/Cairo')::date,'${id(90)}','on_time',false),((now() at time zone 'Africa/Cairo')::date - 1,'${id(90)}','late',false);`);
    await db.query('insert into inbox_fixture values($1,3,false)', [id(2)]);

    async function as(n) { await db.exec('reset role'); await db.query("select set_config('test.admin',$1,false)", [id(n)]); await db.exec('set role authenticated'); }
    const charts = async () => (await db.query('select public.personal_home_charts() r')).rows[0].r;
    const snap = async () => { const o = {}; for (const n of [1, 2, 3, 4]) { await as(n); o[n] = await charts(); } await db.exec('reset role'); return o; };

    const before = await snap();
    await db.exec(m030); await db.exec(m030); // repeatable
    const after = await snap();

    assert.deepEqual(after[2].my_month, { ...before[2].my_month, timed_tasks: 4 }, 'timed_tasks added next to tasks_on_time_pct');
    assert.equal(after[2].my_month.tasks_on_time_pct, 75); assert.equal(after[2].my_month.timed_tasks, 4, 'the same row: 3 on time of 4 timed');
    assert.equal(before[1].my_month, undefined);
    assert.deepEqual(after[1].my_month, { timed_tasks: 0 }, 'timed_tasks 0 is returned; tasks_on_time_pct omitted at 0');
    assert.deepEqual(after[3].my_month, { timed_tasks: 0 }, 'no performance row: 0 timed, no pct');
    assert.equal(after[4].my_month, undefined, 'tasks module denied: no performance row, no timed_tasks');
    for (const n of [1, 2, 3, 4]) {
      const strip = o => { const c = JSON.parse(JSON.stringify(o)); if (c.my_month) { delete c.my_month.timed_tasks; if (!Object.keys(c.my_month).length) delete c.my_month; } return c; };
      assert.deepEqual(strip(after[n]), before[n], 'nothing else changes for account ' + n);
    }
    await as(5); await assert.rejects(charts, /سجّل الدخول/);
    await db.exec('reset role');
    const g = (await db.query("select has_function_privilege('anon','public.personal_home_charts()','execute') a,has_function_privilege('authenticated','public.personal_home_charts()','execute') u,(select provolatile from pg_proc where oid='public.personal_home_charts()'::regprocedure) v")).rows[0];
    assert.deepEqual(g, { a: false, u: true, v: 's' });

    // rollback restores the #551 body exactly
    await db.exec(rb030); await db.exec(rb030);
    assert.deepEqual(await snap(), before, 'rollback = #551 output');
    const body = q => db.query("select prosrc s from pg_proc where oid='public.personal_home_charts()'::regprocedure").then(r => r.rows[0].s);
    const b551 = await body(); await db.exec(m020); assert.equal(await body(), b551, 'rollback body is byte-identical to #551');
    console.log('PASS home charts timed_tasks SQL: requires #551, repeatable, my_month.timed_tasks from the same performance row (0 included), pct omitted at 0, tasks-denied omitted, nothing else changed, grants, rollback = #551 body');
  } finally { await db.close(); }
})().catch(e => { console.error(e); process.exit(1); });
