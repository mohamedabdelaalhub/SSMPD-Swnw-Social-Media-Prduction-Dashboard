// Shift schedules (الورديات) — SQL rehearsal on PGlite: real HR + live-presence migrations, then the shifts migration.
// Covers: HR-only access, template validation, weekly schedule save + effective dating, evaluation (on_time / late / absent / waiting / upcoming / leave / unmapped /
// excused permission / night shift / early arrival / day off / doctor excluded), weekly counters, audit, direct table denial, second apply refused, rollback + re-apply.
const fs = require('fs'), assert = require('node:assert/strict'), boot = require('./helpers/reception-bridge.cjs');
(async () => {
  const { db, as, call, owner, id } = await boot();
  try {
    await db.exec("alter table admins alter column id set default gen_random_uuid();alter table admins add column user_id uuid;create table admin_extra_roles(admin_id uuid,role text);create or replace function public.is_super() returns boolean language sql stable as $$select has_role('super_admin')$$;");
    const file = s => fs.readFileSync('supabase/migrations/' + fs.readdirSync('supabase/migrations').find(x => x.endsWith('_' + s + '.sql')), 'utf8');
    await db.exec(file('human_resources_workspace')); await db.exec(file('live_presence')); await db.exec(file('live_presence_heartbeat')); await db.exec(file('live_presence_admin_staff_only'));
    const MIG = fs.readFileSync('supabase/migrations/20261113100000_shift_schedules.sql', 'utf8');
    await db.exec(MIG);
    await assert.rejects(() => db.exec(MIG), /تم تطبيق هذا الملف من قبل/, 'second apply refused'); await db.exec('rollback');

    await owner("insert into admins(id,name,role) values($1,'HR user','reception'),($2,'Employee 6','reception')", [id(5), id(6)]); await as(1); await owner('update admins set has_hr_access=true where id=$1', [id(5)]);
    const P = {};
    for (const [k, name, kind] of [['on', 'في الميعاد', 'employee'], ['late', 'متأخر', 'employee'], ['abs', 'غايب', 'employee'], ['lv', 'إجازة', 'employee'], ['un', 'غير مربوط', 'employee'], ['ex', 'إذن', 'employee'], ['ng', 'سهر', 'employee'], ['off', 'راحة', 'employee'], ['dr', 'دكتور', 'doctor'], ['early', 'بدري', 'employee']])
      P[k] = (await owner("insert into clinic_people.people(full_name,kind,created_by) values($1,$2,$3) returning id", [name, kind, id(1)]))[0].id;
    const D = '2026-11-09', ev = async (now, day = D) => Object.fromEntries((await owner('select * from clinic_people.attendance_eval($1::date,$2::timestamptz)', [day, now])).map(r => [r.person_id, r]));
    const tpl = payload => call('hr_shifts_command', ['template_save', payload]);

    // ---- access
    await as(6); for (const f of [() => call('hr_shifts_workspace'), () => call('hr_attendance_today'), () => tpl({ name: 'x1', start_time: '09:00', end_time: '17:00' })]) await assert.rejects(f, /تحتاج إدارة الموارد البشرية/);
    await db.exec('reset role; set role anon'); await assert.rejects(() => call('hr_attendance_today'), /permission denied/); await db.exec('reset role'); await as(5);

    // ---- templates: validation, create, edit, unique name
    await assert.rejects(() => tpl({ name: 'x', start_time: '09:00', end_time: '17:00' }), /اسم الوردية/);
    await assert.rejects(() => tpl({ name: 'صباحي', start_time: '09:00', end_time: '09:00' }), /يختلفوا/);
    await assert.rejects(() => tpl({ name: 'صباحي', start_time: 'abc', end_time: '17:00' }), /راجع وقت/);
    await assert.rejects(() => tpl({ name: 'صباحي', start_time: '09:00', end_time: '17:00', grace_minutes: 500 }), /السماح/);
    await assert.rejects(() => tpl({ name: 'صباحي', start_time: '09:00', end_time: '17:00', color: 'red' }), /لون/);
    const A = await tpl({ name: 'صباحي', start_time: '09:00', end_time: '17:00' }), N = await tpl({ name: 'ليلي', start_time: '21:00', end_time: '05:00', grace_minutes: 15, color: '#F15A22' });
    await assert.rejects(() => tpl({ name: 'صباحي', start_time: '10:00', end_time: '18:00' }), /unique|duplicate/);
    await tpl({ id: A, name: 'صباحي', start_time: '09:00', end_time: '17:00', grace_minutes: 10 });
    let w = await call('hr_shifts_workspace'); assert.equal(w.templates.length, 2); assert.equal(w.templates.find(t => t.id === N).overnight, true); assert.equal(w.templates.find(t => t.id === A).grace_minutes, 10);
    assert(!w.people.some(p => p.id === P.dr), 'doctor not listed');

    // ---- schedule_save: needs all 7 days, valid template, administrative person
    const week = (t, offDays = [5]) => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [String(d), offDays.includes(d) ? null : t]));
    const save = (p, days, from) => call('hr_shifts_command', ['schedule_save', { person_id: p, days, valid_from: from }]);
    await assert.rejects(() => save(P.on, { 0: A }), /كل أيام الأسبوع/);
    await assert.rejects(() => save(P.on, week('00000000-0000-4000-8000-000000000999')), /وردية غير موجودة/);
    await assert.rejects(() => save(P.dr, week(A)), /موظفًا إداريًا/);
    await assert.rejects(() => save(P.on, week(A), '2020-01-01'), /31 يومًا/);
    // effective-dated rows for the test day (past, inserted by the owner role); then use the RPC for "today" versioning
    for (const p of ['on', 'late', 'abs', 'lv', 'un', 'ex', 'early']) for (let d = 0; d < 7; d++) await owner('insert into clinic_people.person_shifts(person_id,dow,template_id,valid_from) values($1,$2,$3,$4)', [P[p], d, d === 5 ? null : A, '2026-11-01']);
    for (let d = 0; d < 7; d++) await owner('insert into clinic_people.person_shifts(person_id,dow,template_id,valid_from) values($1,$2,$3,$4)', [P.ng, d, N, '2026-11-01']);
    for (let d = 0; d < 7; d++) await owner('insert into clinic_people.person_shifts(person_id,dow,template_id,valid_from) values($1,$2,$3,$4)', [P.off, d, null, '2026-11-01']);
    // Monday (dow 1): 'late' also has a newer pattern that makes Monday a day off from 2026-11-10 (must not affect Nov 9)
    await owner('insert into clinic_people.person_shifts(person_id,dow,template_id,valid_from) values($1,1,null,$2)', [P.late, '2026-11-10']);
    for (const [k, uid] of [['on', 11], ['late', 12], ['abs', 13], ['lv', 14], ['ex', 16], ['ng', 17], ['early', 20]]) await owner('insert into clinic_people.device_user_map(device_id,device_user_id,person_id) values($1,$2,$3)', ['k14', uid, P[k]]);
    // punches (Cairo = UTC+2 in November)
    const pu = (uid, iso, code = 0) => owner("insert into clinic_people.device_punches(device_id,device_user_id,ts,punch) values('k14',$1,$2::timestamptz,$3)", [uid, iso, code]);
    await pu(11, '2026-11-09T08:58:00+02:00'); await pu(11, '2026-11-09T17:02:00+02:00', 1); await pu(12, '2026-11-09T09:25:00+02:00'); await pu(12, '2026-11-09T09:40:00+02:00');
    await pu(17, '2026-11-09T20:50:00+02:00'); await pu(20, '2026-11-09T06:30:00+02:00'); await pu(13, '2026-11-09T12:00:00+02:00', 1);  // an exit punch alone is not an arrival
    await owner("insert into clinic_people.requests(person_id,kind,from_date,to_date,units,note,status,created_by) values($1,'leave',$3,$3,1,'إجازة اعتيادية','approved',$2),($4,'permission',$3,$3,1,'إذن شخصي','approved',$2),($5,'leave',$3,$3,1,'إجازة لم تعتمد','pending',$2)", [P.lv, id(1), D, P.ex, P.abs]);

    // ---- evaluation at 20:00 Cairo (18:00Z): the day is over for the morning shift
    let e = await ev('2026-11-09T18:00:00Z');
    assert.equal(e[P.on].status, 'on_time'); assert.equal(e[P.on].late_min, 0);
    assert.equal(e[P.late].status, 'late'); assert.equal(e[P.late].late_min, 25, 'late minutes counted from the FIRST arrival punch');
    assert.equal(e[P.abs].status, 'absent', 'pending leave request does not excuse'); assert.equal(e[P.lv].status, 'leave');
    assert.equal(e[P.un]?.status, 'unmapped'); assert.equal(e[P.ex].status, 'absent'); assert.equal(e[P.ex].excused, true, 'approved permission is flagged');
    assert.equal(e[P.early].status, 'on_time', 'arrival 2.5h early is on time'); assert.equal(e[P.off], undefined, 'day-off-all-week person is not scheduled'); assert.equal(e[P.dr], undefined, 'doctor never evaluated');
    // night shift: arrived 20:50 (before 21:00) -> on_time once the shift started
    e = await ev('2026-11-09T19:30:00Z'); assert.equal(e[P.ng].status, 'on_time'); assert.equal(e[P.ng].grace, 15);
    assert.equal(new Date(e[P.ng].exp_end).toISOString(), '2026-11-10T03:00:00.000Z', 'night shift ends next morning 05:00 Cairo');
    // timing states for the missing arrival: upcoming -> waiting (inside grace) -> absent
    assert.equal((await ev('2026-11-09T05:00:00Z'))[P.abs].status, 'upcoming');
    assert.equal((await ev('2026-11-09T07:05:00Z'))[P.abs].status, 'waiting');
    assert.equal((await ev('2026-11-09T07:11:00Z'))[P.abs].status, 'absent'); assert.equal((await ev('2026-11-09T07:11:00Z'))[P.abs].since_start, 11);
    // pattern versioning: Nov 10 (Tuesday, dow 2) late has the normal day; Monday Nov 16 (dow 1) is a day off for 'late' (newer pattern), still a shift for others
    e = await ev('2026-11-16T18:00:00Z', '2026-11-16'); assert.equal(e[P.late], undefined, 'newer pattern makes Monday a day off'); assert.equal(e[P.on].status, 'absent');
    // Friday (dow 5) is the weekly day off for everyone with the standard pattern
    e = await ev('2026-11-13T18:00:00Z', '2026-11-13'); assert.equal(e[P.on], undefined);

    // ---- RPC: today's board has the right shape and sorts problems first (day in the past so the result is time independent)
    let b = await call('hr_attendance_today', [D]);
    assert.equal(b.day, D); assert.equal(b.has_schedule, true); assert.equal(b.unscheduled, 0, 'doctor is not counted as unscheduled');
    assert.equal(b.rows[0].status, 'absent'); assert(b.rows.every(r => r.person_id !== P.dr));
    const mine = b.rows.find(r => r.person_id === P.late); assert.equal(mine.template_name, 'صباحي'); assert.equal(mine.late_min, 25);
    assert.equal(mine.late_week, 0); // weekly counters look at the previous 6 days of the same patterns
    assert.equal(b.rows.find(r => r.person_id === P.on).absent_week >= 0, true);

    // ---- schedule_save through the RPC: effective-dated, replaces same-day rows, closes the previous pattern
    const today = (await owner("select (now() at time zone 'Africa/Cairo')::date::text d"))[0].d;
    await save(P.off, week(A, [5, 6]), today);
    w = await call('hr_shifts_workspace'); const off = w.people.find(p => p.id === P.off); assert.equal(off.days['0'], A); assert.equal(off.days['5'], null); assert.equal(off.since, today);
    await save(P.off, week(N, [4]), today); // same day again replaces, no duplicate rows
    assert.equal((await owner('select count(*)::int n from clinic_people.person_shifts where person_id=$1 and valid_from=$2::date', [P.off, today]))[0].n, 7);
    assert.equal((await owner('select count(*)::int n from clinic_people.person_shifts where person_id=$1 and valid_to is null and dow=0', [P.off]))[0].n, 1, 'one open pattern per day');
    assert.equal((await owner('select valid_to::text v from clinic_people.person_shifts where person_id=$1 and dow=0 and valid_from=$2', [P.off, '2026-11-01']))[0].v, new Date(new Date(today) - 864e5).toISOString().slice(0, 10), 'previous pattern closed the day before');
    // deactivated template cannot be scheduled
    await tpl({ id: N, name: 'ليلي', start_time: '21:00', end_time: '05:00', grace_minutes: 15, active: false });
    await assert.rejects(() => save(P.on, week(N), today), /متوقفة|غير موجودة/);

    // ---- audit
    const au = await owner("select action, actor_id from clinic_people.audit where action in ('shift_template','shift_schedule')");
    assert(au.length >= 5 && au.every(a => a.actor_id === id(5)));

    // ---- direct table / function access denied
    for (const r of ['authenticated', 'anon']) {
      await db.exec('reset role; set role ' + r);
      await assert.rejects(() => db.query('select * from clinic_people.shift_templates'), /permission denied/);
      await assert.rejects(() => db.query('select * from clinic_people.person_shifts'), /permission denied/);
      await assert.rejects(() => db.query("select * from clinic_people.attendance_eval(current_date, now())"), /permission denied/);
    }
    await db.exec('reset role');

    // ---- rollback leaves HR + presence intact and re-apply works
    await db.exec(fs.readFileSync('supabase/rollbacks/20261113100000_shift_schedules.rollback.sql', 'utf8'));
    assert.equal((await owner("select to_regclass('clinic_people.person_shifts') r"))[0].r, null); assert(await owner("select to_regclass('clinic_people.device_punches') r"));
    await as(5); assert((await call('hr_presence_snapshot')).rows !== undefined); await db.exec('reset role');
    await db.exec('reset role'); await db.exec(MIG); await as(5); assert.equal((await call('hr_shifts_workspace')).templates.length, 0);
    console.log('hr-shifts-sql OK');
  } finally { await db.close?.(); }
})().catch(e => { console.error(e); process.exit(1); });
