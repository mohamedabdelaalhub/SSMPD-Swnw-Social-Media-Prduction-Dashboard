// One reception + accounts day (the owner's single trial): sell a patient-chosen-visits laser package, split collection,
// book / arrive / execute one visit, cancel another booking, then close the shift and let a second account review it.
const assert = require('node:assert/strict'), fs = require('node:fs'), boot = require('./helpers/reception.cjs'), { randomUUID } = require('crypto');
(async () => {
  const { db, as, rpc, id } = await boot(['reception_services_packages']);
  const w = await rpc('clinic_reception_bootstrap');
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const snap = () => rpc('clinic_reception_snapshot', { p_workspace: w, p_from: date, p_to: date });
  const cmd = (p_action, p_payload, p_token = randomUUID()) => rpc('clinic_reception_command', { p_workspace: w, p_action, p_payload, p_token });
  const s0 = await snap();
  const patient = s0.patients[0].id, provider = s0.providers[0].id;

  await db.exec('reset role');
  for (const f of ['20261114170000_reception_orthodontic_terms', '20261114171500_reception_split_receipt']) await db.exec(fs.readFileSync('supabase/migrations/' + f + '.sql', 'utf8'));
  await db.exec('alter table clinic_reception.package_templates add column pricing_package_id uuid, add column source_fingerprint text');
  await db.exec("create table public.pricing_packages(id uuid primary key default gen_random_uuid(), name text, booking_visits integer, booking_enabled boolean not null default false)");
  await db.exec(fs.readFileSync('supabase/migrations/20261114190000_reception_variable_visits.sql', 'utf8'));
  await as(1);

  // Setup (manager): second account is the "accounts" reviewer; laser visit service, fee agreement, one-visit pattern template.
  await cmd('member', { admin_id: id(2), capabilities: ['view', 'manage', 'review', 'warehouse', 'execute', 'collect', 'book'] });
  const service = (await cmd('service', { code: 'LASER-DAY', name: 'جلسة ليزر', department: 'عيادة تجربة', price: 400, minutes: 30, bom: [] })).id;
  const agreement = (await cmd('agreement', { provider_id: provider, service_code: 'LASER-DAY', rate: 20, deduct_material_cost: false, from: new Date(Date.parse(date) - 86400000).toISOString().slice(0, 10), to: '2030-01-01', reference: 'AG-DAY' })).id;
  await as(2); await cmd('agreement_review', { id: agreement, approve: true }); await as(1);
  const template = (await cmd('template', { code: 'DEVICE-DAY', name: 'باكج جهاز', price: 400, visits: 1, validity_days: 90, terms: 'الزيارات تحددها المريضة', lines: [{ visit_no: 1, service_id: service, quantity: 1 }] })).id;
  await db.exec('reset role');
  await db.query('update clinic_reception.package_templates set variable_visits=true where id=$1', [template]);
  await as(1);
  await cmd('availability', { provider_id: provider, starts_at: date + 'T06:00:00Z', ends_at: date + 'T18:00:00Z' });
  const register = (await cmd('register', { name: 'خزينة الاستقبال', direction: 'both' })).id;

  // 1) Reception opens the shift and sells 3 visits chosen by the patient (3 x 400 = 1200).
  const shift = (await cmd('shift_open', { register_id: register })).id;
  const pkg = (await cmd('package_sell', { patient_id: patient, template_id: template, visit_terms: { visits: 3 } })).id;
  let s = await snap();
  assert.equal(Number(s.packages.find(p => p.id === pkg).contract_price), 1200);
  assert.equal(s.packages.find(p => p.id === pkg).lines.length, 3);

  // 2) Split collection: 700 cash + 500 card in one receipt, idempotent on retry.
  const token = randomUUID();
  const parts = [{ amount: '700', method: 'cash', reference: 'DAY-CASH', shift_id: shift }, { amount: '500', method: 'pos', reference: 'DAY-POS', shift_id: shift }];
  const receipt = await cmd('collect_split', { patient_id: patient, package_id: pkg, parts }, token);
  assert.equal(Number(receipt.total), 1200);
  assert.deepEqual(await cmd('collect_split', { patient_id: patient, package_id: pkg, parts }, token), receipt);
  s = await snap();
  assert.equal(Number(s.packages.find(p => p.id === pkg).funded), 1200);

  // 3) Visit 1: book, arrive, execute, close.
  const a1 = (await cmd('book', { patient_id: patient, provider_id: provider, service_id: service, starts_at: date + 'T08:00:00Z', package_id: pkg, package_visit_no: 1 })).id;
  const v1 = (await cmd('arrive', { id: a1 })).id;
  s = await snap();
  const order = s.orders.find(o => o.visit_id === v1);
  assert(order, 'arrival created the service order');
  await cmd('execute', { id: order.id });
  s = await snap();
  const ent1 = s.packages.find(p => p.id === pkg).lines.find(l => l.visit_no === 1);
  assert(Number(ent1.used) >= 1, 'visit 1 consumed');

  // 4) Visit 2 is booked and then CANCELLED before arrival: the package visit is not consumed and can be booked again.
  const a2 = (await cmd('book', { patient_id: patient, provider_id: provider, service_id: service, starts_at: date + 'T10:00:00Z', package_id: pkg, package_visit_no: 2 })).id;
  await cmd('cancel', { id: a2, reason: 'المريضة طلبت التأجيل' });
  s = await snap();
  assert.equal(s.appointments.find(a => a.id === a2).status, 'cancelled');
  const ent2 = s.packages.find(p => p.id === pkg).lines.find(l => l.visit_no === 2);
  assert.equal(Number(ent2.used), 0, 'cancelled visit is not consumed');
  const a3 = (await cmd('book', { patient_id: patient, provider_id: provider, service_id: service, starts_at: date + 'T12:00:00Z', package_id: pkg, package_visit_no: 2 })).id;
  assert(a3 && a3 !== a2, 'the cancelled package visit can be booked again');

  // 5) Close the shift counting exactly the cash taken, then the accounts reviewer signs it off.
  await cmd('shift_close', { id: shift, counted: 700 });
  s = await snap();
  const closed = s.shifts.find(x => x.id === shift);
  assert.equal(Number(closed.expected), 700, 'only cash counts in the drawer');
  await assert.rejects(() => cmd('shift_review', { id: shift, note: 'نفس الشخص' }), /شخص آخر/);
  await as(2);
  await cmd('shift_review', { id: shift, note: 'تمت المراجعة — الفرق صفر' });
  await as(1);
  s = await snap();
  const reviewed = s.shifts.find(x => x.id === shift);
  assert(reviewed.reviewed_by || reviewed.status === 'reviewed' || reviewed.review_note, 'shift shows as reviewed');
  console.log('reception-day-trial OK');
})().catch(e => { console.error(e); process.exit(1); });
