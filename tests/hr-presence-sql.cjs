// Live presence (الحضور الآن) — SQL rehearsal on PGlite with the REAL HR migration + the new presence migration.
// Covers: HR-only access, state from the latest punch (in / break / out / none), lookback window, night shift crossing midnight, unmapped device users listed,
// mapping (insert, change person, move a person to another number, remove, ended-person guard), audit, duplicate punches ignored, feed freshness fields,
// direct table denial, second apply refused, rollback leaves the HR schema intact and re-apply works.
const fs = require('fs'), assert = require('node:assert/strict'), boot = require('./helpers/reception-bridge.cjs');
(async () => {
  const { db, as, call, owner, id } = await boot();
  try {
    await db.exec("alter table admins alter column id set default gen_random_uuid();alter table admins add column user_id uuid;create table admin_extra_roles(admin_id uuid,role text);create or replace function public.is_super() returns boolean language sql stable as $$select has_role('super_admin')$$;");
    const load = s => fs.readFileSync('supabase/migrations/' + fs.readdirSync('supabase/migrations').find(x => x.endsWith('_' + s + '.sql')), 'utf8');
    await db.exec(load('human_resources_workspace'));
    const MIG = fs.readFileSync('supabase/migrations/20261112100000_live_presence.sql', 'utf8');
    await db.exec(MIG);
    await assert.rejects(() => db.exec(MIG), /تم تطبيق هذا الملف من قبل/, 'second apply refused'); await db.exec('rollback');

    await owner("insert into admins(id,name,role) values($1,'HR user','reception'),($2,'Employee 6','reception')", [id(5), id(6)]); await as(1); await owner('update admins set has_hr_access=true where id=$1', [id(5)]);
    const P = {};
    for (const [k, name, admin, status] of [['p1', 'موظف أول', id(5), 'active'], ['p2', 'موظف ثاني', id(6), 'active'], ['p3', 'موظف ثالث', null, 'active'], ['p4', 'موظف منتهي', null, 'ended']])
      P[k] = (await owner("insert into clinic_people.people(full_name,admin_id,status,created_by) values($1,$2,$3,$4) returning id", [name, admin, status, id(1)]))[0].id;
    const snap = async (lb) => call('hr_presence_snapshot', lb === undefined ? [] : [lb]);
    const map = (dev, uid, p) => call('hr_presence_map', [dev, uid, p]);
    const base = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
    const punch = (uid, minutesAgo, code, dev = 'k14') => owner("insert into clinic_people.device_punches(device_id,device_user_id,ts,punch,status) values($1,$2,$5::timestamptz-($3||' minutes')::interval,$4,1) on conflict do nothing", [dev, uid, String(minutesAgo), code, base]);
    const row = (s, uid) => s.rows.find(r => r.device_user_id === uid);

    // ---- punches: user 3 checked in 3h ago and is still in; user 6 in then out; user 7 break; user 9 night shift started 9h ago; user 13 old punch outside window; user 24 unmapped
    await punch(3, 180, 0); await punch(6, 500, 0); await punch(6, 30, 1); await punch(7, 300, 0); await punch(7, 20, 2); await punch(9, 540, 0); await punch(13, 60 * 30, 0); await punch(24, 10, 0);
    await punch(3, 180, 0); // duplicate ignored (unique)
    assert.equal((await owner('select count(*)::int n from clinic_people.device_punches'))[0].n, 8, 'duplicate punch ignored');

    // ---- only HR managers; nobody else
    await as(6); await assert.rejects(() => snap(), /تحتاج إدارة الموارد البشرية/); await assert.rejects(() => map('k14', 3, P.p1), /تحتاج إدارة الموارد البشرية/);
    await db.exec('reset role; set role anon'); await assert.rejects(() => snap(), /permission denied/); await db.exec('reset role');
    await as(5);

    // ---- before any mapping: all 4 device users with punches in the window are listed, unmapped; old punch of 13 is outside the 16h window
    let s = await snap();
    assert.equal(s.can_manage, true); assert.equal(s.lookback_hours, 16); assert(s.last_received_at && s.last_punch_at, 'feed freshness fields');
    assert.deepEqual(s.rows.map(r => r.device_user_id).sort((a, b) => a - b), [3, 6, 7, 9, 24]);
    assert(s.rows.every(r => r.mapped === false && r.person_id === null));
    assert.equal(row(s, 3).state, 'in'); assert.equal(row(s, 6).state, 'out'); assert.equal(row(s, 7).state, 'break'); assert.equal(row(s, 9).state, 'in'); assert.equal(row(s, 24).state, 'in');
    assert.equal(row(s, 6).minutes_since >= 29 && row(s, 6).minutes_since <= 31, true, 'minutes since last punch');
    assert.equal(row(s, 3).punches, 1);
    assert(s.people.length === 3 && s.people.every(p => p.id !== P.p4), 'people list excludes ended');
    assert.equal(s.rows[0].state, 'in', 'people who are in come first');
    s = await snap(48); assert.equal(s.lookback_hours, 48); assert.equal(row(s, 13).state, 'in', 'wider window sees the 30h-old punch'); assert.equal(row(s, 13).last_in_at !== null, true);
    assert.equal((await snap(0)).lookback_hours, 1); assert.equal((await snap(999)).lookback_hours, 48, 'lookback is clamped');

    // ---- mapping
    await map('k14', 3, P.p1); await map('k14', 6, P.p2); await map('k14', 9, P.p3);
    s = await snap();
    assert.equal(row(s, 3).full_name, 'موظف أول'); assert.equal(row(s, 3).mapped, true); assert.equal(row(s, 3).person_id, P.p1);
    assert.equal(row(s, 6).full_name, 'موظف ثاني'); assert.equal(row(s, 9).full_name, 'موظف ثالث');
    assert.equal(row(s, 24).mapped, false);
    // a person who is mapped but has no punch in the window is listed as "none"
    await map('k14', 40, P.p1); // moves p1 from 3 to 40 (one number per person per device)
    s = await snap();
    assert.equal(row(s, 3).mapped, false, 'moving a person frees the old number'); assert.equal(row(s, 40).person_id, P.p1); assert.equal(row(s, 40).state, 'none'); assert.equal(row(s, 40).full_name, 'موظف أول');
    await map('k14', 3, P.p1); // back: p1 now on 3 and 40 is released
    s = await snap(); assert.equal(row(s, 3).person_id, P.p1); assert.equal(row(s, 40), undefined, 'released number without punches disappears');
    // change which person a number points to
    await map('k14', 3, P.p3); s = await snap(); assert.equal(row(s, 3).person_id, P.p3); assert.equal(row(s, 9).mapped, false, 'moving p3 to number 3 released number 9');
    await map('k14', 3, P.p1); await map('k14', 9, P.p3);
    // remove a mapping
    await map('k14', 9, null); s = await snap(); assert.equal(row(s, 9).mapped, false);
    // ended / unknown / bad input
    await assert.rejects(() => map('k14', 5, P.p4), /اختر موظفًا مستمرًا/);
    await assert.rejects(() => map('k14', 5, '00000000-0000-4000-8000-000000000999'), /اختر موظفًا مستمرًا|violates/);
    await assert.rejects(() => map('bad id', 5, P.p1), /راجع رقم الجهاز/); await assert.rejects(() => map('k14', 0, P.p1), /راجع رقم الجهاز/);

    // ---- audit
    const audit = await owner("select actor_id, record_id from clinic_people.audit where action='presence_map' order by id");
    assert(audit.length >= 5 && audit.every(a => a.actor_id === id(5)), 'mapping changes are audited');

    // ---- an ended person disappears from the live view even if still mapped
    await owner("update clinic_people.people set status='ended' where id=$1", [P.p2]);
    s = await snap(); assert.equal(row(s, 6).mapped, false, 'ended person is no longer shown by name'); assert(!s.people.some(p => p.id === P.p2));

    // ---- direct table access is denied for API roles
    for (const r of ['authenticated', 'anon']) {
      await db.exec('reset role; set role ' + r);
      await assert.rejects(() => db.query('select * from clinic_people.device_punches'), /permission denied/);
      await assert.rejects(() => db.query('select * from clinic_people.device_user_map'), /permission denied/);
      await assert.rejects(() => db.query("insert into clinic_people.device_punches(device_id,device_user_id,ts,punch) values('k14',1,now(),0)"), /permission denied/);
    }
    await db.exec('reset role');

    // ---- rollback leaves the HR schema intact
    await db.exec(fs.readFileSync('supabase/rollbacks/20261112100000_live_presence.rollback.sql', 'utf8'));
    assert.equal((await owner("select to_regclass('clinic_people.device_punches') t"))[0].t, null);
    assert.equal((await owner("select count(*)::int n from clinic_people.audit where action='presence_map'"))[0].n >= 5, true, 'audit rows kept on rollback');
    assert.equal((await owner('select count(*)::int n from clinic_people.people'))[0].n, 4);
    await db.exec(MIG); // re-apply works after a rollback
    console.log('PASS hr presence SQL: states from latest punch, lookback, night shift, unmapped listing, mapping (move/change/remove), ended guard, audit, HR-only, direct denial, rollback + re-apply');
  } finally { await db.close(); }
})().catch(e => { console.error(e); process.exit(1); });
