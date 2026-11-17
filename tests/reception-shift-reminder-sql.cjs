// Owner 2026-11-17 «افتح وردية اليوم»: clinic_reception_shift_reminder() decides the popup for the signed-in reception account.
// attendance_eval is stubbed from a table here (the real one is covered by the HR attendance tests).
const fs = require('fs'), assert = require('node:assert/strict'), boot = require('./helpers/reception-bridge.cjs');
(async () => {
  const { db, as, call, owner, id } = await boot();
  try {
    await db.exec("alter table admins add column if not exists user_id uuid;create table if not exists admin_extra_roles(admin_id uuid,role text);create or replace function public.is_super() returns boolean language sql stable as $$select has_role('super_admin')$$;");
    const load = s => fs.readFileSync('supabase/migrations/' + fs.readdirSync('supabase/migrations').find(x => x.endsWith('_' + s + '.sql')), 'utf8');
    await db.exec(load('human_resources_workspace'));
    await db.exec(`create table stub_eval(person_id uuid, first_in timestamptz, exp_start timestamptz, exp_end timestamptz, status text);
      create or replace function clinic_people.attendance_eval(p_day date, p_now timestamptz default now())
      returns table(person_id uuid, template_id uuid, template_name text, color text, grace integer, exp_start timestamptz, exp_end timestamptz,
        device_user_id integer, first_in timestamptz, status text, late_min integer, since_start integer, excused boolean)
      language sql stable as $$ select s.person_id, null::uuid, null, null, 0, s.exp_start, s.exp_end, null::int, s.first_in, s.status, 0, 0, false from stub_eval s $$;`);
    await db.exec(load('reception_shift_reminder'));
    const rec = id(4), acc = id(2);
    const person = (await owner("insert into clinic_people.people(full_name,admin_id,status,created_by) values('موظف استقبال',$1,'active',$2) returning id", [rec, id(1)]))[0].id;
    const ask = async n => { await as(n); return call('clinic_reception_shift_reminder', []); };
    const setEval = async (fi, st, en, status) => { await owner('delete from stub_eval'); await owner('insert into stub_eval values($1,$2,$3,$4,$5)', [person, fi, st, en, status || 'present']); };
    const ago = m => new Date(Date.now() - m * 60000).toISOString();
    // not reception → never
    assert.equal((await ask(2)).show, false, 'accountant never sees it');
    // no schedule / not yet
    await setEval(null, ago(-60), ago(-480)); assert.equal((await ask(4)).show, false, 'before shift start');
    // shift start has come
    await setEval(null, ago(10), ago(-470)); let r = await ask(4); assert.equal(r.show, true); assert.equal(r.reason, 'shift_start');
    // punched in before the shift start → shows
    await setEval(ago(3), ago(-30), ago(-500)); r = await ask(4); assert.equal(r.show, true); assert.equal(r.reason, 'punched');
    // after the shift ended → no popup; on leave → no popup
    await setEval(ago(600), ago(600), ago(5)); assert.equal((await ask(4)).show, false, 'after shift end');
    await setEval(null, ago(10), ago(-470), 'leave'); assert.equal((await ask(4)).show, false, 'leave day');
    // an open shift today hides it; an open shift from yesterday → stale
    await setEval(ago(3), ago(10), ago(-470));
    const ws = (await owner("insert into clinic_reception.workspaces(name,mode,owner_id) values('ws','live',$1) returning id", [id(1)]))[0].id;
    const reg = await owner("insert into clinic_reception.registers(workspace_id,name,direction) values($1,'خزينة','receive') returning id", [ws]);
    {
      await owner("insert into clinic_reception.shifts(workspace_id,register_id,cashier_id,status,opened_at) values($1,$2,$3,'open',now()-interval '30 hours')", [ws, reg[0].id, rec]);
      r = await ask(4); assert.equal(r.show, true); assert.equal(r.reason, 'stale');
      await owner("update clinic_reception.shifts set opened_at=now() where cashier_id=$1", [rec]);
      assert.equal((await ask(4)).show, false, 'open shift today');
    }
    // reception account with no HR person
    await owner('update clinic_people.people set admin_id=null where id=$1', [person]); assert.equal((await ask(4)).why, 'no_person');
    console.log('PASS shift reminder: role-gated, before start hidden, shift start / punch shown, after end and leave hidden, open-today hides, stale shift flagged, no HR person.');
  } finally { await db.close(); }
})().catch(e => { console.error(e); process.exit(1); });
