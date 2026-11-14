// Patient-chosen number of visits (laser packages): SQL behaviour of 20261114190000_reception_variable_visits.
const assert = require('node:assert/strict'), fs = require('node:fs'), boot = require('./helpers/reception.cjs'), { randomUUID } = require('crypto');
(async () => {
  const { db, as, rpc } = await boot(['reception_services_packages']);
  const w = await rpc('clinic_reception_bootstrap');
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const snap = () => rpc('clinic_reception_snapshot', { p_workspace: w, p_from: date, p_to: date });
  const cmd = (p_action, p_payload, p_token = randomUUID()) => rpc('clinic_reception_command', { p_workspace: w, p_action, p_payload, p_token });
  const s0 = await snap();
  const patient = s0.patients[0].id;

  // Same order as production: orthodontic terms first (this migration patches its output), then variable visits.
  await db.exec('reset role');
  await db.exec(fs.readFileSync('supabase/migrations/20261114170000_reception_orthodontic_terms.sql', 'utf8'));
  await db.exec('alter table clinic_reception.package_templates add column pricing_package_id uuid, add column source_fingerprint text');
  await db.exec("create table public.pricing_packages(id uuid primary key default gen_random_uuid(), name text, booking_visits integer, booking_enabled boolean not null default false)");
  await db.exec(fs.readFileSync('supabase/migrations/20261114190000_reception_variable_visits.sql', 'utf8'));
  await as(1);

  const service = (await cmd('service', { code: 'LASER-VAR', name: 'جلسة ليزر', department: 'عيادة تجربة', price: 300, minutes: 30, bom: [] })).id;
  const mk = async (code, extra = {}) => (await cmd('template', { code, name: 'باكج ' + code, price: 300, visits: 1, validity_days: 90, terms: 'الزيارات تحددها المريضة', lines: [{ visit_no: 1, service_id: service, quantity: 1 }], ...extra })).id;
  const variable = await mk('VAR');
  const fixed = await mk('FIXED');
  await db.exec('reset role');
  await db.query('update clinic_reception.package_templates set variable_visits=true where id=$1', [variable]);
  await as(1);

  // 1) sale with 4 visits: price = per-visit price x visits, line repeated per visit, value split exactly.
  const pkg = (await cmd('package_sell', { patient_id: patient, template_id: variable, visit_terms: { visits: '4' } })).id;
  await db.exec('reset role');
  const row = (await db.query('select visits, contract_price, expires_on, payment_schedule from clinic_reception.packages where id=$1', [pkg])).rows[0];
  assert.equal(row.visits, 4);
  assert.equal(Number(row.contract_price), 1200);
  assert.equal(row.payment_schedule, null);
  const ent = (await db.query('select visit_no, quantity, allocated_value from clinic_reception.entitlements where package_id=$1 order by visit_no', [pkg])).rows;
  assert.deepEqual(ent.map(e => e.visit_no), [1, 2, 3, 4]);
  assert.equal(ent.reduce((a, e) => a + Number(e.allocated_value), 0), 1200);
  assert(ent.every(e => Number(e.quantity) === 1));
  await as(1);

  // 2) custom validity days + an installments schedule that must equal the NEW total.
  const odd = (await cmd('package_sell', { patient_id: patient, template_id: variable, visit_terms: { visits: 3, days: 30 }, installments: [{ due_on: date, amount: 450 }, { due_on: date, amount: 450 }] })).id;
  await db.exec('reset role');
  const oddRow = (await db.query("select visits, contract_price, (expires_on - current_date) d from clinic_reception.packages where id=$1", [odd])).rows[0];
  assert.equal(oddRow.visits, 3); assert.equal(Number(oddRow.contract_price), 900);
  assert(oddRow.d >= 29 && oddRow.d <= 31, 'validity days honoured');
  assert.equal((await db.query('select count(*)::int c from clinic_reception.installments where package_id=$1', [odd])).rows[0].c, 2);
  await as(1);
  await assert.rejects(() => cmd('package_sell', { patient_id: patient, template_id: variable, visit_terms: { visits: 3 }, installments: [{ due_on: date, amount: 300 }] }), /إجمالي الأقساط/);

  // 3) invalid input is refused and nothing is created.
  await db.exec('reset role');
  const before = (await db.query('select count(*)::int c from clinic_reception.packages')).rows[0].c;
  await as(1);
  for (const bad of [{ visits: '0' }, { visits: '366' }, { visits: 'abc' }, { visits: '2.5' }, {}, { visits: 2, days: '0' }, { visits: 2, days: '99999' }])
    await assert.rejects(() => cmd('package_sell', { patient_id: patient, template_id: variable, visit_terms: bad }), /الزيارات|المدة|مسموح/);
  await assert.rejects(() => cmd('package_sell', { patient_id: patient, template_id: variable, visit_terms: 'x' }), /الزيارات|المدة/);
  await assert.rejects(() => cmd('package_sell', { patient_id: patient, template_id: fixed, visit_terms: { visits: 2 } }), /ثابت/);
  await assert.rejects(() => cmd('package_sell', { patient_id: patient, template_id: variable, visit_terms: { visits: 2 }, orthodontic_terms: { price: '100', visits: '2', days: '30', schedule: 'visit' } }), /قالب تقويم|الزيارات|المدة/);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int c from clinic_reception.packages')).rows[0].c, before);
  await as(1);

  // 4) fixed templates are untouched: normal sale still uses the template visits and price.
  const normal = (await cmd('package_sell', { patient_id: patient, template_id: fixed })).id;
  await db.exec('reset role');
  const n = (await db.query('select visits, contract_price from clinic_reception.packages where id=$1', [normal])).rows[0];
  assert.equal(n.visits, 1); assert.equal(Number(n.contract_price), 300);
  assert.equal((await db.query('select count(*)::int c from clinic_reception.entitlements where package_id=$1', [normal])).rows[0].c, 1);

  // 5) the snapshot exposes the flag to the screen.
  await as(1);
  const snapshot = await snap();
  assert.equal(snapshot.templates.find(t => t.id === variable).variable_visits, true);
  assert.equal(snapshot.templates.find(t => t.id === fixed).variable_visits, false);
  await db.exec('reset role');

  // 6) the catalog link: the flag follows the pricing package, and a variable package must be a one-visit pattern.
  const pp = (await db.query("insert into public.pricing_packages(name, booking_visits, booking_enabled, booking_variable_visits) values ('جهاز', 1, true, true) returning id")).rows[0].id;
  await assert.rejects(() => db.query("insert into public.pricing_packages(name, booking_visits, booking_variable_visits) values ('غلط', 3, true)"), /pricing_packages_variable_visits_chk/);
  const insertTemplate = (code) => db.query("insert into clinic_reception.package_templates(workspace_id,code,name,version,price,visits,validity_days,terms,pricing_package_id,source_fingerprint) values ($1,$2,'t',1,100,1,30,'x',$3,$2) returning id, variable_visits", [w, code, pp]);
  const synced = (await insertTemplate('SYNC1')).rows[0];
  assert.equal(synced.variable_visits, true, 'new template copies the flag from its pricing package');
  await db.query('update public.pricing_packages set booking_variable_visits=false where id=$1', [pp]);
  assert.equal((await db.query('select variable_visits from clinic_reception.package_templates where id=$1', [synced.id])).rows[0].variable_visits, false, 'toggle reaches the active template');
  await db.query('update public.pricing_packages set booking_variable_visits=true where id=$1', [pp]);
  assert.equal((await db.query('select variable_visits from clinic_reception.package_templates where id=$1', [synced.id])).rows[0].variable_visits, true);

  // 7) running the migration twice is refused (no silent double patch).
  await assert.rejects(() => db.exec(fs.readFileSync('supabase/migrations/20261114190000_reception_variable_visits.sql', 'utf8')), /already|exist/);
  console.log('reception-variable-visits OK');
})().catch(e => { console.error(e); process.exit(1); });
