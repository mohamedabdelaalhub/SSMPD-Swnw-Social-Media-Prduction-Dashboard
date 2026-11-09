// HR insurance register + accounting «دفع التأمينات» — SQL rehearsal on PGlite with the REAL finance + HR + payroll migrations and the new insurance migration.
const fs = require('fs'), assert = require('node:assert/strict'), boot = require('./helpers/reception-bridge.cjs');
(async () => {
  const { db, as, call, owner, id, fin, key } = await boot(['reception_canonical_catalog', 'reception_catalog_readiness', 'reception_catalog_lock_order']);
  try {
    await db.exec("alter table admins add column if not exists email text;alter table contracting_entities add column category text default 'cash';alter table pricing_services add column created_by uuid;create or replace function public.is_super() returns boolean language sql stable as $$select has_role('super_admin')$$;");
    for (const suffix of ['human_resources_workspace', 'price_lists_workspace', 'price_lists_booking_integration']) await db.exec(fs.readFileSync('supabase/migrations/' + fs.readdirSync('supabase/migrations').find(n => n.endsWith('_' + suffix + '.sql')), 'utf8'));
    await db.exec(fs.readFileSync('supabase/migrations/20261024183344_contract_price_imports_and_service_identity.sql', 'utf8'));
    await db.exec(fs.readFileSync('supabase/migrations/20261024183400_hr_attendance_import_and_calculated_payroll.sql', 'utf8'));
    const MIG = fs.readFileSync('supabase/migrations/20261109120000_hr_insurance.sql', 'utf8');
    await db.exec(MIG);
    await assert.rejects(() => db.exec(MIG), /تم تطبيق هذا الملف من قبل/); await db.exec('rollback');

    await as(1); await owner('update admins set has_hr_access=true where id=$1', [id(3)]);
    const hr = (a, p) => call('hr_insurance_command', [a, p]);
    const row = async v => (await owner('select * from clinic_people.insurance_enrollments where id=$1', [v]))[0];
    const day = x => x instanceof Date ? x.toISOString().slice(0, 10) : x;
    const P1 = (await owner("insert into clinic_people.people(full_name,finance_subject,status,created_by) values('موظف أول','EMPLOYEE-TEST','active',$1) returning id", [id(1)]))[0].id;
    const P2 = (await owner("insert into clinic_people.people(full_name,status,created_by) values('موظف ثاني','active',$1) returning id", [id(1)]))[0].id;
    const P3 = (await owner("insert into clinic_people.people(full_name,status,created_by) values('موظف منتهي','ended',$1) returning id", [id(1)]))[0].id;

    // ---- HR register
    await as(1);
    const rq = '70000000-0000-4000-8000-000000000001';
    const s1 = await hr('create', { person_id: P1, insurance_type: 'social', insurance_number: '123456', employee_deduction: 200, center_share: 300, started_on: '2026-01-01', request_id: rq });
    assert.equal(await hr('create', { person_id: P1, insurance_type: 'social', employee_deduction: 200, started_on: '2026-01-01', request_id: rq }), s1, 'idempotent by request_id');
    const m1 = await hr('create', { person_id: P1, insurance_type: 'medical', insurance_number: 'MED-9', employee_deduction: 50, started_on: '2026-01-01' });
    const s2 = await hr('create', { person_id: P2, insurance_type: 'social', insurance_number: '777', employee_deduction: 100, center_share: 150, started_on: '2026-10-15' });
    assert.equal((await owner('select count(*)::int n from clinic_people.insurance_enrollments'))[0].n, 3);
    await assert.rejects(() => hr('create', { person_id: P1, insurance_type: 'social', employee_deduction: 1, started_on: '2026-05-01' }), /اشتراك قائم/);
    await assert.rejects(() => hr('create', { person_id: P3, insurance_type: 'social', started_on: '2026-05-01' }), /مستمرًا/);
    await assert.rejects(() => hr('create', { person_id: P2, insurance_type: 'x', started_on: '2026-05-01' }), /نوع التأمين/);
    await assert.rejects(() => hr('create', { person_id: P2, insurance_type: 'medical', employee_deduction: -1, started_on: '2026-05-01' }), /قيمة الاستقطاع/);
    await assert.rejects(() => hr('create', { person_id: P2, insurance_type: 'medical', employee_deduction: 10.555, started_on: '2026-05-01' }), /قيمة الاستقطاع/);
    await assert.rejects(() => hr('create', { person_id: P2, insurance_type: 'medical' }), /تاريخ بدء/);
    await assert.rejects(() => hr('update', { id: s1, revision: 9, employee_deduction: 200 }), /تغير/);
    await assert.rejects(() => hr('update', { id: s1, revision: 1, insurance_number: '123456', employee_deduction: 250, center_share: 300 }), /سبب تغيير المبلغ/);
    await hr('update', { id: s1, revision: 1, insurance_number: '123456', employee_deduction: 220, center_share: 300, reason: 'زيادة الأجر التأميني' });
    assert.equal(Number((await row(s1)).employee_deduction), 220); await hr('update', { id: s1, revision: 2, insurance_number: '123456', employee_deduction: 200, center_share: 300, reason: 'تصحيح' });
    assert.equal((await row(s1)).revision, 3);
    // stop
    await assert.rejects(() => hr('stop', { id: s2, revision: 1, stopped_on: '2026-10-01' }), /قبل تاريخ البدء/);
    await assert.rejects(() => hr('stop', { id: s2, revision: 1 }), /قبل تاريخ البدء/);
    await hr('stop', { id: s2, revision: 1, stopped_on: '2026-10-31', stop_reference: 'إخطار 123', notification_deadline: '2026-11-30', note: 'استقالة' });
    let r = await row(s2); assert.equal(r.status, 'stopped'); assert.equal(day(r.stopped_on), '2026-10-31'); assert.equal(day(r.notification_deadline), '2026-11-30'); assert.equal(r.stop_reference, 'إخطار 123');
    await assert.rejects(() => hr('stop', { id: s2, revision: 2, stopped_on: '2026-11-01' }), /موقوف بالفعل/);
    await hr('update', { id: s2, revision: 2, insurance_number: '777', stop_reference: 'إخطار 123/ب', notification_deadline: '2026-12-15', employee_deduction: 99999, center_share: 99999 });
    r = await row(s2); assert.equal(Number(r.employee_deduction), 100, 'a stopped enrollment keeps its amounts'); assert.equal(day(r.notification_deadline), '2026-12-15');
    // a new enrollment after stop is allowed, but not overlapping the old one
    await assert.rejects(() => hr('create', { person_id: P2, insurance_type: 'social', started_on: '2026-10-20' }), /يتداخل/);
    const s2b = await hr('create', { person_id: P2, insurance_type: 'social', insurance_number: '777', employee_deduction: 120, started_on: '2026-12-01' }); assert(s2b);
    const aud = await owner("select count(*)::int n from clinic_people.audit where action like 'insurance_%'"); assert.equal(aud[0].n, 8, 'audit row per command');

    // ---- deduction feed for the payroll form
    const ded = async (p, m) => Number((await call('hr_insurance_deduction', [p, m])).insurance);
    assert.equal(await ded(P1, '2026-10-15'), 250); assert.equal(await ded(P2, '2026-10-20'), 100); assert.equal(await ded(P2, '2026-11-05'), 0, 'stopped on 10-31: nothing in November'); assert.equal(await ded(P2, '2026-09-10'), 0, 'not started yet'); assert.equal(await ded(P2, '2026-12-05'), 120);
    await as(4); await assert.rejects(() => call('hr_insurance_deduction', [P1, '2026-10-01']), /صلاحية/);
    await assert.rejects(() => hr('create', { person_id: P2, insurance_type: 'medical', started_on: '2026-10-01' }), /الموارد البشرية/);
    await as(2); await assert.rejects(() => hr('create', { person_id: P2, insurance_type: 'medical', started_on: '2026-10-01' }), /الموارد البشرية/, 'accountant is read-only on the register');
    assert.equal(await ded(P1, '2026-10-15'), 250);

    // ---- workspace visibility
    let w = await call('hr_insurance_workspace', []); assert.equal(w.can_view_all, true); assert.equal(w.can_manage, false); assert.equal(w.items.length, 4); assert.equal(w.people.length, 0); assert(!('request_id' in w.items[0]));
    await as(4); w = await call('hr_insurance_workspace', []); assert.equal(w.items.length, 0, 'ordinary user sees nothing of others');
    await as(1); w = await call('hr_insurance_workspace', []); assert.equal(w.people.length, 2, 'picker offers active people only');

    // ---- accounting: month picture
    const month = a => call('clinic_finance_insurance_month', [a]);
    const contract = await fin('business_command', ['request', { kind: 'employment', subject: 'EMPLOYEE-TEST', employee_name: 'موظف أول', base: 6000, from: '2026-01-01', to: '2026-12-31', reference: 'CONTRACT-INS', note: 'عقد موظف للاختبار' }, key()]);
    await as(3); await fin('business_command', ['review', { id: contract, approve: true, note: 'اعتماد العقد' }, key()]);
    await as(1); const payroll = await fin('business_command', ['request', { kind: 'payroll', subject: 'EMPLOYEE-TEST', contract_id: contract, month: '2026-10-01', insurance: 250, reference: 'PAY-OCT', note: 'مرتب أكتوبر' }, key()]);
    await as(3); await fin('business_command', ['review', { id: payroll, approve: true, note: 'اعتماد المرتب' }, key()]);
    await as(1);
    let s = await month('2026-10-20');
    assert.deepEqual([s.month, Number(s.employee_total), Number(s.center_total), Number(s.total_due), Number(s.payroll_withheld), Number(s.liability_balance), Number(s.remaining)], ['2026-10-01', 350, 450, 800, 250, 250, 800]);
    assert.equal(s.lines.length, 3);
    await as(4); await assert.rejects(() => month('2026-10-01'), /صلاحية/);

    // ---- payment: statutory_payment request, maker-checker, capped by the recorded liability
    await as(1);
    const pay = (amount, extra = {}, tk) => call('clinic_finance_insurance_pay', [extra.month || '2026-10-01', amount, extra.method || 'bank', null, extra.ref || ('INS-' + Math.random().toString(36).slice(2, 8)), 'سداد تأمينات أكتوبر', tk || key()]);
    await assert.rejects(() => pay(900), /يتجاوز المتبقي/);
    await assert.rejects(() => pay(0), /موجبًا/);
    await assert.rejects(() => pay(10, { method: 'x' }), /قناة/);
    await assert.rejects(() => pay(10, { month: '2999-01-01' }), /لم يبدأ/);
    const tk = key(); const p1 = await pay(250, { ref: 'RCPT-1' }, tk);
    assert.equal(await pay(250, { ref: 'RCPT-1' }, tk), p1, 'same token returns the same payment');
    assert.equal((await owner('select count(*)::int n from clinic_finance.insurance_payments'))[0].n, 1);
    s = await month('2026-10-01'); assert.equal(Number(s.paid_pending), 250); assert.equal(Number(s.remaining), 550); assert.equal(s.payments[0].status, 'pending');
    await assert.rejects(() => fin('business_command', ['review', { id: p1, approve: true, note: 'اعتماد ذاتي' }, key()]), /مراجع آخر/, 'creator cannot approve');
    await as(3); await fin('business_command', ['review', { id: p1, approve: true, note: 'مطابق للإيصال' }, key()]);
    const j = await owner("select account, sum(debit) d, sum(credit) c from clinic_finance.lines where source_id=$1 group by account", [p1]).catch(() => []);
    s = await month('2026-10-01'); assert.equal(Number(s.paid_approved), 250); assert.equal(Number(s.paid_pending), 0); assert.equal(Number(s.liability_balance), 0, 'liability 2143 cleared by the posted entry'); assert.equal(Number(s.remaining), 550);
    // the rest is the center share: no recorded liability yet -> the existing review refuses to over-pay it
    await as(1); const p2 = await pay(100, { ref: 'RCPT-2' }); await as(3);
    await assert.rejects(() => fin('business_command', ['review', { id: p2, approve: true, note: 'محاولة' }, key()]), /الالتزام المثبت/);
    await fin('business_command', ['review', { id: p2, approve: false, note: 'لا يوجد التزام مثبت لحصة المركز' }, key()]);
    s = await month('2026-10-01'); assert.equal(Number(s.paid_pending) + Number(s.paid_approved), 250, 'a rejected payment is not counted'); assert.equal(Number(s.remaining), 550);
    await as(2); assert.equal((await month('2026-10-01')).payments.length, 2, 'accountant sees both with their status');
    await as(4); await assert.rejects(() => pay(10), /صلاحية/);

    // ---- locked down
    await assert.rejects(() => db.query('select * from clinic_people.insurance_enrollments'), /permission denied/);
    await assert.rejects(() => db.query('select * from clinic_finance.insurance_payments'), /permission denied/);
    await db.exec('reset role; set role anon'); await assert.rejects(() => call('hr_insurance_workspace', []), /permission denied/); await assert.rejects(() => call('clinic_finance_insurance_month', ['2026-10-01']), /permission denied/);

    // ---- rollback keeps books + audit, re-apply works
    await db.exec('reset role'); await db.exec(fs.readFileSync('supabase/rollbacks/20261109120000_hr_insurance.rollback.sql', 'utf8'));
    assert.equal((await owner("select to_regclass('clinic_people.insurance_enrollments') t"))[0].t, null);
    assert.equal((await owner("select status from clinic_finance.business_requests where id=$1", [p1]))[0].status, 'approved', 'posted payment stays in the books');
    assert((await owner("select count(*)::int n from clinic_people.audit where action like 'insurance_%'"))[0].n >= 8);
    await db.exec(MIG);
    console.log('PASS hr insurance SQL: register create/update/stop (manual notification deadline), overlap + stale + amount guards, payroll feed, month summary, payment via statutory_payment (maker-checker, liability cap, idempotent, rejected not counted), permissions, lockdown, rollback + re-apply.');
  } finally { await db.close(); }
})().catch(e => { console.error(e); process.exit(1); });
