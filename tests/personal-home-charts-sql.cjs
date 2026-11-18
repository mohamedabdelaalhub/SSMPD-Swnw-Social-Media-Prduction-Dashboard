// SQL test for public.personal_home_charts() (migration 20261118010000): shapes, permission gating, omission and the
// honest reconstruction of the 7-day trend from operational_task_events / content_items.stage_history.
// The live helpers it relies on (task_list_visible, task_can_manage_project, personal_home_tasks_allowed, employee_task_performance,
// clinic_people.attendance_eval) are stubbed here with the same signatures and the same rules that matter to this RPC.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..'), id = n => '30000000-0000-4000-8000-' + String(n).padStart(12, '0');

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

    const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20261118010000_personal_home_charts.sql'), 'utf8');
    await db.exec(sql); await db.exec(sql); // repeatable

    // 1 super admin, 2 reception (linked person, schedule), 3 approver, 4 accountant (tasks denied), 5 inactive
    for (const [n, role, active] of [[1, 'super_admin', true], [2, 'reception', true], [3, 'approver', true], [4, 'accountant', true], [5, 'reception', false]])
      await db.query('insert into admins(id,name,email,role,active) values($1,$2,$3,$4,$5)', [id(n), 'User ' + n, 'u' + n + '@example.invalid', role, active]);
    await db.query("insert into clinic_people.people(id,admin_id,full_name,department) values($1,$2,'P2','reception'),($3,$4,'P1','management')", [id(90), id(2), id(91), id(1)]);
    await db.query("update clinic_people.people set status='ended' where id=$1", [id(91)]);
    await db.query('insert into perf_fixture values($1,4,3),($2,0,0)', [id(2), id(1)]);

    // Cairo-day helper: noon of (today - k) as timestamptz
    const noon = k => `((((now() at time zone 'Africa/Cairo')::date - ${k}) + time '12:00') at time zone 'Africa/Cairo')`;
    const old = "now()-interval '10 days'";
    await db.exec(`insert into task_projects values('${id(10)}','P','${id(1)}',null),('${id(11)}','old','${id(1)}',now()-interval '20 days'),('${id(12)}','closed yesterday','${id(1)}',${noon(1)});`);
    const T = (n, proj, who, st, due, created = old, done = 'null') => db.exec(`insert into tasks values('${id(n)}','${id(proj)}','t${n}','${id(who)}','${st}',${due},${done},${created})`);
    await T(21, 10, 2, 'todo', "now()-interval '1 day'");                    // open all week, late
    await T(22, 10, 2, 'done', "now()-interval '5 days'", old, noon(3));     // done today-3
    await T(23, 10, 2, 'review', "now()-interval '2 hours'");                // submitted today-1
    await T(24, 10, 2, 'blocked', "now()-interval '1 day'");                 // reassigned 1 -> 2 today-2
    await T(25, 10, 2, 'todo', "now()+interval '3 days'", noon(1));          // created today-1
    await T(26, 10, 2, 'cancelled', 'null');                                  // cancelled today-5
    await T(27, 10, 2, 'done', 'null', old, noon(2));                        // done with no event (pre-trigger style)
    await T(28, 10, 3, 'todo', "now()+interval '3 days'");                   // approver's own task
    await T(29, 11, 2, 'todo', 'null');                                       // project archived long ago
    await T(30, 12, 2, 'todo', 'null');                                       // project archived yesterday noon
    const E = (task, from, to, oldA, newA, at) => db.exec(`insert into operational_task_events(task_id,from_status,to_status,old_assignee_id,new_assignee_id,happened_at) values('${id(task)}','${from}','${to}','${id(oldA)}','${id(newA)}',${at})`);
    await E(22, 'in_progress', 'done', 2, 2, noon(3));
    await E(23, 'todo', 'review', 2, 2, noon(1));
    await E(24, 'in_progress', 'blocked', 1, 2, noon(2));
    await E(26, 'todo', 'cancelled', 2, 2, noon(5));
    const H = (...xs) => `jsonb_build_array(${xs.map(([s, at]) => `jsonb_build_object('stage','${s}','at',${at})`).join(',')})`;
    await db.exec(`insert into content_items values
     ('${id(40)}','c1','in_design',${H(['idea_selection', old], ['initial_approval', noon(4)], ['in_design', noon(2)])},${old}),
     ('${id(41)}','c2','final_approval',${H(['in_design', old], ['final_approval', noon(1)])},${old}),
     ('${id(42)}','c3 legacy, no history','initial_approval',null,${old});`);

    // attendance for person P2 (reception): verdicts by day offset
    const att = [[0, 'on_time'], [1, 'late'], [2, 'leave'], [3, 'absent', true], [4, 'absent'], [5, 'upcoming'], [6, 'unmapped'], [20, 'on_time'], [40, 'late'], [100, 'on_time']];
    for (const [k, st, ex] of att) await db.exec(`insert into clinic_people.att_fixture values((now() at time zone 'Africa/Cairo')::date - ${k},'${id(90)}','${st}',${!!ex})`);

    async function as(n) { await db.exec('reset role'); await db.query("select set_config('test.admin',$1,false)", [id(n)]); await db.exec('set role authenticated'); }
    const charts = async () => (await db.query('select public.personal_home_charts() r')).rows[0].r;
    const keys = o => Object.keys(o).sort();

    // expected days
    const today = (await db.query("select to_char((now() at time zone 'Africa/Cairo')::date,'YYYY-MM-DD') d")).rows[0].d;
    const dayN = s => Math.floor(Date.parse(s + 'T00:00:00Z') / 864e5), toS = n => new Date(n * 864e5).toISOString().slice(0, 10), t0 = dayN(today);
    const days = [6, 5, 4, 3, 2, 1, 0].map(k => toS(t0 - k));

    // super admin: manager of everything
    await as(1); let r = await charts();
    assert.deepEqual(keys(r), ['tasks', 'trend'], 'no my_month: linked person ended and no timed task');
    assert.deepEqual(keys(r.trend), ['approvals', 'days', 'mine_open', 'team_open'], 'unread is never returned');
    assert.deepEqual(r.trend.days, days);
    assert.deepEqual(r.trend.mine_open, [1, 1, 1, 1, 0, 0, 0], 'reassigned task counted for the old assignee until the event');
    assert.deepEqual(r.trend.team_open, [8, 7, 7, 6, 5, 5, 5], 'creation, done, cancel, done-without-event and archive time respected');
    assert.deepEqual(r.trend.approvals, [1, 1, 2, 2, 1, 3, 3], 'task reviews + content approval stages per day');
    assert.deepEqual(r.tasks.team_load, [
      { assignee_id: id(2), assignee_name: 'User 2', department: 'reception', open: 4, late: 1, blocked: 1 },
      { assignee_id: id(3), assignee_name: 'User 3', department: null, open: 1, late: 0, blocked: 0 }], 'grouped, ordered, archived excluded, blocked and review not late');

    // reception employee: own work only
    await as(2); r = await charts();
    assert.deepEqual(keys(r), ['my_month', 'trend'], 'no team section for a non-manager');
    assert.deepEqual(keys(r.trend), ['approvals', 'days', 'mine_open']);
    assert.deepEqual(r.trend.mine_open, [6, 5, 5, 4, 4, 4, 4]);
    assert.equal(r.trend.mine_open[6], 4, "today's value = snapshot open (todo + review + blocked + new todo)");
    assert.deepEqual(r.trend.approvals, [0, 0, 0, 0, 0, 0, 0]);
    // expected attendance with the HR reports' rules
    const cls = { on_time: [1, 1], late: [1, 0], absent: [1, 0], leave: [0, 0], upcoming: [0, 0], unmapped: [0, 0] };
    const rows = att.map(([k, st, ex]) => ({ d: t0 - k, c: st === 'absent' && ex ? 0 : cls[st][0], ok: st === 'absent' && ex ? 0 : cls[st][1] }));
    const pct = (lo, hi) => { const x = rows.filter(q => q.d >= lo && q.d <= hi), c = x.reduce((s, q) => s + q.c, 0); return c ? Math.round(100 * x.reduce((s, q) => s + q.ok, 0) / c) : null; };
    const monthStart = dayN(today.slice(0, 8) + '01'), dow = (new Date(t0 * 864e5).getUTCDay() + 6) % 7, monday = t0 - dow;
    const expMonth = pct(monthStart, t0), weekly = [7, 6, 5, 4, 3, 2, 1, 0].map(k => pct(monday - 7 * k, monday - 7 * k + 6));
    const expected = { tasks_on_time_pct: 75, weekly_commitment: weekly };
    if (expMonth != null) expected.commitment_pct = expMonth;
    assert.deepEqual(r.my_month, expected, 'leave / excused / upcoming / unmapped not counted; late and absent count against');
    assert.equal(r.my_month.weekly_commitment.length, 8);
    assert(r.my_month.weekly_commitment.includes(null), 'weeks with no schedule are null');

    // approver without team: content approvals, own task
    await as(3); r = await charts();
    assert.deepEqual(keys(r), ['trend'], 'no linked person and no timed task: my_month omitted');
    assert.deepEqual(r.trend.mine_open, [1, 1, 1, 1, 1, 1, 1]);
    assert.deepEqual(r.trend.approvals, [1, 1, 2, 2, 1, 2, 2], 'content approval only (no task reviews without management)');

    // a project member with the manager role manages that project's team
    await db.exec('reset role'); await db.query("insert into task_project_members values($1,$2,'manager')", [id(10), id(3)]);
    await as(3); r = await charts();
    assert.equal(r.tasks.team_load.length, 2); assert.deepEqual(r.trend.team_open, [7, 6, 6, 5, 4, 5, 5], 'only the managed project (not the one archived yesterday)');
    assert.deepEqual(r.trend.approvals, [1, 1, 2, 2, 1, 3, 3]);

    // tasks module denied: only the content-based approvals series
    await as(4); r = await charts();
    assert.deepEqual(keys(r), ['trend']); assert.deepEqual(keys(r.trend), ['approvals', 'days']);

    // inactive account and anon are refused
    await as(5); await assert.rejects(charts, /سجّل الدخول/);
    await db.exec('reset role;set role anon'); await assert.rejects(charts, /permission denied/);
    await db.exec('reset role');
    const grants = (await db.query("select has_function_privilege('anon','public.personal_home_charts()','execute') a,has_function_privilege('authenticated','public.personal_home_charts()','execute') u")).rows[0];
    assert.deepEqual(grants, { a: false, u: true });

    // rollback file removes it cleanly
    await db.exec(fs.readFileSync(path.join(root, 'supabase/rollbacks/20261118010000_personal_home_charts.rollback.sql'), 'utf8'));
    assert.equal((await db.query("select to_regprocedure('public.personal_home_charts()') f")).rows[0].f, null);
    console.log('PASS home charts SQL: team_load shape/order/gating, 7-day trend from events and stage history (reassign, done, cancel, archive, legacy), approvals mirror, unread omitted, my_month HR aggregation and omission, tasks-denied, inactive/anon denial, rollback');
  } finally { await db.close(); }
})().catch(e => { console.error(e); process.exit(1); });
