// HR custody register (سجل العهد) — SQL rehearsal on PGlite with the REAL HR migration + the new custody migration.
// Covers: create (+ first holder in one step, idempotent by request_id), issue / transfer / return / lost / damaged / update, revision (stale) guard, date rules,
// ended-person guard, who may write (HR only) and who may read (HR + accounting roles; others only their own), outstanding feed for the settlement, audit + movements, direct table denial.
const fs = require('fs'), assert = require('node:assert/strict'), boot = require('./helpers/reception-bridge.cjs');
(async () => {
  const { db, as, call, owner, id } = await boot();
  try {
    await db.exec("alter table admins alter column id set default gen_random_uuid();alter table admins add column user_id uuid;create table admin_extra_roles(admin_id uuid,role text);create or replace function public.is_super() returns boolean language sql stable as $$select has_role('super_admin')$$;");
    const load = s => fs.readFileSync('supabase/migrations/' + fs.readdirSync('supabase/migrations').find(x => x.endsWith('_' + s + '.sql')), 'utf8');
    await db.exec(load('human_resources_workspace'));
    const MIG = fs.readFileSync('supabase/migrations/20261109110000_hr_custody_register.sql', 'utf8');
    await db.exec(MIG);
    await assert.rejects(() => db.exec(MIG), /تم تطبيق هذا الملف من قبل/, 'second apply refused'); await db.exec('rollback');

    // people: P1 (admin 5, HR-only account), P2 (admin 6, employee), P3 ended
    await owner("insert into admins(id,name,role) values($1,'HR user','reception'),($2,'Employee 6','reception')", [id(5), id(6)]); await as(1); await owner('update admins set has_hr_access=true where id=$1', [id(5)]);
    const P = {};
    for (const [k, name, admin, status] of [['p1', 'موظف أول', id(5), 'active'], ['p2', 'موظف ثاني', id(6), 'active'], ['p3', 'موظف منتهي', null, 'ended']])
      P[k] = (await owner("insert into clinic_people.people(full_name,admin_id,status,created_by) values($1,$2,$3,$4) returning id", [name, admin, status, id(1)]))[0].id;
    const cmd = (a, p) => call('hr_custody_command', [a, p]);
    const ws = async () => call('hr_custody_workspace', []);
    const item = async v => (await owner('select * from clinic_people.custody_items where id=$1', [v]))[0];
    const req = n => '60000000-0000-4000-8000-' + String(n).padStart(12, '0');

    // ---- create with first holder, idempotent
    await as(1);
    const a = await cmd('create', { item_name: 'لاب توب', category: 'device', description: 'Dell 14', serial_ref: 'SN123', value: 25000, holder_id: P.p1, issued_on: '2026-10-01', request_id: req(1) });
    assert.equal(await cmd('create', { item_name: 'لاب توب', value: 25000, holder_id: P.p1, request_id: req(1) }), a, 'same request_id returns the same item');
    assert.equal((await owner('select count(*)::int n from clinic_people.custody_items'))[0].n, 1);
    let r = await item(a);
    assert.equal(r.status, 'with_holder'); assert.equal(r.holder_id, P.p1); assert(/^CUS-\d{6}$/.test(r.code)); assert.equal(Number(r.value), 25000); assert.equal(r.came_from_note, 'المخزن'); assert.equal(r.revision, 2);
    assert.deepEqual((await owner('select action from clinic_people.custody_movements where item_id=$1 order by id', [a])).map(x => x.action), ['create', 'issue']);
    // item created in store
    const b = await cmd('create', { item_name: 'مفتاح العيادة', category: 'keys', value: 0 });
    assert.equal((await item(b)).status, 'in_store');

    // ---- validation
    await assert.rejects(() => cmd('create', { item_name: 'x' }), /اسم البند/);
    await assert.rejects(() => cmd('create', { item_name: 'جهاز', value: -5 }), /قيمة/);
    await assert.rejects(() => cmd('create', { item_name: 'جهاز', value: 'NaN' }), /قيمة/);
    await assert.rejects(() => cmd('create', { item_name: 'جهاز', holder_id: P.p3 }), /مستمرًا/, 'cannot hand custody to an ended person');
    await assert.rejects(() => cmd('issue', { id: a, revision: 2, holder_id: P.p2 }), /ليس في المخزن/, 'issue only from store');
    await assert.rejects(() => cmd('issue', { id: b, revision: 1, holder_id: P.p1, issued_on: '2999-01-01' }), /المستقبل/);
    await assert.rejects(() => cmd('issue', { id: b, revision: 99, holder_id: P.p1 }), /تغير/, 'stale revision refused');
    await assert.rejects(() => cmd('bogus', {}), /إجراء غير متاح/);

    // ---- transfer
    await cmd('transfer', { id: a, revision: 2, holder_id: P.p2, issued_on: '2026-10-15' });
    r = await item(a); assert.equal(r.holder_id, P.p2); assert.equal(r.came_from_id, P.p1); assert.equal(r.came_from_note, ''); assert.equal(r.issued_on.toISOString().slice(0, 10), '2026-10-15'); assert.equal(r.revision, 3);
    await assert.rejects(() => cmd('transfer', { id: a, revision: 3, holder_id: P.p2 }), /نفس الشخص/);
    await assert.rejects(() => cmd('transfer', { id: b, revision: 1, holder_id: P.p1 }), /عهدة قائمة/, 'cannot transfer an item that is in store');

    // ---- outstanding feed (HR + accounting only)
    await as(2);
    let o = await call('hr_custody_outstanding', [P.p2]); assert.equal(o.items.length, 1); assert.equal(Number(o.total_value), 25000);
    await as(4); await assert.rejects(() => call('hr_custody_outstanding', [P.p2]), /للموارد البشرية والحسابات/);

    // ---- lost / damaged
    await as(1);
    await assert.rejects(() => cmd('lost', { id: a, revision: 3 }), /سبب/);
    await cmd('lost', { id: a, revision: 3, note: 'ضاع في المواصلات' });
    r = await item(a); assert.equal(r.status, 'lost'); assert.equal(r.holder_id, P.p2);
    await as(2); o = await call('hr_custody_outstanding', [P.p2]); assert.equal(o.items.length, 1, 'lost still counts against the holder'); assert.equal(o.items[0].status, 'lost');
    await as(1);
    await assert.rejects(() => cmd('damaged', { id: a, revision: 4, note: 'تلف' }), /عهدة قائمة/, 'lost item cannot be marked damaged');

    // ---- return (found) with date rules
    await assert.rejects(() => cmd('return', { id: a, revision: 4, returned_on: '2026-10-01' }), /قبل تاريخ التسليم/);
    await assert.rejects(() => cmd('return', { id: a, revision: 4, returned_on: '2999-01-01' }), /المستقبل/);
    await cmd('return', { id: a, revision: 4, returned_on: '2026-10-20', note: 'لقيناه' });
    r = await item(a); assert.equal(r.status, 'in_store'); assert.equal(r.holder_id, null); assert.equal(r.came_from_id, P.p2); assert.equal(r.returned_on.toISOString().slice(0, 10), '2026-10-20');
    await assert.rejects(() => cmd('return', { id: a, revision: 5 }), /المخزن بالفعل/);
    await as(2); o = await call('hr_custody_outstanding', [P.p2]); assert.equal(o.items.length, 0); assert.equal(Number(o.total_value), 0);

    // ---- damaged + update (value change needs a reason)
    await as(1);
    await cmd('issue', { id: a, revision: 5, holder_id: P.p1, issued_on: '2026-10-21', came_from_note: 'مخزن الفرع' });
    r = await item(a); assert.equal(r.came_from_note, 'مخزن الفرع'); assert.equal(r.returned_on, null);
    await cmd('damaged', { id: a, revision: 6, note: 'الشاشة مكسورة' }); assert.equal((await item(a)).status, 'damaged');
    await assert.rejects(() => cmd('update', { id: a, revision: 7, item_name: 'لاب توب', value: 20000 }), /سبب تغيير القيمة/);
    await cmd('update', { id: a, revision: 7, item_name: 'لاب توب Dell', value: 20000, note: 'إعادة تقييم بعد التلف' });
    r = await item(a); assert.equal(r.item_name, 'لاب توب Dell'); assert.equal(Number(r.value), 20000); assert.equal(r.status, 'damaged');
    const acts = (await owner('select action from clinic_people.custody_movements where item_id=$1 order by id', [a])).map(x => x.action);
    assert.deepEqual(acts, ['create', 'issue', 'transfer', 'lost', 'return', 'issue', 'damaged', 'update']);
    const audit = (await owner("select action,before_data,after_data from clinic_people.audit where action like 'custody_%' and record_id=$1 order by id", [a]));
    assert.equal(audit.length, 7, 'one audit row per command (create+first holder is one command)'); assert.equal(Number(audit.at(-1).before_data.value), 25000); assert.equal(Number(audit.at(-1).after_data.value), 20000);

    // ---- who may write / read
    await as(2); await assert.rejects(() => cmd('create', { item_name: 'جهاز' }), /لإدارة الموارد البشرية/, 'accountant is read-only');
    await as(3); await assert.rejects(() => cmd('create', { item_name: 'جهاز' }), /لإدارة الموارد البشرية/, 'financial manager is read-only');
    await as(4); await assert.rejects(() => cmd('create', { item_name: 'جهاز' }), /لإدارة الموارد البشرية/, 'reception cannot write');
    await as(5); const hrItem = await cmd('create', { item_name: 'بطاقة دخول', category: 'card', value: 50 }); assert(hrItem, 'an HR-access account can write');
    // reads
    await as(2); let w = await ws(); assert.equal(w.can_view_all, true); assert.equal(w.can_manage, false); assert.equal(w.items.length, 3); assert.equal(w.people.length, 0, 'accountant gets no people picker');
    const wa = w.items.find(x => x.id === a); assert.equal(wa.holder_name, 'موظف أول');
    assert(w.movements.length >= 8);
    await as(1); w = await ws(); assert.equal(w.can_manage, true); assert.equal(w.people.length, 2, 'ended person is not offered');
    await as(6); w = await ws(); assert.equal(w.can_view_all, false); assert.equal(w.items.length, 0, 'employee holding nothing sees nothing'); // p2 holds nothing now
    await as(4); w = await ws(); assert.equal(w.items.length, 0);
    await as(1); await assert.rejects(() => cmd('transfer', { id: a, revision: 8, holder_id: P.p2 }), /عهدة قائمة/, 'a damaged item cannot be transferred'); await cmd('return', { id: a, revision: 8 }); await cmd('issue', { id: a, revision: 9, holder_id: P.p2 });
    await as(6); w = await ws(); assert.equal(w.items.length, 1, 'employee sees only the item he holds'); assert.equal(w.items[0].id, a);
    assert(w.movements.every(m => m.item_id === a));

    // ---- locked down: no direct table access, no anonymous
    await as(1); await assert.rejects(() => db.query('select * from clinic_people.custody_items'), /permission denied/);
    await assert.rejects(() => db.query('select clinic_people.custody_view_all()'), /permission denied/);
    await db.exec('reset role; set role anon'); await assert.rejects(() => call('hr_custody_workspace', []), /permission denied/); await assert.rejects(() => cmd('create', { item_name: 'x' }), /permission denied/);

    // ---- rollback leaves the HR schema intact
    await db.exec('reset role');
    await db.exec(fs.readFileSync('supabase/rollbacks/20261109110000_hr_custody_register.rollback.sql', 'utf8'));
    assert.equal((await owner("select to_regclass('clinic_people.custody_items') t"))[0].t, null);
    assert.equal((await owner("select count(*)::int n from clinic_people.audit where action like 'custody_%'"))[0].n >= 9, true, 'audit rows kept on rollback');
    assert.equal((await owner('select count(*)::int n from clinic_people.people'))[0].n, 3);
    await db.exec(MIG); // re-apply works after a rollback
    console.log('PASS hr custody SQL: create/issue/transfer/return/lost/damaged/update, idempotency, revision + date + ended guards, HR-only writes, accounting read-only, own-items view, outstanding feed, audit, lockdown, rollback + re-apply.');
  } finally { await db.close(); }
})().catch(e => { console.error(e); process.exit(1); });
