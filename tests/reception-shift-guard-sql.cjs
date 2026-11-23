// «وردية الخزينة — قفل بعد ساعة» (20261122370000, owner «كل حاجة»): a reception account whose HR shift started more than an hour ago with
// no open cash shift (or with a shift left open from an earlier day) cannot book / register arrival / collect / request services until the
// shift is opened; shift_open, reviews and other actions stay open; trial workspaces and managers are never locked; the manager watch list;
// rollback. attendance_eval is stubbed from a table (the real one is covered by the HR tests). Sample data only.
const fs = require('fs'), assert = require('node:assert/strict'), boot = require('./helpers/reception-bridge.cjs'), { randomUUID } = require('crypto');
(async () => {
  const { db, as, call, owner, id } = await boot();
  try {
    await db.exec("alter table admins add column if not exists user_id uuid;alter table admins add column if not exists email text;create table if not exists admin_extra_roles(admin_id uuid,role text);create or replace function public.is_super() returns boolean language sql stable as $$select has_role('super_admin')$$;");
    const load = s => fs.readFileSync('supabase/migrations/' + fs.readdirSync('supabase/migrations').find(x => x.endsWith('_' + s + '.sql')), 'utf8');
    await db.exec(load('human_resources_workspace'));
    await db.exec(load('live_presence'));
    await db.exec(`create table stub_eval(person_id uuid, first_in timestamptz, exp_start timestamptz, exp_end timestamptz, status text);
      create or replace function clinic_people.attendance_eval(p_day date, p_now timestamptz default now())
      returns table(person_id uuid, template_id uuid, template_name text, color text, grace integer, exp_start timestamptz, exp_end timestamptz,
        device_user_id integer, first_in timestamptz, status text, late_min integer, since_start integer, excused boolean)
      language sql stable as $$ select s.person_id, null::uuid, null, null, 0, s.exp_start, s.exp_end, null::int, s.first_in, s.status, 0, 0, false from stub_eval s $$;`);
    // a stand-in today-board journey command so its wrapper is exercised too
    await db.exec(`create or replace function public.clinic_reception_journey_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
      returns jsonb language sql security definer as $$ select jsonb_build_object('done', p_action) $$; grant execute on function public.clinic_reception_journey_command(uuid,text,jsonb,uuid) to authenticated;`);
    const M = fs.readFileSync('supabase/migrations/20261122370000_reception_shift_guard.sql', 'utf8');
    await db.exec(M); await assert.rejects(() => db.exec(M), /تم تطبيق هذا الملف من قبل/); await db.exec('rollback');
    const rec = id(4);
    const person = (await owner("insert into clinic_people.people(full_name,admin_id,status,created_by) values('موظف استقبال',$1,'active',$2) returning id", [rec, id(1)]))[0].id;
    await owner("insert into clinic_people.device_user_map(device_id,device_user_id,person_id) values('k14',7,$1)", [person]);
    const ws = (await owner("insert into clinic_reception.workspaces(name,mode,owner_id) values('live','live',$1) returning id", [id(1)]))[0].id;
    const trial = (await owner("insert into clinic_reception.workspaces(name,mode,owner_id) values('trial','trial',$1) returning id", [id(1)]))[0].id;
    await owner("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,$3),($4,$2,$3)", [ws, rec, ['book', 'collect', 'view', 'review'], trial]);
    const reg = (await owner("insert into clinic_reception.registers(workspace_id,name,direction) values($1,'خزينة الاستقبال 1','receive') returning id", [ws]))[0].id;
    const ago = m => new Date(Date.now() - m * 60000).toISOString();
    const setEval = async (fi, st, en, status) => { await owner('delete from stub_eval'); if (st !== undefined) await owner('insert into stub_eval values($1,$2,$3,$4,$5)', [person, fi, st, en, status || 'present']); };
    const cmd = (a, p, w = ws) => call('clinic_reception_command', [w, a, p || {}, randomUUID()]);
    const jc = (a, w = ws) => call('clinic_reception_journey_command', [w, a, {}, randomUUID()]);
    const guard = async () => { await as(4); return call('clinic_reception_shift_guard', []); };
    const LOCK = /افتح وردية الخزينة الأول/, STALE = /ورديتك من يوم قبل كده لسه مفتوحة/;
    const notGuard = async (p, what) => { try { await p; } catch (e) { assert(!LOCK.test(e.message) && !STALE.test(e.message), what + ' must not be shift-locked: ' + e.message); } };

    // before / within the first hour: open
    await setEval(null, ago(30), ago(-450)); assert.equal((await guard()).locked, false, 'within the first hour');
    await notGuard(cmd('book', {}), 'book inside the first hour');
    // more than an hour after the HR shift start (punched or not), no cash shift: locked
    await setEval(null, ago(70), ago(-410)); let g = await guard(); assert.equal(g.locked, true); assert.equal(g.reason, 'need_open');
    await setEval(ago(80), ago(70), ago(-410)); assert.equal((await guard()).reason, 'need_open', 'punched in: same rule');
    await as(4);
    for (const a of ['book', 'walk_in', 'overbook', 'agent_booking_register', 'booking_discount', 'arrive', 'collect', 'collect_multi', 'collect_split',
      'credit_apply', 'package_sell', 'installment_bill', 'order_add', 'execute']) await assert.rejects(() => cmd(a, {}), LOCK, a + ' is locked');
    for (const a of ['arrive', 'request_service']) await assert.rejects(() => jc(a), LOCK, 'journey ' + a + ' is locked');
    assert.equal((await jc('call')).done, 'call', 'other journey actions pass');
    for (const a of ['request_review', 'discount_review', 'shift_review', 'reschedule', 'cancel', 'patient']) await notGuard(cmd(a, {}), a);
    await notGuard(cmd('book', {}, trial), 'trial workspace');
    // managers are never locked
    await as(1); await notGuard(cmd('book', {}), 'super admin');
    // not locked: leave, shift over, punched out, a shift closed today, no linked person
    await setEval(null, ago(70), ago(-410), 'leave'); assert.equal((await guard()).locked, false, 'leave');
    await setEval(null, ago(600), ago(5)); assert.equal((await guard()).locked, false, 'HR shift over');
    await setEval(null, ago(70), ago(-410));
    await owner("insert into clinic_people.device_punches(device_id,device_user_id,ts,punch) values('k14',7,$1,0),('k14',7,$2,1)", [ago(60), ago(2)]);
    assert.equal((await guard()).why, 'punched_out'); await owner('delete from clinic_people.device_punches');
    // shift_open passes while locked; then everything opens
    await as(4); await notGuard(cmd('shift_open', { register_id: reg }), 'shift_open');
    if (!(await owner("select 1 from clinic_reception.shifts where cashier_id=$1 and status='open'", [rec])).length)
      await owner("insert into clinic_reception.shifts(workspace_id,register_id,cashier_id,status,opened_at) values($1,$2,$3,'open',now())", [ws, reg, rec]);
    g = await guard(); assert.equal(g.locked, false); assert.equal(g.reason, 'open');
    await as(4); await notGuard(cmd('collect', {}), 'collect with an open shift'); assert.equal((await jc('arrive')).done, 'arrive');
    // a shift left open from yesterday locks (stale) until handed over
    await owner("update clinic_reception.shifts set opened_at=now()-interval '30 hours', expected=1500 where cashier_id=$1", [rec]);
    g = await guard(); assert.equal(g.locked, true); assert.equal(g.reason, 'stale'); assert.equal(+g.expected, 1500); assert.equal(g.register, 'خزينة الاستقبال 1');
    await as(4); await assert.rejects(() => cmd('collect', {}), STALE); await notGuard(cmd('shift_close', {}), 'shift_close on a stale shift');
    // manager watch list
    await owner("update clinic_reception.shifts set status='submitted',closed_at=now() where cashier_id=$1", [rec]);
    await owner("delete from clinic_reception.shifts where cashier_id=$1", [rec]);
    await as(2); assert.equal((await call('clinic_reception_shift_watch', [])).visible, false, 'accountant: no watch list');
    await as(3); let w = await call('clinic_reception_shift_watch', []); assert.equal(w.visible, true);
    assert.deepEqual(w.items.map(x => [x.kind, x.admin_id]), [['missing', rec]], 'locked employee listed');
    await owner("insert into clinic_reception.shifts(workspace_id,register_id,cashier_id,status,opened_at,expected) values($1,$2,$3,'open',now()-interval '40 hours',0)", [ws, reg, rec]);
    w = await call('clinic_reception_shift_watch', []); assert.equal(w.items[0].kind, 'stale');
    await owner("update clinic_reception.shifts set opened_at=now()-interval '9 hours',expected=850 where cashier_id=$1", [rec]);
    await setEval(ago(540), ago(540), ago(70)); w = await call('clinic_reception_shift_watch', []);
    assert.equal(w.items[0].kind, 'after_end', 'open more than an hour after the HR shift end'); assert.equal(+w.items[0].expected, 850);
    await setEval(ago(300), ago(300), ago(-100)); assert.equal((await call('clinic_reception_shift_watch', [])).items.length, 0, 'normal open shift not listed');
    // rollback
    await db.exec('reset role'); await db.exec(fs.readFileSync('supabase/rollbacks/20261122370000_reception_shift_guard.rollback.sql', 'utf8'));
    assert.equal((await owner("select to_regprocedure('public.clinic_reception_shift_guard()') r"))[0].r, null);
    await owner("delete from clinic_reception.shifts where cashier_id=$1", [rec]); await setEval(null, ago(70), ago(-410));
    await as(4); await notGuard(cmd('book', {}), 'after rollback'); assert.equal((await jc('arrive')).done, 'arrive');
    console.log('PASS shift guard: locked an hour after the HR shift start without a cash shift (and with a stale one) for book / walk-in / overbook / agent booking / arrival / collect (all kinds) / packages / services / journey arrive + request_service; shift_open, shift_close, reviews, reschedule, cancel, other journey actions, trial and managers stay open; leave / shift over / punched out not locked; manager watch list (missing, stale, after end); rollback.');
  } finally { await db.close(); }
})().catch(e => { console.error(e); process.exit(1); });
