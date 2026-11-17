// Owner 2026-11-17 «افتح وردية اليوم» + floating safe: clinic_reception_shift_reminder() state for the signed-in reception account.
// attendance_eval is stubbed from a table here (the real one is covered by the HR attendance tests); punches use the real presence tables.
const fs = require('fs'), assert = require('node:assert/strict'), boot = require('./helpers/reception-bridge.cjs');
(async () => {
  const { db, as, call, owner, id } = await boot();
  try {
    await db.exec("alter table admins add column if not exists user_id uuid;create table if not exists admin_extra_roles(admin_id uuid,role text);create or replace function public.is_super() returns boolean language sql stable as $$select has_role('super_admin')$$;");
    const load = s => fs.readFileSync('supabase/migrations/' + fs.readdirSync('supabase/migrations').find(x => x.endsWith('_' + s + '.sql')), 'utf8');
    await db.exec(load('human_resources_workspace'));
    await db.exec(load('live_presence'));
    await db.exec(`create table stub_eval(person_id uuid, first_in timestamptz, exp_start timestamptz, exp_end timestamptz, status text);
      create or replace function clinic_people.attendance_eval(p_day date, p_now timestamptz default now())
      returns table(person_id uuid, template_id uuid, template_name text, color text, grace integer, exp_start timestamptz, exp_end timestamptz,
        device_user_id integer, first_in timestamptz, status text, late_min integer, since_start integer, excused boolean)
      language sql stable as $$ select s.person_id, null::uuid, null, null, 0, s.exp_start, s.exp_end, null::int, s.first_in, s.status, 0, 0, false from stub_eval s $$;`);
    await db.exec(load('reception_shift_reminder'));
    const rec = id(4);
    const person = (await owner("insert into clinic_people.people(full_name,admin_id,status,created_by) values('موظف استقبال',$1,'active',$2) returning id", [rec, id(1)]))[0].id;
    await owner("insert into clinic_people.device_user_map(device_id,device_user_id,person_id) values('k14',7,$1)", [person]);
    const ask = async n => { await as(n); return call('clinic_reception_shift_reminder', []); };
    const setEval = async (fi, st, en, status) => { await owner('delete from stub_eval'); if (st !== undefined) await owner('insert into stub_eval values($1,$2,$3,$4,$5)', [person, fi, st, en, status || 'present']); };
    const ago = m => new Date(Date.now() - m * 60000).toISOString();
    const punch = (m, code) => owner("insert into clinic_people.device_punches(device_id,device_user_id,ts,punch) values('k14',7,$1,$2)", [ago(m), code]);
    const st = async () => (await ask(4)).state;
    assert.equal((await ask(2)).state, 'hidden', 'accountant never');
    await setEval(); assert.equal(await st(), 'hidden', 'no schedule row');
    await setEval(null, ago(-60), ago(-480)); assert.equal(await st(), 'hidden', 'before shift start');
    await setEval(null, ago(10), ago(-470)); let r = await ask(4); assert.equal(r.state, 'need_open'); assert.equal(r.show, true); assert.equal(r.reason, 'shift_start');
    await setEval(ago(3), ago(-30), ago(-500)); r = await ask(4); assert.equal(r.state, 'need_open'); assert.equal(r.reason, 'punched');
    await setEval(ago(600), ago(600), ago(5)); assert.equal(await st(), 'hidden', 'after shift end, no shift');
    await setEval(null, ago(10), ago(-470), 'leave'); assert.equal(await st(), 'hidden', 'leave day');
    // open shift → green; shift end passes → yellow; punched out → yellow; stale from yesterday → yellow
    await setEval(ago(30), ago(30), ago(-400));
    const ws = (await owner("insert into clinic_reception.workspaces(name,mode,owner_id) values('ws','live',$1) returning id", [id(1)]))[0].id;
    const reg = (await owner("insert into clinic_reception.registers(workspace_id,name,direction) values($1,'خزينة','receive') returning id", [ws]))[0].id;
    await owner("insert into clinic_reception.shifts(workspace_id,register_id,cashier_id,status,opened_at) values($1,$2,$3,'open',now()-interval '20 minutes')", [ws, reg, rec]);
    r = await ask(4); assert.equal(r.state, 'open'); assert.equal(r.show, false);
    await setEval(ago(500), ago(500), ago(2)); r = await ask(4); assert.equal(r.state, 'close_due'); assert.equal(r.reason, 'shift_end');
    await setEval(ago(30), ago(30), ago(-400)); await punch(30, 0); await punch(1, 1); r = await ask(4); assert.equal(r.state, 'close_due'); assert.equal(r.reason, 'punched_out');
    await owner("update clinic_reception.shifts set opened_at=now()-interval '30 hours' where cashier_id=$1", [rec]); r = await ask(4); assert.equal(r.reason, 'stale'); assert.equal(r.state, 'close_due');
    // shift closed → gone (even though still inside shift time); punched out with no shift → gone
    await owner("update clinic_reception.shifts set status='submitted',opened_at=now()-interval '20 minutes',closed_at=now() where cashier_id=$1", [rec]);
    await owner('delete from clinic_people.device_punches'); assert.equal((await ask(4)).why, 'closed');
    await owner('delete from clinic_reception.shifts'); await punch(40, 0); await punch(2, 1); assert.equal((await ask(4)).why, 'punched_out');
    await punch(1, 0); assert.equal(await st(), 'need_open', 'punched back in');
    await owner('update clinic_people.people set admin_id=null where id=$1', [person]); assert.equal((await ask(4)).why, 'no_person');
    console.log('PASS shift reminder states: hidden (role / no schedule / before / after / leave / closed / punched out / no person), need_open (start or punch), open, close_due (end passed / punched out / stale).');
  } finally { await db.close(); }
})().catch(e => { console.error(e); process.exit(1); });
