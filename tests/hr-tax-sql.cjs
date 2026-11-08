// Employee income tax on salaries (HR monthly register + accounting payment) — SQL rehearsal on PGlite with the REAL finance + HR + payroll + insurance migrations.
const fs = require('fs'), assert = require('node:assert/strict'), boot = require('./helpers/reception-bridge.cjs');
(async () => {
  const { db, as, call, owner, id, fin, key } = await boot(['reception_canonical_catalog', 'reception_catalog_readiness', 'reception_catalog_lock_order']);
  try {
    await db.exec("alter table admins add column if not exists email text;alter table contracting_entities add column category text default 'cash';alter table pricing_services add column created_by uuid;create or replace function public.is_super() returns boolean language sql stable as $$select has_role('super_admin')$$;");
    for (const suffix of ['human_resources_workspace', 'price_lists_workspace', 'price_lists_booking_integration']) await db.exec(fs.readFileSync('supabase/migrations/' + fs.readdirSync('supabase/migrations').find(n => n.endsWith('_' + suffix + '.sql')), 'utf8'));
    await db.exec(fs.readFileSync('supabase/migrations/20261024183344_contract_price_imports_and_service_identity.sql', 'utf8'));
    await db.exec(fs.readFileSync('supabase/migrations/20261024183400_hr_attendance_import_and_calculated_payroll.sql', 'utf8'));
    const MIG = fs.readFileSync('supabase/migrations/20261109130000_hr_income_tax.sql', 'utf8');
    await assert.rejects(() => db.exec(MIG), /طبّق ملف التأمينات/, 'needs the insurance migration first'); await db.exec('rollback');
    await db.exec(fs.readFileSync('supabase/migrations/20261109120000_hr_insurance.sql', 'utf8'));
    await db.exec(MIG);
    await assert.rejects(() => db.exec(MIG), /تم تطبيق هذا الملف من قبل/); await db.exec('rollback');

    await as(1); await owner('update admins set has_hr_access=true where id=$1', [id(3)]);
    const hr = (a, p) => call('hr_tax_command', [a, p]);
    const row = async v => (await owner('select * from clinic_people.tax_entries where id=$1', [v]))[0];
    const P1 = (await owner("insert into clinic_people.people(full_name,finance_subject,status,created_by) values('موظف أول','EMPLOYEE-TEST','active',$1) returning id", [id(1)]))[0].id;
    const P2 = (await owner("insert into clinic_people.people(full_name,status,created_by) values('موظف ثاني','active',$1) returning id", [id(1)]))[0].id;
    const P3 = (await owner("insert into clinic_people.people(full_name,status,created_by) values('منتهي','ended',$1) returning id", [id(1)]))[0].id;

    // ---- register
    await as(1);
    const rq = '71000000-0000-4000-8000-000000000001';
    const t1 = await hr('create', { person_id: P1, month: '2026-10-17', amount: 120, taxable_base: 6000, reference: 'مستند ضريبة 10', request_id: rq });
    assert.equal(await hr('create', { person_id: P1, month: '2026-10-01', amount: 120, request_id: rq }), t1, 'idempotent');
    const t2 = await hr('create', { person_id: P2, month: '2026-10-01', amount: 80 });
    let r = await row(t1); assert.equal(r.tax_type, 'salary_income'); assert.equal(r.month.toISOString().slice(0, 10), '2026-10-01', 'month normalised to day 1'); assert.equal(Number(r.taxable_base), 6000);
    await assert.rejects(() => hr('create', { person_id: P1, month: '2026-10-01', amount: 1 }), /مسجل لهذا الموظف/);
    await assert.rejects(() => hr('create', { person_id: P3, month: '2026-10-01', amount: 1 }), /مستمرًا/);
    await assert.rejects(() => hr('create', { person_id: P2, month: '2999-01-01', amount: 1 }), /الشهر الحالي/);
    await assert.rejects(() => hr('create', { person_id: P2, month: '2026-09-01', amount: -5 }), /مبلغ الضريبة/);
    await assert.rejects(() => hr('create', { person_id: P2, month: '2026-09-01', amount: 1.005 }), /مبلغ الضريبة/);
    await assert.rejects(() => hr('create', { person_id: P2, month: '2026-09-01' }), /مبلغ الضريبة/);
    await assert.rejects(() => hr('create', { person_id: P2, month: '2026-09-01', amount: 5, tax_type: 'doctor_professional' }), /نوع الضريبة/, 'future types are not available until added');
    await assert.rejects(() => hr('update', { id: t2, revision: 7, amount: 80 }), /تغير/);
    await assert.rejects(() => hr('update', { id: t2, revision: 1, amount: 90 }), /سبب تغيير/);
    await hr('update', { id: t2, revision: 1, amount: 90, reason: 'تصحيح من مستند المصلحة' }); assert.equal(Number((await row(t2)).amount), 90); await hr('update', { id: t2, revision: 2, amount: 80, reason: 'تصحيح' });
    assert.equal((await owner("select count(*)::int n from clinic_people.audit where action like 'tax_%'"))[0].n, 4);

    // ---- who can write / read
    await as(2); await assert.rejects(() => hr('create', { person_id: P2, month: '2026-09-01', amount: 1 }), /الموارد البشرية/, 'accountant read-only');
    await as(4); await assert.rejects(() => hr('create', { person_id: P2, month: '2026-09-01', amount: 1 }), /الموارد البشرية/);
    await assert.rejects(() => call('hr_tax_amount', [P1, '2026-10-01', 'salary_income']), /صلاحية/);
    await as(2); let w = await call('hr_tax_workspace', ['2026-10-05']); assert.equal(w.items.length, 2); assert.equal(w.can_view_all, true); assert.equal(w.people.length, 0); assert.equal(w.tax_types.length, 1); assert(!('request_id' in w.items[0]));
    await as(4); w = await call('hr_tax_workspace', ['2026-10-05']); assert.equal(w.items.length, 0);
    await as(1); w = await call('hr_tax_workspace', ['2026-10-05']); assert.equal(w.people.length, 2); assert.equal(Number((await call('hr_tax_workspace', ['2026-11-05'])).items.length), 0);

    // ---- payroll reads the amount
    const a = await call('hr_tax_amount', [P1, '2026-10-20', 'salary_income']); assert.deepEqual([a.found, Number(a.tax), a.reference], [true, 120, 'مستند ضريبة 10']);
    const none = await call('hr_tax_amount', [P1, '2026-09-20', 'salary_income']); assert.deepEqual([none.found, Number(none.tax)], [false, 0]);

    // ---- payroll for P1 October withholds the register amount; after that the register entry is frozen
    const contract = await fin('business_command', ['request', { kind: 'employment', subject: 'EMPLOYEE-TEST', employee_name: 'موظف أول', base: 6000, from: '2026-01-01', to: '2026-12-31', reference: 'CONTRACT-TAX', note: 'عقد موظف للاختبار' }, key()]);
    await as(3); await fin('business_command', ['review', { id: contract, approve: true, note: 'اعتماد العقد' }, key()]);
    await as(1); const payroll = await fin('business_command', ['request', { kind: 'payroll', subject: 'EMPLOYEE-TEST', contract_id: contract, month: '2026-10-01', tax: 120, reference: 'PAY-OCT-T', note: 'مرتب أكتوبر' }, key()]);
    await assert.rejects(() => hr('update', { id: t1, revision: 1, amount: 130, reason: 'بعد إرسال المرتب' }), /استحقاق مرتب/, 'frozen while a payroll for that month exists');
    await as(3); await fin('business_command', ['review', { id: payroll, approve: true, note: 'اعتماد المرتب' }, key()]);
    await as(1);
    await assert.rejects(() => hr('create', { person_id: P1, month: '2026-10-01', amount: 5, tax_type: 'salary_income' }), /مسجل لهذا الموظف|استحقاق مرتب/);

    // ---- accounting month
    const month = (m, t = 'salary_income') => call('clinic_finance_tax_month', [m, t]);
    let s = await month('2026-10-20');
    assert.deepEqual([Number(s.total_due), Number(s.payroll_withheld), Number(s.liability_balance), Number(s.remaining), s.liability_account, s.lines.length], [200, 120, 120, 200, '2142', 2]);
    await assert.rejects(() => month('2026-10-01', 'stamp_duty'), /نوع الضريبة/);
    await as(4); await assert.rejects(() => month('2026-10-01'), /صلاحية/);

    // ---- payment (statutory_payment on 2142, maker-checker, capped by the recorded liability)
    await as(1);
    const pay = (amount, o = {}, tk) => call('clinic_finance_tax_pay', [o.month || '2026-10-01', o.type || 'salary_income', amount, o.method || 'bank', null, o.ref || ('TAX-' + Math.random().toString(36).slice(2, 8)), 'سداد ضريبة أكتوبر', tk || key()]);
    await assert.rejects(() => pay(500), /يتجاوز المتبقي/); await assert.rejects(() => pay(0), /موجبًا/); await assert.rejects(() => pay(5, { method: 'x' }), /قناة/); await assert.rejects(() => pay(5, { month: '2999-01-01' }), /لم يبدأ/); await assert.rejects(() => pay(5, { type: 'nope' }), /نوع الضريبة/);
    const tk = key(); const p1 = await pay(120, { ref: 'TAXRCPT-1' }, tk); assert.equal(await pay(120, { ref: 'TAXRCPT-1' }, tk), p1, 'same token, same payment');
    assert.equal((await owner('select count(*)::int n from clinic_finance.tax_payments'))[0].n, 1);
    assert.equal((await owner("select payload->>'account' a from clinic_finance.business_requests where id=$1", [p1]))[0].a, '2142');
    await assert.rejects(() => fin('business_command', ['review', { id: p1, approve: true, note: 'اعتماد ذاتي' }, key()]), /مراجع آخر/);
    await as(3); await fin('business_command', ['review', { id: p1, approve: true, note: 'مطابق للإيصال' }, key()]);
    s = await month('2026-10-01'); assert.deepEqual([Number(s.paid_approved), Number(s.liability_balance), Number(s.remaining)], [120, 0, 80]);
    await as(1); const p2 = await pay(80, { ref: 'TAXRCPT-2' }); await as(3);
    await assert.rejects(() => fin('business_command', ['review', { id: p2, approve: true, note: 'محاولة' }, key()]), /الالتزام المثبت/, 'cannot pay more than what payroll recorded');
    await fin('business_command', ['review', { id: p2, approve: false, note: 'لا يوجد التزام مثبت للمبلغ' }, key()]);
    s = await month('2026-10-01'); assert.deepEqual([Number(s.paid_approved) + Number(s.paid_pending), Number(s.remaining)], [120, 80], 'rejected payment is not counted');
    await as(4); await assert.rejects(() => pay(5), /صلاحية/);

    // ---- extensibility: a new tax type is one row (owner will send details), not a schema change
    await owner("insert into clinic_finance.tax_types(code,name,liability_account) values('stamp_duty','دمغة','2144')").catch(e => assert(/check/.test(e.message), 'only statutory liability accounts for now'));
    await owner("insert into clinic_finance.tax_types(code,name,liability_account) values('doctor_professional','ضريبة مهن غير تجارية','2141')");
    await as(1); const t3 = await hr('create', { person_id: P2, month: '2026-09-01', amount: 15, tax_type: 'doctor_professional' }); assert(t3, 'new type works with the same register');
    s = await month('2026-09-01', 'doctor_professional'); assert.deepEqual([Number(s.total_due), s.liability_account, Number(s.payroll_withheld)], [15, '2141', 0]);

    // ---- lockdown, rollback, re-apply
    await assert.rejects(() => db.query('select * from clinic_people.tax_entries'), /permission denied/); await assert.rejects(() => db.query('select * from clinic_finance.tax_types'), /permission denied/);
    await db.exec('reset role; set role anon'); await assert.rejects(() => call('hr_tax_workspace', ['2026-10-01']), /permission denied/);
    await db.exec('reset role'); await db.exec(fs.readFileSync('supabase/rollbacks/20261109130000_hr_income_tax.rollback.sql', 'utf8'));
    assert.equal((await owner("select to_regclass('clinic_people.tax_entries') t"))[0].t, null);
    assert.equal((await owner("select status from clinic_finance.business_requests where id=$1", [p1]))[0].status, 'approved');
    assert((await owner("select count(*)::int n from clinic_people.audit where action like 'tax_%'"))[0].n >= 4);
    assert.equal((await owner("select count(*)::int n from clinic_people.insurance_enrollments"))[0].n, 0, 'insurance untouched'); 
    await db.exec(MIG);
    console.log('PASS hr income tax SQL: monthly register (idempotent, guards, reason, frozen after payroll), payroll feed, month picture, payment via statutory_payment on 2142 (maker-checker, cap, idempotent), tax_type extensibility, permissions, lockdown, rollback + re-apply.');
  } finally { await db.close(); }
})().catch(e => { console.error(e); process.exit(1); });
