// Owner 2026-11-17: reviewed «إنهاء عقد». Reuses the contract-revisions SQL setup (real finance migrations on PGlite) up to the revisions migration,
// then applies 20261117170000_doctor_contract_end.sql and checks: request/review maker-checker, no retroactive end, idempotency, pending-revision guard,
// approval sets valid_to (or 'superseded' for a contract that never started), reject clears, and the contract stops resolving after its last day.
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('node:assert/strict');
const src = fs.readFileSync(path.join(__dirname, 'contract-revisions-sql.cjs'), 'utf8');
const anchor = "  const postDef = await def('clinic_finance.doctor_command_before_departments(text,jsonb,uuid)');";
const cut = src.indexOf(anchor); assert(cut > 0, 'contract-revisions-sql.cjs setup moved; update this test');
const body = `
  await db.exec('reset role'); await db.exec(mig('20261117170000_doctor_contract_end.sql'));
  await assert.rejects(async () => { await db.exec('reset role'); await db.exec(mig('20261117170000_doctor_contract_end.sql')); }, /تم تطبيق هذا الملف/); await db.exec('rollback');
  const end = async (action, payload, who, tk = key()) => { await as(who); return fin('doctor_contract_end', [action, payload, tk]); };
  const row = async cid => (await owner('select status, valid_from::text f, valid_to::text t, end_request_last_day::text req, ended_by, end_reason from clinic_finance.doctor_contracts where id=$1', [cid]))[0];
  const c1 = await mkc('DOC-E', 'D-2', 50);
  const b0 = await row(c1);
  // validation
  await assert.rejects(() => end('request', { id: c1, last_day: shift(-1), reason: 'قرار المالك' }, 2), /بأثر رجعي/);
  await assert.rejects(() => end('request', { id: c1, last_day: shift(30), reason: 'قرار المالك' }, 2), /بينتهي أصل/);
  await assert.rejects(() => end('request', { id: c1, last_day: shift(0), reason: 'قصير' }, 2), /سبب الإنهاء/);
  await assert.rejects(() => end('request', { id: c1, last_day: shift(0), reason: 'قرار المالك' }, 4), /صلاحية/, 'reception cannot request');
  // request (idempotent)
  const tk = key();
  assert.equal(await end('request', { id: c1, last_day: shift(0), reason: 'قرار المالك: استشاري' }, 3, tk), c1);
  assert.equal(await end('request', { id: c1, last_day: shift(0), reason: 'قرار المالك: استشاري' }, 3, tk), c1, 'same token = same request');
  await assert.rejects(() => end('request', { id: c1, last_day: shift(1), reason: 'طلب تاني مكرر' }, 5), /مستني المراجعة/, 'one pending end per contract');
  assert.equal((await row(c1)).req, shift(0)); assert.equal((await row(c1)).t, b0.t, 'nothing changes before review');
  // maker-checker
  await assert.rejects(() => end('review', { id: c1, approve: true }, 3), /لا يعتمد طلبه/, 'creator cannot approve');
  await assert.rejects(() => end('review', { id: c1, approve: true }, 2), /صلاحية/, 'accountant has no review right');
  await assert.rejects(() => end('review', { id: c1, approve: true }, 4), /صلاحية/);
  // reject clears
  await end('review', { id: c1, approve: false }, 1);
  assert.equal((await row(c1)).req, null); assert.equal((await row(c1)).status, 'active');
  // pending revision blocks the end request
  await as(2); const rev = await fin('doctor_command', ['contract_revise', { supersedes: c1, from: shift(10), to: shift(30), rate: 55, basis: 'performed', base_scope: 'service', deduction: 'none', refund_policy: 'proportional_revenue', reference: 'تعديل اختبار' }, key()]);
  await assert.rejects(() => end('request', { id: c1, last_day: shift(0), reason: 'قرار المالك: استشاري' }, 5), /تعديل للعقد ده مستني/);
  await as(3); await fin('doctor_command', ['contract_review', { id: rev, approve: false, note: 'رفض اختبار' }, key()]);
  // approve: valid_to = last day
  await end('request', { id: c1, last_day: shift(0), reason: 'قرار المالك: استشاري' }, 2);
  await end('review', { id: c1, approve: true, note: 'تمام' }, 3);
  const after = await row(c1);
  assert.equal(after.t, shift(0)); assert.equal(after.status, 'active'); assert.equal(after.req, null); assert(after.ended_by); assert(/قرار المالك/.test(after.end_reason) && /تمام/.test(after.end_reason));
  await assert.rejects(() => end('review', { id: c1, approve: true }, 3), /مفيش طلب إنهاء/);
  // a future contract ended before it starts becomes superseded
  await as(2); const fut = await fin('doctor_command', ['contract', { doctor_key: 'DOC-F', doctor_name: 'طبيب مستقبل', scope: 'L-1', from: shift(5), to: shift(30), rate: 40, basis: 'performed', base_scope: 'service', deduction: 'none', refund_policy: 'proportional_revenue', reference: 'اختبار' }, key()]);
  await as(3); await fin('doctor_command', ['contract_review', { id: fut, approve: true, note: 'اعتماد' }, key()]);
  await end('request', { id: fut, last_day: shift(1), reason: 'مش هيشتغل خلاص' }, 2); await end('review', { id: fut, approve: true }, 3);
  assert.equal((await row(fut)).status, 'superseded'); assert.equal((await row(fut)).t, shift(30));
  // only active contracts can be ended
  await assert.rejects(() => end('request', { id: fut, last_day: shift(2), reason: 'مرة تانية' }, 2), /معتمد فقط/);
  // rollback file works, and re-apply works
  await db.exec('reset role'); await db.exec(fs.readFileSync('supabase/rollbacks/20261117170000_doctor_contract_end.rollback.sql', 'utf8'));
  assert.equal((await owner("select to_regprocedure('public.clinic_finance_doctor_contract_end(text,jsonb,uuid)') r"))[0].r, null);
  await db.exec(mig('20261117170000_doctor_contract_end.sql'));
  await db.close();
  console.log('PASS doctor contract end: request/review maker-checker, no retroactive end, one pending, revision guard, valid_to on approval, superseded if never started, reject clears, rollback.');
})().catch(e => { console.error(e); process.exit(1); });
`;
const file = path.join(__dirname, '.doctor-contract-end-run-' + process.pid + '.cjs');
fs.writeFileSync(file, src.slice(0, cut).replace(/require\('\.\//g, "require('" + __dirname + "/") + body);
process.chdir(path.join(__dirname, '..'));
try { require(file); } finally { setTimeout(() => { try { fs.unlinkSync(file); } catch (_) {} }, 0); }
