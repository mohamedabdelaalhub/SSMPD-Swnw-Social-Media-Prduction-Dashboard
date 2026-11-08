// End of service / final settlement — SQL rehearsal on PGlite with the REAL finance + HR + custody + insurance + tax + offboarding migrations.
const fs = require('fs'), assert = require('node:assert/strict'), boot = require('./helpers/reception-bridge.cjs');
(async () => {
  const { db, as, call, owner, id, fin, key } = await boot(['reception_canonical_catalog', 'reception_catalog_readiness', 'reception_catalog_lock_order']);
  try {
    await db.exec("alter table admins add column if not exists email text;alter table contracting_entities add column category text default 'cash';alter table pricing_services add column created_by uuid;create or replace function public.is_super() returns boolean language sql stable as $$select has_role('super_admin')$$;");
    await owner("insert into admins(id,name,role) values($1,'HR 5','reception'),($2,'FM 6','financial_manager'),($3,'Leaver 7','reception')", [id(5), id(6), id(7)]);
    await owner("insert into admin_module_permissions values($1,'accounting',true,true,true)", [id(6)]);
    const mig = n => fs.readFileSync('supabase/migrations/' + fs.readdirSync('supabase/migrations').find(f => f.includes(n)), 'utf8');
    for (const suffix of ['human_resources_workspace', 'price_lists_workspace', 'price_lists_booking_integration']) await db.exec(fs.readFileSync('supabase/migrations/' + fs.readdirSync('supabase/migrations').find(n => n.endsWith('_' + suffix + '.sql')), 'utf8'));
    await db.exec(fs.readFileSync('supabase/migrations/20261024183344_contract_price_imports_and_service_identity.sql', 'utf8'));
    await db.exec(fs.readFileSync('supabase/migrations/20261024183400_hr_attendance_import_and_calculated_payroll.sql', 'utf8'));
    const MIG = fs.readFileSync('supabase/migrations/20261109140000_hr_offboarding.sql', 'utf8');
    await assert.rejects(() => db.exec(MIG), /طبّق ملف سجل العهد/, 'needs custody first'); await db.exec('rollback');
    await db.exec(mig('_hr_custody_register.sql')); await db.exec(mig('_hr_insurance.sql'));
    await db.exec(MIG);
    await assert.rejects(() => db.exec(MIG), /تم تطبيق هذا الملف من قبل/); await db.exec('rollback');

    // extra users: 5 = HR only, 6 = a second financial manager, 7 = the leaving employee's dashboard account
    await as(1); await owner('update admins set has_hr_access=true where id in ($1,$2)', [id(5), id(3)]);
    const cmd = (a, p) => call('hr_offboarding_command', [a, p]), tpl = (a, p) => call('hr_offboarding_template', [a, p]);
    const cas = async v => (await owner('select * from clinic_people.offboarding_cases where id=$1', [v]))[0];
    const lines = async v => (await owner('select * from clinic_people.offboarding_lines where case_id=$1 order by created_at', [v]));
    const P1 = (await owner("insert into clinic_people.people(full_name,finance_subject,admin_id,status,start_date,job_title,created_by) values('موظف مغادر','EMP-OFF',$2,'active','2025-01-01','محاسب',$1) returning id", [id(1), id(7)]))[0].id;
    const P2 = (await owner("insert into clinic_people.people(full_name,doctor_key,status,start_date,kind,created_by) values('طبيب مغادر','DOC-OFF','active','2025-01-01','doctor',$1) returning id", [id(1)]))[0].id;
    const P3 = (await owner("insert into clinic_people.people(full_name,status,created_by) values('موظف آخر','active',$1) returning id", [id(1)]))[0].id;
    const P4 = (await owner("insert into clinic_people.people(full_name,status,created_by) values('منتهي','ended',$1) returning id", [id(1)]))[0].id;

    // books: P1 has an approved payroll (net due) and an advance; doctor has an active contract; P1 holds custody
    await as(1); const contract = await fin('business_command', ['request', { kind: 'employment', subject: 'EMP-OFF', employee_name: 'موظف مغادر', base: 6000, from: '2026-01-01', to: '2026-12-31', reference: 'CONTRACT-OFF', note: 'عقد' }, key()]);
    await as(3); await fin('business_command', ['review', { id: contract, approve: true, note: 'اعتماد مطابق' }, key()]);
    await as(1); const payroll = await fin('business_command', ['request', { kind: 'payroll', subject: 'EMP-OFF', contract_id: contract, month: '2026-10-01', tax: 100, reference: 'PAY-OFF', note: 'مرتب' }, key()]);
    await as(3); await fin('business_command', ['review', { id: payroll, approve: true, note: 'اعتماد مطابق' }, key()]);
    await as(1); const adv = await fin('business_command', ['request', { kind: 'advance', subject: 'EMP-OFF', amount: 500, method: 'bank', reference: 'ADV-OFF', note: 'سلفة' }, key()]);
    await as(3); await fin('business_command', ['review', { id: adv, approve: true, note: 'اعتماد مطابق' }, key()]);
    const dueNow = Number((await owner("select clinic_finance.employee_due('EMP-OFF') d"))[0].d), advNow = Number((await owner("select clinic_finance.employee_advance('EMP-OFF') d"))[0].d);
    assert(dueNow > 0 && advNow === 500, 'fixture: due ' + dueNow + ' advance ' + advNow);
    await owner("insert into clinic_people.custody_items(item_name,category,value,status,holder_id,issued_on,created_by) values('لابتوب','device',9000,'with_holder',$1,'2025-02-01',$2),('مفاتيح','keys',300,'with_holder',$1,'2025-02-01',$2),('طابعة بالمخزن','device',100,'in_store',null,null,$2)", [P1, id(1)]);
    await owner("insert into clinic_finance.doctor_contracts(doctor_key,doctor_name,service_scope,valid_from,valid_to,rate,basis,base_scope,deduction,refund_policy,reference,status,payload,created_by,token) values('DOC-OFF','طبيب مغادر','all','2026-01-01','2027-12-31',30,'collected','invoice','none','proportional_revenue','DC-OFF','active','{}',$1,gen_random_uuid()),('DOC-OFF','طبيب مغادر','all','2026-01-01','2026-06-30',30,'collected','invoice','none','proportional_revenue','DC-OLD','active','{}',$1,gen_random_uuid())", [id(1)]);

    // ---- open
    await as(5);
    const rq = '72000000-0000-4000-8000-000000000001', today = (await owner("select (now() at time zone 'Africa/Cairo')::date d"))[0].d.toISOString().slice(0, 10);
    const lastDay = today; // lock applies when the last day has arrived
    const c1 = await cmd('open', { person_id: P1, last_day: lastDay, reason: 'resignation', request_id: rq });
    assert.equal(await cmd('open', { person_id: P1, last_day: lastDay, reason: 'resignation', request_id: rq }), c1, 'idempotent');
    await assert.rejects(() => cmd('open', { person_id: P1, last_day: lastDay, reason: 'resignation' }), /مفتوح/);
    await assert.rejects(() => cmd('open', { person_id: P4, last_day: lastDay, reason: 'resignation' }), /مستمرًا/);
    await assert.rejects(() => cmd('open', { person_id: P3, last_day: '2020-01-01', reason: 'resignation' }), /آخر يوم/);
    await assert.rejects(() => cmd('open', { person_id: P3, last_day: lastDay, reason: 'x' }), /سبب/);
    await as(2); await assert.rejects(() => cmd('open', { person_id: P3, last_day: lastDay, reason: 'resignation' }), /الموارد البشرية/, 'accountant cannot open');
    await as(4); await assert.rejects(() => call('hr_offboarding_workspace'), /صلاحية/);

    // ---- the accountant prepares the sheet
    await as(5); await assert.rejects(() => cmd('load_defaults', { id: c1 }), /صلاحية/, 'HR does not prepare the financial sheet');
    await as(2);
    await cmd('load_defaults', { id: c1 });
    let L = await lines(c1);
    assert.deepEqual(L.map(l => l.kind + ':' + l.source + ':' + Number(l.amount)).sort(), ['custody:custody:300', 'custody:custody:9000', 'due_on_him:advance:500', 'due_to_him:payroll:' + dueNow].sort(), 'defaults come from the books and the custody register');
    await cmd('load_defaults', { id: c1 }); assert.equal((await lines(c1)).length, 4, 'reloading replaces generated lines, no duplicates');
    await cmd('add_line', { id: c1, kind: 'document', label: 'عقد عمل أصلي بحوزته' });
    await cmd('add_line', { id: c1, kind: 'due_on_him', label: 'غرامة تأخير', amount: 50 });
    await assert.rejects(() => cmd('add_line', { id: c1, kind: 'due_on_him', label: 'x', amount: -1 }), /وصف|المبلغ/);
    L = await lines(c1);
    const lap = L.find(l => Number(l.amount) === 9000), keys = L.find(l => Number(l.amount) === 300), doc = L.find(l => l.kind === 'document'), fine = L.find(l => l.label === 'غرامة تأخير');
    await assert.rejects(() => cmd('remove_line', { id: c1, line_id: lap.id }), /اليدوي/);
    await cmd('remove_line', { id: c1, line_id: fine.id });
    await cmd('submit_sheet', { id: c1 });
    assert.equal((await cas(c1)).status, 'sheet_ready');
    await assert.rejects(() => cmd('submit_sheet', { id: c1 }), /مرسل/);

    // ---- approval: financial manager only, unresolved custody blocks, creator/preparer cannot approve
    await as(6);
    let rev = (await cas(c1)).revision;
    await assert.rejects(() => cmd('approve', { id: c1, revision: rev }), /عالج كل العهد/, 'custody and documents must be resolved first');
    await as(2); await assert.rejects(() => cmd('approve', { id: c1, revision: rev }), /صلاحية/, 'accountant cannot approve');
    await as(4); await assert.rejects(() => cmd('approve', { id: c1, revision: rev }), /صلاحية/);
    // resolutions are the accountant's; they push the sheet back to "requested" so it must be re-submitted
    await as(2);
    await assert.rejects(() => cmd('resolve_line', { id: c1, line_id: lap.id, resolution: 'waived' }), /سبب التنازل/);
    await assert.rejects(() => cmd('resolve_line', { id: c1, line_id: doc.id, resolution: 'deducted' }), /معالجة صحيحة/);
    await cmd('resolve_line', { id: c1, line_id: lap.id, resolution: 'returned' });
    await cmd('resolve_line', { id: c1, line_id: keys.id, resolution: 'deducted', note: 'لم تُسلَّم' });
    await cmd('resolve_line', { id: c1, line_id: doc.id, resolution: 'waived', note: 'صورة فقط' });
    assert.equal((await cas(c1)).status, 'requested');
    await cmd('submit_sheet', { id: c1 }); rev = (await cas(c1)).revision;
    await as(6); await assert.rejects(() => cmd('approve', { id: c1, revision: rev - 1 }), /تغير/);
    await as(2); await assert.rejects(() => cmd('approve', { id: c1, revision: rev }), /صلاحية/);
    await cmd('return_sheet', { id: c1, note: 'x' }).catch(e => assert.match(e.message, /صلاحية/));
    // the creator of the case (user 3 also has HR access) opens another case and can not approve it even as financial manager
    await as(3); const c2 = await cmd('open', { person_id: P3, last_day: lastDay, reason: 'termination' });
    await as(2); await cmd('add_line', { id: c2, kind: 'due_to_him', label: 'مكافأة', amount: 1000 }); await cmd('submit_sheet', { id: c2 }); const rev2 = (await cas(c2)).revision;
    await as(3); await assert.rejects(() => cmd('approve', { id: c2, revision: rev2 }), /لا يعتمد المخالصة من فتح/, 'creator cannot approve');
    await as(6); await cmd('return_sheet', { id: c2, note: 'راجع المكافأة' }); assert.equal((await cas(c2)).status, 'requested');
    await as(3); await cmd('cancel', { id: c2, reason: 'قرار بالاستمرار' }); assert.equal((await cas(c2)).status, 'cancelled');
    // a different financial manager approves the real sheet
    await as(6); await cmd('approve', { id: c1, revision: rev });
    let C = await cas(c1);
    assert.deepEqual([C.status, Number(C.net_to_him), Number(C.net_on_him), Number(C.net_amount)], ['approved', dueNow, 500 + 300, dueNow - 800], 'net = for him minus on him (deducted custody counts on him)');
    assert(C.settlement_template_id);
    await assert.rejects(() => cmd('load_defaults', { id: c1 }), /مغلق/); await as(5); await assert.rejects(() => cmd('cancel', { id: c1, reason: 'بعد الاعتماد' }), /لا يُلغى/);

    // ---- ordinary payouts to him are blocked from approval on
    await as(1);
    await assert.rejects(() => fin('business_command', ['request', { kind: 'advance', subject: 'EMP-OFF', amount: 10, method: 'bank', reference: 'ADV-2', note: 'سلفة ثانية' }, key()]), /إنهاء الخدمة/);
    assert.equal((await owner("select clinic_people.in_settlement($1) s", [P1]))[0].s, true);
    assert.equal((await owner("select clinic_people.in_settlement($1) s", [P3]))[0].s, false, 'cancelled case does not block');

    // ---- certificate: HARD BLOCK until the signed file; owner-only exception with a reason
    await as(5);
    await assert.rejects(() => cmd('issue_certificate', { id: c1 }), /قبل رفع المخالصة الموقعة/);
    await assert.rejects(() => cmd('issue_certificate', { id: c1, override_reason: 'محاولة تجاوز' }), /قبل رفع المخالصة الموقعة/, 'HR cannot override');
    await as(6); await assert.rejects(() => cmd('issue_certificate', { id: c1, override_reason: 'محاولة تجاوز' }), /الموارد البشرية/);
    await as(5);
    await assert.rejects(() => cmd('upload_signed', { id: c1, url: 'http://x/y.pdf' }), /https/);
    await assert.rejects(() => cmd('complete', { id: c1 }), /المخالصة الموقعة/);
    await cmd('upload_signed', { id: c1, url: 'https://files.example/signed-1.pdf' });
    assert.equal((await cas(c1)).status, 'signed');
    await assert.rejects(() => cmd('complete', { id: c1 }), /صرف صافي/, 'net payment must be recorded first');
    await as(2); await assert.rejects(() => cmd('record_payment', { id: c1, reference: '' }), /مرجع/);
    await as(5); await assert.rejects(() => cmd('record_payment', { id: c1, reference: 'X-1' }), /صلاحية/);
    await as(2); await cmd('record_payment', { id: c1, reference: 'SETTLE-BANK-77' });
    await as(5);
    await cmd('issue_certificate', { id: c1 }); C = await cas(c1); assert(C.cert_issued_at && C.cert_override_reason === null, 'normal issue, no override');
    await cmd('stop_insurance', { id: c1, stopped_on: lastDay, reference: 'إخطار-9', deadline: '2026-12-15' });
    C = await cas(c1); assert.deepEqual([C.insurance_stopped_on.toISOString().slice(0, 10), C.insurance_reference, C.insurance_deadline.toISOString().slice(0, 10)], [lastDay, 'إخطار-9', '2026-12-15'], 'deadline is the typed one, nothing computed');

    // ---- completion: contracts end, file closed, account locked, payouts stay blocked
    await owner("insert into clinic_people.insurance_enrollments(person_id,insurance_type,employee_deduction,started_on,created_by) values($1,'social',50,'2025-01-01',$2)", [P1, id(1)]);
    await as(2); await assert.rejects(() => cmd('complete', { id: c1 }), /الموارد البشرية/);
    await as(5); await cmd('complete', { id: c1 });
    C = await cas(c1); assert.equal(C.status, 'completed');
    let P = (await owner('select status,end_date from clinic_people.people where id=$1', [P1]))[0]; assert.equal(P.status, 'ended'); assert.equal(P.end_date.toISOString().slice(0, 10), lastDay);
    assert.equal((await owner('select active from admins where id=$1', [id(7)]))[0].active, false, 'dashboard account locked (last day arrived)');
    assert.equal((await owner("select count(*)::int n from clinic_people.insurance_enrollments where person_id=$1 and status='active'", [P1]))[0].n, 0);
    assert.equal(await call('hr_offboarding_lock_due'), 0, 'lock is idempotent');
    // doctor: complete a doctor case — the long contract ends on the last day, the already-ended one is untouched
    const c3 = await cmd('open', { person_id: P2, last_day: lastDay, reason: 'contract_end' });
    await as(2); await cmd('load_defaults', { id: c3 }); await cmd('add_line', { id: c3, kind: 'due_to_him', label: 'مستحق يدوي', amount: 5 }); await cmd('submit_sheet', { id: c3 }); const rev3 = (await cas(c3)).revision;
    await as(6); await cmd('approve', { id: c3, revision: rev3 });
    await assert.rejects(() => owner("insert into clinic_finance.doctor_payouts(doctor_key,gross,withheld,method,reference,period_from,period_to,payload,created_by,token) values('DOC-OFF',1,0,'bank','P',current_date,current_date,'{}',$1,gen_random_uuid())", [id(1)]), /إنهاء الخدمة/, 'doctor payouts blocked too');
    await as(5); await cmd('upload_signed', { id: c3, url: 'https://files.example/signed-3.pdf' }); await as(2); await cmd('record_payment', { id: c3, reference: 'SETTLE-3' }); await as(5); await cmd('complete', { id: c3 });
    const dc = await owner("select reference,valid_to from clinic_finance.doctor_contracts where doctor_key='DOC-OFF' order by reference");
    assert.equal(dc.find(x => x.reference === 'DC-OFF').valid_to.toISOString().slice(0, 10), lastDay); assert.equal(dc.find(x => x.reference === 'DC-OLD').valid_to.toISOString().slice(0, 10), '2026-06-30');
    await assert.rejects(() => cmd('complete', { id: c3 }), /بعد اعتماد/);

    // ---- owner exception: certificate before the signed file, with a recorded reason
    await as(5); const c4 = await cmd('open', { person_id: P3, last_day: lastDay, reason: 'other', reason_note: 'اختبار' });
    await as(2); await cmd('add_line', { id: c4, kind: 'due_to_him', label: 'مستحق', amount: 10 }); await cmd('submit_sheet', { id: c4 }); const rev4 = (await cas(c4)).revision;
    await as(6); await cmd('approve', { id: c4, revision: rev4 });
    await as(1);
    await assert.rejects(() => cmd('issue_certificate', { id: c4 }), /سببًا مكتوبًا/);
    await cmd('issue_certificate', { id: c4, override_reason: 'قرار المالك لظرف خاص' });
    C = await cas(c4); assert.deepEqual([C.cert_override_reason, C.cert_override_by], ['قرار المالك لظرف خاص', id(1)]);
    assert.equal((await owner("select count(*)::int n from clinic_people.audit where action='offboarding_issue_certificate'"))[0].n, 2);

    // ---- templates: versions, publish retires the previous one
    await as(5);
    const t2 = await tpl('save', { kind: 'settlement', body: 'نص مخالصة جديد من المحامي {{name}} {{net}}', note: 'مراجعة المحامي' });
    await assert.rejects(() => tpl('save', { kind: 'settlement', body: 'قصير' }), /قصير/); await assert.rejects(() => tpl('save', { kind: 'x', body: 'نص طويل بما يكفي للقبول هنا' }), /نوع/);
    await tpl('publish', { id: t2 });
    let T = await owner("select kind,version,status from clinic_people.offboarding_templates where kind='settlement' order by version"); assert.deepEqual(T.map(x => x.status), ['retired', 'published']);
    await assert.rejects(() => tpl('publish', { id: t2 }), /مسودة/);
    assert((await cas(c1)).settlement_template_id !== t2, 'approved case keeps the version it was approved with');
    await as(2); await assert.rejects(() => tpl('save', { kind: 'certificate', body: 'نص شهادة جديد بما يكفي' }), /الموارد البشرية/);

    // ---- workspace + lockdown + rollback
    await as(2); let w = await call('hr_offboarding_workspace'); assert.equal(w.can_prepare, true); assert.equal(w.can_manage, false); assert.equal(w.people.length, 0); assert(w.cases.length >= 3); assert(!('request_id' in w.cases[0]));
    await as(5); w = await call('hr_offboarding_workspace'); assert.equal(w.can_manage, true); assert(!w.people.some(x => x.id === P3 || x.id === P1), 'ended people and people with an open case are not offered'); assert(w.templates.length >= 3);
    await assert.rejects(() => db.query('select * from clinic_people.offboarding_cases'), /permission denied/);
    await db.exec('reset role; set role anon'); await assert.rejects(() => call('hr_offboarding_workspace'), /permission denied/);
    await db.exec('reset role'); await db.exec(fs.readFileSync('supabase/rollbacks/20261109140000_hr_offboarding.rollback.sql', 'utf8'));
    assert.equal((await owner("select to_regclass('clinic_people.offboarding_cases') t"))[0].t, null);
    assert.equal((await owner('select status from clinic_people.people where id=$1', [P1]))[0].status, 'ended', 'completed facts stay');
    assert((await owner("select count(*)::int n from clinic_people.audit where action like 'offboarding_%'"))[0].n > 10);
    await as(1); await fin('business_command', ['request', { kind: 'advance', subject: 'EMP-OFF', amount: 10, method: 'bank', reference: 'ADV-AFTER', note: 'سلفة بعد' }, key()]).catch(e => { throw new Error('guard must be gone after rollback: ' + e.message); });
    await db.exec('reset role'); await db.exec(MIG);
    console.log('PASS hr offboarding SQL: open/prepare/approve flow (creator cannot approve, resolution gate), net, payout guards, signed-file certificate gate + owner exception, insurance stop, completion (contracts, file, account lock), templates, permissions, lockdown, rollback, re-apply');
  } finally { await db.close(); }
})().catch(e => { console.error(e); process.exit(1); });
