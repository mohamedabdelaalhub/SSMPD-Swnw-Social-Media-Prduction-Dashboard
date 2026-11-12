// Attendance reports (تاب «التقارير») — SQL rehearsal on PGlite: real HR + live-presence + shifts migrations, then 20261113110000_attendance_reports.sql.
// Covers: HR-only access (employee, anon), argument validation, 366-day limit, clamp to today, per-day verdicts that match clinic_people.attendance_eval
// (on_time / late / absent / leave / excused / unmapped), weekly day off (no row), night shift crossing midnight, early leave, overtime, incomplete punch,
// doctors and ended people excluded, people meta, second apply refused, rollback + re-apply.
const fs = require('fs'), assert = require('node:assert/strict'), boot = require('./helpers/reception-bridge.cjs');
(async () => {
  const { db, as, call, owner, id } = await boot();
  try {
    await db.exec("alter table admins alter column id set default gen_random_uuid();alter table admins add column user_id uuid;create table admin_extra_roles(admin_id uuid,role text);create or replace function public.is_super() returns boolean language sql stable as $$select has_role('super_admin')$$;");
    const file = s => fs.readFileSync('supabase/migrations/' + fs.readdirSync('supabase/migrations').find(x => x.endsWith('_' + s + '.sql')), 'utf8');
    for (const f of ['human_resources_workspace', 'live_presence', 'live_presence_heartbeat', 'live_presence_admin_staff_only', 'shift_schedules']) await db.exec(file(f));
    const MIG = fs.readFileSync('supabase/migrations/20261113110000_attendance_reports.sql', 'utf8');
    await db.exec(MIG);
    await assert.rejects(() => db.exec(MIG), /تم تطبيق هذا الملف من قبل/, 'second apply refused'); await db.exec('rollback');

    await owner("insert into admins(id,name,role) values($1,'HR user','reception'),($2,'Employee 6','reception')", [id(5), id(6)]); await as(1); await owner('update admins set has_hr_access=true where id=$1', [id(5)]);
    const P = {};
    for (const [k, name, kind] of [['on', 'في الميعاد', 'employee'], ['late', 'متأخر', 'employee'], ['abs', 'غايب', 'employee'], ['lv', 'إجازة', 'employee'], ['un', 'غير مربوط', 'employee'], ['ex', 'إذن', 'employee'], ['ng', 'سهر', 'employee'], ['inc', 'ناقص', 'employee'], ['dr', 'دكتور', 'doctor'], ['gone', 'منتهي', 'employee']])
      P[k] = (await owner("insert into clinic_people.people(full_name,kind,department,created_by) values($1,$2,'الاستقبال',$3) returning id", [name, kind, id(1)]))[0].id;
    await owner("update clinic_people.people set status='ended' where id=$1", [P.gone]);
    await as(5);
    const tpl = payload => call('hr_shifts_command', ['template_save', payload]);
    const A = await tpl({ name: 'صباحي', start_time: '09:00', end_time: '17:00' }), N = await tpl({ name: 'ليلي', start_time: '21:00', end_time: '05:00', grace_minutes: 15, color: '#F15A22' });
    // weekly pattern: Friday (dow 5) is the day off for everyone; the night worker works every day
    for (const p of ['on', 'late', 'abs', 'lv', 'un', 'ex', 'inc', 'dr', 'gone']) for (let d = 0; d < 7; d++) await owner('insert into clinic_people.person_shifts(person_id,dow,template_id,valid_from) values($1,$2,$3,$4)', [P[p], d, d === 5 ? null : A, '2026-11-01']);
    for (let d = 0; d < 7; d++) await owner('insert into clinic_people.person_shifts(person_id,dow,template_id,valid_from) values($1,$2,$3,$4)', [P.ng, d, N, '2026-11-01']);
    for (const [k, uid] of [['on', 11], ['late', 12], ['abs', 13], ['lv', 14], ['ex', 16], ['ng', 17], ['inc', 18]]) await owner('insert into clinic_people.device_user_map(device_id,device_user_id,person_id) values($1,$2,$3)', ['k14', uid, P[k]]);
    const pu = (uid, iso, code = 0) => owner("insert into clinic_people.device_punches(device_id,device_user_id,ts,punch) values('k14',$1,$2::timestamptz,$3)", [uid, iso, code]);
    // Thu Nov 5: on-time with overtime; Mon Nov 9: late 25 min and early leave 30 min; night shift Mon Nov 9 20:50 -> Tue 05:05 (overtime 5 across midnight)
    await pu(11, '2026-11-05T08:55:00+02:00'); await pu(11, '2026-11-05T17:40:00+02:00', 1);
    await pu(12, '2026-11-09T09:25:00+02:00'); await pu(12, '2026-11-09T16:30:00+02:00', 1);
    await pu(11, '2026-11-09T08:58:00+02:00'); await pu(11, '2026-11-09T17:02:00+02:00', 1);
    await pu(17, '2026-11-09T20:50:00+02:00'); await pu(17, '2026-11-10T05:05:00+02:00', 1);
    await pu(18, '2026-11-09T09:00:00+02:00'); // arrival, never left
    await owner("insert into clinic_people.requests(person_id,kind,from_date,to_date,units,note,status,created_by) values($1,'leave','2026-11-08','2026-11-08',1,'إجازة','approved',$3),($2,'permission','2026-11-09','2026-11-09',1,'إذن','approved',$3)", [P.lv, P.ex, id(5)]);

    // ---- access + validation
    await as(6); await assert.rejects(() => call('hr_attendance_range', ['2026-11-05', '2026-11-09']), /تحتاج إدارة الموارد البشرية/);
    await db.exec('reset role; set role anon'); await assert.rejects(() => call('hr_attendance_range', ['2026-11-05', '2026-11-09']), /permission denied/); await db.exec('reset role'); await as(5);
    await assert.rejects(() => call('hr_attendance_range', ['2026-11-09', '2026-11-05']), /تاريخ البداية والنهاية/);
    await assert.rejects(() => call('hr_attendance_range', [null, '2026-11-05']), /تاريخ البداية والنهاية/);
    await assert.rejects(() => call('hr_attendance_range', ['2025-11-01', '2026-11-10']), /366 يومًا/, 'more than 366 days refused');
    const big = await call('hr_attendance_range', ['2025-11-10', '2026-11-10']); assert.equal(big.from, '2025-11-10', '366 days exactly is allowed');

    // ---- verdicts
    const r = await call('hr_attendance_range', ['2026-11-05', '2026-11-09']);
    assert.equal(r.from, '2026-11-05'); assert.equal(r.to, '2026-11-09'); assert(r.today >= '2026-11-12' || r.today >= r.to);
    const get = (p, day) => r.rows.find(x => x.person_id === P[p] && x.day === day);
    const eval_ = async (day) => Object.fromEntries((await owner('select * from clinic_people.attendance_eval($1::date, now())', [day])).map(x => [x.person_id, x.status]));
    // the verdicts are exactly attendance_eval's
    for (const day of ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09']) { const ev = await eval_(day); for (const [pid, st] of Object.entries(ev)) assert.equal(r.rows.find(x => x.person_id === pid && x.day === day)?.status, st, 'same verdict as attendance_eval for ' + day); assert.equal(r.rows.filter(x => x.day === day).length, Object.keys(ev).length); }
    assert.equal(get('on', '2026-11-05').status, 'on_time'); assert.equal(get('on', '2026-11-05').overtime_min, 40); assert.equal(get('on', '2026-11-05').early_leave_min, 0);
    assert.equal(get('on', '2026-11-09').status, 'on_time'); assert.equal(get('on', '2026-11-09').overtime_min, 2); assert.equal(get('on', '2026-11-09').template_name, 'صباحي');
    assert.equal(get('late', '2026-11-09').status, 'late'); assert.equal(get('late', '2026-11-09').late_min, 25); assert.equal(get('late', '2026-11-09').early_leave_min, 30); assert.equal(get('late', '2026-11-09').overtime_min, 0);
    assert.equal(get('abs', '2026-11-09').status, 'absent'); assert.equal(get('abs', '2026-11-09').first_in, null); assert.equal(get('abs', '2026-11-09').incomplete, false);
    assert.equal(get('lv', '2026-11-08').status, 'leave'); assert.equal(get('lv', '2026-11-09').status, 'absent', 'leave covers only its own day');
    assert.equal(get('ex', '2026-11-09').status, 'absent'); assert.equal(get('ex', '2026-11-09').excused, true);
    assert.equal(get('un', '2026-11-09').status, 'unmapped');
    assert.equal(get('inc', '2026-11-09').status, 'on_time'); assert.equal(get('inc', '2026-11-09').incomplete, true); assert.equal(get('inc', '2026-11-09').last_out, null);
    assert.equal(get('on', '2026-11-09').incomplete, false);
    // weekly day off: Friday Nov 6 has no row for anyone on the standard pattern, the night worker still has one
    assert.equal(r.rows.filter(x => x.day === '2026-11-06' && x.person_id !== P.ng).length, 0, 'day off = no row'); assert(get('ng', '2026-11-06'));
    // night shift crossing midnight: the exit at 05:05 next morning is its last_out, 5 minutes of overtime, no early leave
    const ng = get('ng', '2026-11-09'); assert.equal(ng.status, 'on_time'); assert.equal(ng.template_name, 'ليلي'); assert.equal(ng.overtime_min, 5); assert.equal(ng.early_leave_min, 0); assert.equal(new Date(ng.last_out).toISOString(), '2026-11-10T03:05:00.000Z'); assert.equal(ng.incomplete, false);
    // excluded people: doctor never listed, ended person never listed
    assert(!r.rows.some(x => x.person_id === P.dr || x.person_id === P.gone)); assert(!r.people.some(p => p.id === P.dr || p.id === P.gone));
    // people meta
    const pm = r.people.find(p => p.id === P.on); assert.equal(pm.full_name, 'في الميعاد'); assert.equal(pm.department, 'الاستقبال'); assert('code' in pm && 'job_title' in pm);
    assert.deepEqual(r.rows.map(x => x.day), [...r.rows.map(x => x.day)].sort(), 'rows are ordered by day');

    // ---- clamp to today and empty ranges
    const fut = await call('hr_attendance_range', ['2026-11-10', '2027-11-01']); assert.equal(fut.to, fut.today, 'range is clamped to today');
    assert(fut.rows.every(x => x.day <= fut.today));
    const none = await call('hr_attendance_range', ['2030-01-01', '2030-01-05']); assert.deepEqual(none.rows, []);
    const old = await call('hr_attendance_range', ['2026-01-01', '2026-01-05']); assert.deepEqual(old.rows, [], 'before any pattern nobody is scheduled');

    // ---- read-only: nothing written
    assert.equal((await owner("select count(*)::int n from clinic_people.audit where action like 'attendance%'"))[0].n, 0);

    // ---- rollback leaves shifts intact; re-apply works
    await db.exec(fs.readFileSync('supabase/rollbacks/20261113110000_attendance_reports.rollback.sql', 'utf8'));
    assert.equal((await owner("select to_regprocedure('public.hr_attendance_range(date, date)') r"))[0].r, null); assert(await owner("select to_regclass('clinic_people.person_shifts') r"));
    await as(5); assert.equal((await call('hr_shifts_workspace')).templates.length, 2); await db.exec('reset role');
    await db.exec(MIG); await as(5); assert.equal((await call('hr_attendance_range', ['2026-11-09', '2026-11-09'])).rows.length > 0, true);
    console.log('hr-attendance-range-sql OK');
  } finally { await db.close?.(); }
})().catch(e => { console.error(e); process.exit(1); });
