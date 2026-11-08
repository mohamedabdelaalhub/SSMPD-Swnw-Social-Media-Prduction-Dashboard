// Doctor payout Phase 2 (20261108260000): payable-now cap, tax/withholding percentages, financial-manager-only payout review. PGlite with the REAL finance migrations.
const boot = require('./helpers/clinic-finance.cjs'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path');
(async () => {
  const { db, as, fin, owner, key, range } = await boot(['clinic_doctor_settlements']);
  const mig = n => fs.readFileSync(path.resolve(__dirname, '../supabase/migrations/' + n), 'utf8');
  const id = n => '40000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const cmd = (a, p, k) => fin('doctor_command', [a, p, k || key()]);
  // admins 5 = general_manager, 6 = a second accountant; both with accounting module where relevant
  await db.query("insert into admins(id,name,role) values($1,'GM','general_manager'),($2,'Acc2','accountant')", [id(5), id(6)]);
  await db.exec(`insert into admin_module_permissions values('${id(6)}','accounting',true,true,true)`);
  await db.exec('reset role'); await db.exec(mig('20261108260000_doctor_payout_phase2.sql'));

  const reg = await (async () => { await as(1); return fin('register', ['خزينة أتعاب', 1000]); })(), sh = await fin('open_shift', [reg, key()]);
  const terms = d => ({ doctor_key: d, doctor_name: 'طبيب ' + d, scope: 'خدمة-' + d, from: range[0], to: range[1], rate: 50, basis: 'performed', base_scope: 'service', deduction: 'none', refund_policy: 'proportional_revenue', reference: 'C-' + d });
  const doctor = async d => { await as(2); const c = await cmd('contract', terms(d)); await as(3); await cmd('contract_review', { id: c, approve: true, note: 'اعتماد اختبار' }); return c; };
  let n = 0;
  const bill = async (c, d, amount) => { await as(2); return fin('bill', [{ reference: 'B-' + d + '-' + (++n), patient_ref: 'T', description: 'خدمة', service_amount: amount, items: [], doctor_contract_id: c }, key()]); };
  const pay = async (inv, amount) => { await as(1); return fin('collect', [inv, sh, 'cash', amount, 'RC-' + (++n), key()]); };
  const payable = async d => { await as(2); const r = await fin('doctor_payable', [d]); return r.doctors[0]; };
  const num = x => Number(x);
  const P = (d, gross, tp, wp, extra = {}) => { const t = Math.round(gross * tp) / 100, w = Math.round(gross * wp) / 100; return { doctor_key: d, gross, tax_pct: tp, withholding_pct: wp, withheld: t + w, method: 'bank', reference: 'PAY-' + (++n), from: range[0], to: range[1], ...extra }; };

  // ---- (a) payable now: an invoice is payable only when fully paid
  const cA = await doctor('DOC-A'), a1 = await bill(cA, 'A', 1000);     // fee 500
  let s = await payable('DOC-A');
  assert.equal(num(s.balance), 500); assert.equal(num(s.held_fees), 500); assert.equal(num(s.payable_now), 0);
  await pay(a1, 300);                                                   // partially paid: still held
  s = await payable('DOC-A'); assert.equal(num(s.payable_now), 0);
  await as(2); await assert.rejects(() => cmd('payout', P('DOC-A', 100, 0, 0)), /يتجاوز المستحق للصرف الآن/);
  await pay(a1, 700);                                                   // fully paid
  s = await payable('DOC-A'); assert.equal(num(s.held_fees), 0); assert.equal(num(s.payable_now), 500);

  // one unpaid invoice only holds its own fee
  const a2 = await bill(cA, 'A', 600);                                  // fee 300, nothing paid
  s = await payable('DOC-A'); assert.equal(num(s.balance), 800); assert.equal(num(s.held_fees), 300); assert.equal(num(s.payable_now), 500);
  await as(2); const rpc = await fin('doctor_payable', ['DOC-A']); assert.equal(rpc.held_invoices.length, 1); assert.equal(rpc.held_invoices[0].invoice_id, a2);

  // ---- (c) tax / withholding percentages
  const k1 = key();
  await assert.rejects(() => cmd('payout', { doctor_key: 'DOC-A', gross: 100, withheld: 0, method: 'bank', reference: 'NOPCT', from: range[0], to: range[1] }), /حدد نسبة الضريبة/);
  await assert.rejects(() => cmd('payout', P('DOC-A', 100, 5, 3, { withheld: 7 })), /لا يطابق النسب/);
  await assert.rejects(() => cmd('payout', P('DOC-A', 100, 60, 50)), /بين 0 و100/);
  await assert.rejects(() => cmd('payout', P('DOC-A', 100, -1, 0)), /بين 0 و100/);
  await assert.rejects(() => cmd('payout', P('DOC-A', 100, 1.234, 0, { withheld: 1.23 })), /بين 0 و100/);
  await assert.rejects(() => cmd('payout', P('DOC-A', 100, 5, 3, { net: 99 })), /صافي الصرف/);
  await assert.rejects(() => cmd('payout', P('DOC-A', 501, 0, 0)), /يتجاوز المستحق للصرف الآن \(المتاح 500/);
  const body = P('DOC-A', 500, 5, 3);   // withheld 40, net 460
  assert.equal(body.withheld, 40);
  const p1 = await cmd('payout', body, k1);
  assert.equal(await cmd('payout', body, k1), p1, 'idempotent replay returns the same payout');
  await assert.rejects(() => cmd('payout', P('DOC-A', 1, 0, 0)), /يتجاوز المستحق للصرف الآن \(المتاح 0/);   // pending payout already reserves the whole payable amount
  let row = (await owner('select gross,withheld,status,payload from clinic_finance.doctor_payouts where id=$1', [p1]))[0];
  assert.equal(num(row.gross), 500); assert.equal(num(row.withheld), 40); assert.equal(row.payload.tax_pct, 5); assert.equal(row.payload.withholding_pct, 3);
  let au = await owner("select detail from clinic_finance.audit where action='doctor_payout_terms' and entity_id=$1", [p1]);
  assert.equal(au.length, 1); assert.equal(num(au[0].detail.net), 460); assert.equal(num(au[0].detail.tax_amount), 25); assert.equal(num(au[0].detail.withholding_amount), 15); assert.equal(num(au[0].detail.payable_now), 500);

  // ---- (b) review: financial manager only; maker-checker intact
  await as(1); await assert.rejects(() => cmd('payout_review', { id: p1, approve: true, note: 'مدير عام' }), /للمدير المالي فقط/);     // a financial manager exists -> super_admin has no payout review
  await as(5); await assert.rejects(() => cmd('payout_review', { id: p1, approve: true, note: 'مدير عام' }), /للمدير المالي فقط|صلاحية/);
  await as(2); await assert.rejects(() => cmd('payout_review', { id: p1, approve: true, note: 'محاسب' }), /صلاحية/);
  await as(3); const pf = await cmd('payout', P('DOC-A', 100, 0, 0)).catch(e => e);   // FM creates (pending 500 already reserves everything) -> cap error, nothing created
  assert.match(String(pf.message), /يتجاوز/);
  // contract review stays as before: super_admin can still review contracts
  await as(2); const cx = await cmd('contract', { ...terms('DOC-X'), reference: 'C-X' }); await as(1); await cmd('contract_review', { id: cx, approve: true, note: 'مدير يراجع العقد' });
  await as(3); await cmd('payout_review', { id: p1, approve: true, note: 'تحويل مثبت' });
  row = (await owner('select status,reviewed_by from clinic_finance.doctor_payouts where id=$1', [p1]))[0]; assert.equal(row.status, 'approved'); assert.equal(row.reviewed_by, id(3));
  s = await payable('DOC-A'); assert.equal(num(s.balance), 300); assert.equal(num(s.payable_now), 0);
  const net = (await owner("select coalesce(sum(l.credit),0) c from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id where e.source='doctor_withholding' and e.source_id=$1", [p1]))[0].c; assert.equal(num(net), 40);
  au = await owner("select detail from clinic_finance.audit where action='doctor_payout_review_gate' and entity_id=$1", [p1]); assert.equal(au[0].detail.review_mode, 'financial_manager');

  // maker-checker: a financial manager cannot review his own payout; cancel is also FM-only
  await pay(a2, 600);                                                    // second invoice fully paid -> payable 300
  await as(3); const own = await cmd('payout', P('DOC-A', 100, 0, 0)); await assert.rejects(() => cmd('payout_review', { id: own, approve: true, note: 'طلبي' }), /اعتماد طلبك/);
  await as(1); await assert.rejects(() => cmd('payout_review', { id: own, approve: false, note: 'إلغاء المدير' }), /للمدير المالي فقط/);
  await as(6); await assert.rejects(() => cmd('payout_review', { id: own, approve: false, note: 'محاسب' }), /صلاحية/);
  // cancel by a different financial manager role-holder is allowed: promote accountant 6 to FM
  await owner("update admins set role='financial_manager' where id=$1", [id(6)]); await as(6); await cmd('payout_review', { id: own, approve: false, note: 'إلغاء' });
  assert.equal((await owner('select status from clinic_finance.doctor_payouts where id=$1', [own]))[0].status, 'rejected');

  // fallback: with NO active financial manager, super_admin / general_manager keep payout review (audited)
  await owner("update admins set role='accountant' where id=$1", [id(6)]);
  const f1 = (await (async () => { await as(2); return cmd('payout', P('DOC-A', 100, 0, 0)); })());
  await owner("update admins set active=false where id=$1", [id(3)]);
  await as(5); await cmd('payout_review', { id: f1, approve: true, note: 'مدير عام احتياطي' });
  au = await owner("select detail from clinic_finance.audit where action='doctor_payout_review_gate' and entity_id=$1", [f1]); assert.equal(au[0].detail.review_mode, 'fallback_manager');
  // flag: super_admin can switch the fallback off -> payout review becomes strictly financial-manager only, even with no active FM
  await as(2); const f3 = await cmd('payout', P('DOC-A', 50, 0, 0));
  await as(5); await assert.rejects(() => fin('set_payout_fallback', [false]), /للسوبر أدمن/);
  await as(1); assert.equal(await fin('set_payout_fallback', [false]), false);
  await as(5); await assert.rejects(() => cmd('payout_review', { id: f3, approve: true, note: 'مغلق' }), /للمدير المالي فقط/);
  await as(1); await fin('set_payout_fallback', [true]); await as(5); await cmd('payout_review', { id: f3, approve: false, note: 'إلغاء احتياطي' });
  assert.equal((await owner("select count(*) n from clinic_finance.audit where action='payout_manager_fallback'"))[0].n, 2);
  await owner("update admins set active=true where id=$1", [id(3)]);

  // ---- cap re-checked on approval: payable now can drop after the request was made
  await as(2); const f2 = await cmd('payout', P('DOC-A', 100, 0, 0));
  await owner("delete from clinic_finance.payments where invoice_id=$1", [a2]); await owner('select clinic_finance.doctor_sync($1)', [a2]);
  await as(3); await assert.rejects(() => cmd('payout_review', { id: f2, approve: true, note: 'اعتماد' }), /المستحق للصرف الآن أقل/);
  await cmd('payout_review', { id: f2, approve: false, note: 'رفض لحين السداد' });   // cancel still possible

  // ---- insurance / credit / contractual discount / refund count as payment only when really collected
  const cB = await doctor('DOC-B'), b1 = await bill(cB, 'B', 1000);   // fee 500
  const claim = (await owner("insert into clinic_finance.insurance_claims(invoice_id,reference,insurer,amount,created_by,token) values($1,'CL-B','شركة',600,$2,gen_random_uuid()) returning id", [b1, id(2)]))[0].id;
  await pay(b1, 400); assert.equal(num((await payable('DOC-B')).payable_now), 0, 'patient part paid, insurer part still outstanding -> held');
  const act = (kind, amount, st) => owner("insert into clinic_finance.insurance_actions(claim_id,kind,amount,reference,reason,created_by,token,status,reviewed_by,payload) values($1,$2,$3,'ACT-'||gen_random_uuid(),'اختبار',$4,gen_random_uuid(),$5,$6,'{}')", [claim, kind, amount, id(2), st, st === 'approved' ? id(3) : null]);
  await act('payment', 600, 'pending'); await owner('select clinic_finance.doctor_sync($1)', [b1]); assert.equal(num((await payable('DOC-B')).payable_now), 0, 'unapproved insurer payment does not release the fee');
  await act('payment', 600, 'approved'); await owner('select clinic_finance.doctor_sync($1)', [b1]); assert.equal(num((await payable('DOC-B')).payable_now), 500, 'approved insurer payment completes the invoice');

  const cC = await doctor('DOC-C'), c1 = await bill(cC, 'C', 1000);
  const claimC = (await owner("insert into clinic_finance.insurance_claims(invoice_id,reference,insurer,amount,created_by,token) values($1,'CL-C','شركة',200,$2,gen_random_uuid()) returning id", [c1, id(2)]))[0].id;
  await owner("insert into clinic_finance.insurance_actions(claim_id,kind,amount,reference,reason,created_by,token,status,reviewed_by,payload) values($1,'contractual',200,'CD-1','خصم تعاقدي',$2,gen_random_uuid(),'approved',$3,'{}')", [claimC, id(2), id(3)]);
  await owner('select clinic_finance.doctor_sync($1)', [c1]);      // revenue 800 -> fee 400
  await pay(c1, 800);                                              // net of the contractual discount -> fully paid
  s = await payable('DOC-C'); assert.equal(num(s.balance), 400); assert.equal(num(s.payable_now), 400);

  // ---- RPC access + shape; reception has no access; reviewer flag
  await as(4); await assert.rejects(() => fin('doctor_payable', []), /صلاحية/);
  await as(3); let all = await fin('doctor_payable', []); assert.equal(all.can_review_payouts, true); assert.equal(all.review_mode, 'financial_manager'); assert.ok(all.doctors.length >= 3);
  await as(2); all = await fin('doctor_payable', []); assert.equal(all.can_review_payouts, false);
  await as(1); all = await fin('doctor_payable', []); assert.equal(all.review_mode, null, 'super_admin has no payout review while a financial manager exists');

  // ---- no helper is reachable directly by users
  await as(2); for (const f of ['invoice_fully_paid(uuid)', 'doctor_held_fees(text)', 'doctor_payable_now(text)', 'payout_review_mode()', 'has_financial_manager()', 'doctor_command_before_payout2(text,jsonb,uuid)']) {
    const r = await owner("select has_function_privilege('authenticated', $1::regprocedure, 'execute') p", ['clinic_finance.' + f]); assert.equal(r[0].p, false, f);
  }
  // the ledger still balances
  assert.equal((await owner('select count(*) n from (select entry_id from clinic_finance.lines group by entry_id having sum(debit-credit)<>0)x'))[0].n, 0);

  // ---- rollback restores the previous command function and the old behaviour (no cap, no pct)
  await db.exec('reset role'); await db.exec(fs.readFileSync(path.resolve(__dirname, '../supabase/rollbacks/20261108260000_doctor_payout_phase2.rollback.sql'), 'utf8'));
  assert.equal((await owner("select to_regprocedure('public.clinic_finance_doctor_payable(text)') is null n"))[0].n, true);
  await as(3); const old = await cmd('payout', { doctor_key: 'DOC-C', gross: 10, withheld: 0, method: 'bank', reference: 'OLD-1', from: range[0], to: range[1] }); assert.ok(old);
  await db.close();
  console.log('PASS doctor payout phase 2: payable-now cap (full payment incl. approved insurance, contractual discount, per-invoice hold), tax/withholding %, FM-only review with audited fallback, maker-checker, cap recheck on approval, rollback.');
})().catch(e => { console.error(e.message, e.where || ''); process.exitCode = 1; });
