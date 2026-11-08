// SQL rehearsal of 20261109130000_lab_new_service_requests.sql on PGlite. Synthetic data only.
// The REAL price_import_command text (service_propose / service_review) is loaded from the repo migration, so the proposal flow is the production one.
const { PGlite } = require('@electric-sql/pglite'), fs = require('fs'), assert = require('node:assert/strict');
const id = n => '40000000-0000-4000-8000-' + String(n).padStart(12, '0');
(async () => {
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;
    create table admins(id uuid primary key,name text,role text,active boolean default true);
    create function my_admin_id() returns uuid language sql stable as $$select nullif(current_setting('test.admin',true),'')::uuid$$;
    create function has_role(r text) returns boolean language sql stable as $$select exists(select 1 from admins where id=my_admin_id() and role=r and active)$$;
    create schema clinic_prices;
    create function clinic_prices.manage() returns boolean language sql stable as $$select my_admin_id() is not null and (has_role('super_admin') or has_role('general_manager'))$$;
    create sequence clinic_prices.service_code;
    create table pricing_services(id uuid primary key default gen_random_uuid(),name text,base_price numeric default 0,category text,
      canonical_code text unique default 'SVC-'||lpad(nextval('clinic_prices.service_code')::text,7,'0'),canonical_unit text not null default '',active boolean default true,
      supplies_used jsonb default '[]',profit_margin_percent numeric default 0,created_by uuid,
      booking_enabled boolean not null default false,booking_code text,booking_department text,booking_minutes integer);
    create unique index on pricing_services(booking_code) where booking_code is not null;
    create table clinic_prices.lists(id uuid primary key,status text,revision int);
    create table clinic_prices.batches(id uuid primary key);
    create table clinic_prices.sections(id uuid primary key);
    create function clinic_prices.can_edit(uuid) returns boolean language sql as $$select true$$;
    create table clinic_prices.service_proposals(id uuid primary key default gen_random_uuid(),name text not null check(length(trim(name))>=3),category text not null,unit text not null default '',note text not null check(length(trim(note))>=3),status text not null default 'pending' check(status in ('pending','approved','rejected')),service_id uuid references public.pricing_services(id),created_by uuid not null references public.admins(id),reviewed_by uuid references public.admins(id),review_note text,created_at timestamptz not null default now());
    grant usage on schema public to authenticated;`);
  // the production price_import_command, verbatim from the repo
  const src = fs.readFileSync('supabase/migrations/20261028233357_price_section_edit_and_delete.sql', 'utf8');
  const start = src.indexOf('CREATE OR REPLACE FUNCTION public.price_import_command'), end = src.indexOf('REVOKE ALL ON FUNCTION public.price_import_command');
  assert(start >= 0 && end > start);
  await db.exec(src.slice(start, end));
  await db.exec(fs.readFileSync('supabase/migrations/20261108120000_partner_lab_links.sql', 'utf8'));
  const mig = fs.readFileSync('supabase/migrations/20261109130000_lab_new_service_requests.sql', 'utf8');
  await db.exec(mig);

  for (const [n, role, name] of [[1, 'super_admin', 'مدير'], [2, 'general_manager', 'مدير عام'], [3, 'reception', 'استقبال']]) await db.query('insert into admins(id,name,role) values($1,$2,$3)', [id(n), name, role]);
  // an existing lab service with a booking setup, to copy department/minutes from
  await db.query("insert into pricing_services(name,base_price,category,booking_enabled,booking_code,booking_department,booking_minutes) values('TSH',20,'التحاليل',true,'LAB-TSH','المعمل',10),('CBC',60,'التحاليل',true,'LAB-CBC','المعمل',10)");
  const ver = (await db.query("insert into clinic_labs.price_versions(lab_name,source_name,version) values('Lab X','Test list',1) returning id")).rows[0].id;
  const item = {};
  for (const [k, n, sample, cost] of [['hba', 'HbA1c Special', 'EDTA', 80], ['nocost', 'Blood Film', 'EDTA', null], ['nm', 'No match test', 'Serum', 15], ['conf', 'TSH Again', 'Serum', 25], ['rej', 'Rejected one', 'Serum', 12]])
    item[k] = (await db.query('insert into clinic_labs.price_items(version_id,source_row,test_name,sample,cost) values($1,$2,$3,$4,$5) returning id', [ver, Object.keys(item).length + 1, n, sample, cost])).rows[0].id;
  const tsh = (await db.query("select id from pricing_services where name='TSH'")).rows[0].id;
  const as = async n => { await db.exec('reset role'); await db.query("select set_config('test.admin',$1,false)", [id(n)]); await db.exec('set role authenticated'); };
  const cmd = async (a, p) => (await db.query('select public.lab_links_service_command($1,$2::jsonb) v', [a, JSON.stringify(p)])).rows[0].v;
  const lcmd = async (a, p) => (await db.query('select public.lab_links_command($1,$2::jsonb) v', [a, JSON.stringify(p)])).rows[0].v;
  const reqs = async () => (await db.query('select public.lab_links_service_requests() v')).rows[0].v;
  const owner = async (q, a = []) => { await db.exec('reset role'); return (await db.query(q, a)).rows; };
  const P = (k, extra) => Object.assign({ item_id: item[k], name: 'HbA1c Special', category: 'التحاليل', selling_price: 150, note: 'مطلوب من الأطباء' }, extra || {});

  // access: anon none, non-manager refused, table closed
  await db.exec('reset role');
  assert.equal((await db.query("select has_function_privilege('anon','public.lab_links_service_command(text,jsonb)','execute') v")).rows[0].v, false);
  assert.equal((await db.query("select has_function_privilege('authenticated','public.lab_links_service_requests()','execute') v")).rows[0].v, true);
  await as(3);
  await assert.rejects(() => cmd('propose', P('hba')), /لا تملك/);
  await assert.rejects(() => reqs(), /لا تملك/);
  await assert.rejects(() => db.query('select * from clinic_labs.service_requests'), /permission denied/);

  // validation
  await as(1);
  await assert.rejects(() => cmd('propose', P('hba', { name: 'ab' })), /اسم الخدمة/);
  await assert.rejects(() => cmd('propose', P('hba', { category: 'الأشعة' })), /اختر قسم/);
  await assert.rejects(() => cmd('propose', P('hba', { note: '' })), /سبب/);
  await assert.rejects(() => cmd('propose', P('hba', { selling_price: 0 })), /سعر بيع/);
  await assert.rejects(() => cmd('propose', P('hba', { selling_price: 'abc' })), /سعر بيع/);
  await assert.rejects(() => cmd('propose', P('hba', { selling_price: -5 })), /سعر بيع/);
  await assert.rejects(() => cmd('propose', P('hba', { name: 'tsh' })), /بنفس الاسم/);
  await assert.rejects(() => cmd('bogus', {}), /إجراء غير متاح/);
  assert.equal((await owner('select count(*)::int n from clinic_labs.service_requests'))[0].n, 0);

  // propose: nothing is written to pricing_services; goes through the existing proposal table
  await as(1);
  const before = (await owner('select count(*)::int n from pricing_services'))[0].n;
  await as(1);
  const pr = await cmd('propose', P('hba', { booking_enabled: true }));
  assert(pr.request_id);
  assert.equal((await owner('select count(*)::int n from pricing_services'))[0].n, before, 'no service before approval');
  const prop = (await owner('select p.* from clinic_prices.service_proposals p join clinic_labs.service_requests r on r.proposal_id=p.id'))[0];
  assert.equal(prop.status, 'pending'); assert.equal(prop.created_by, id(1)); assert.equal(prop.category, 'التحاليل'); assert(prop.note.includes('HbA1c Special') && prop.note.includes('EDTA'));
  await as(1);
  await assert.rejects(() => cmd('propose', P('hba')), /معلق|مربوط/);                    // one pending request per test
  let rs = (await reqs()).requests; assert.equal(rs.length, 1); assert.equal(rs[0].status, 'pending'); assert.equal(Number(rs[0].cost_price), 80); assert.equal(rs[0].created_by_name, 'مدير');

  // maker-checker: the creator cannot review; a reason is required; unknown decision refused
  await assert.rejects(() => cmd('review', { request_id: pr.request_id, decision: 'approved', note: 'موافق' }), /مراجع آخر/);
  await as(2);
  await assert.rejects(() => cmd('review', { request_id: pr.request_id, decision: 'approved' }), /سبب/);
  await assert.rejects(() => cmd('review', { request_id: pr.request_id, decision: 'maybe', note: 'موافق' }), /قرار/);
  // a concurrent confirm on the same test blocks the approval
  await as(2); await lcmd('choose', { item_id: item.hba, service_id: tsh, note: 'اختيار يدوي' });
  await assert.rejects(() => cmd('review', { request_id: pr.request_id, decision: 'approved', note: 'موافق' }), /مربوطًا بخدمة أخرى/);
  await lcmd('reopen', { item_id: item.hba, note: 'تراجع' });
  assert.equal((await owner('select count(*)::int n from pricing_services'))[0].n, before, 'failed approval created nothing');

  // approve: the existing flow creates the service, then price/booking/link are filled in one go
  await as(2);
  const ok = await cmd('review', { request_id: pr.request_id, decision: 'approved', note: 'موافق على الإضافة' });
  assert.equal(ok.status, 'approved');
  const svc = (await owner("select * from pricing_services where name='HbA1c Special'"))[0];
  assert.equal(Number(svc.base_price), 150); assert.equal(svc.category, 'التحاليل'); assert.equal(svc.active, true);
  assert.equal(svc.booking_enabled, true); assert.equal(svc.booking_code, svc.canonical_code); assert.equal(svc.booking_department, 'المعمل'); assert.equal(svc.booking_minutes, 10);
  assert.equal(svc.created_by, id(1), 'created under the proposer by the existing flow');
  assert.equal((await owner('select status from clinic_prices.service_proposals where id=$1', [prop.id]))[0].status, 'approved');
  const link = (await owner("select * from clinic_labs.item_links where item_id=$1 and status='confirmed'", [item.hba]))[0];
  assert.equal(link.service_id, svc.id); assert.equal(link.reviewed_by, id(2)); assert.equal(link.suggested_by, 'new-service');
  assert.equal(Number((await owner('select clinic_labs.service_cost($1) c', [svc.id]))[0].c), 80, 'lab margin base: 150 - 80');
  await as(2); let w = (await db.query('select public.lab_links_workspace() v')).rows[0].v;
  assert(w.services.some(s => s.id === svc.id && Number(s.base_price) === 150), 'new service is offered in the lab screen');
  await assert.rejects(() => cmd('review', { request_id: pr.request_id, decision: 'approved', note: 'مرة ثانية' }), /غير معلق/);
  await assert.rejects(() => cmd('propose', P('hba')), /مربوط/);

  // missing cost can be set from the request; an existing cost is never overwritten by the request
  await as(1);
  await assert.rejects(() => cmd('propose', P('nocost', { name: 'Blood Film X', cost: -1 })), /تكلفة/);
  const r2 = await cmd('propose', P('nocost', { name: 'Blood Film X', cost: 22.5, booking_enabled: false }));
  assert.equal(Number((await owner('select cost from clinic_labs.price_items where id=$1', [item.nocost]))[0].cost), 22.5);
  await as(1);
  const r3 = await cmd('propose', P('conf', { name: 'TSH Again X', cost: 999 }));
  assert.equal(Number((await owner('select cost from clinic_labs.price_items where id=$1', [item.conf]))[0].cost), 25, 'existing cost kept');
  await as(2); await cmd('review', { request_id: r2.request_id, decision: 'approved', note: 'موافق عليه' });
  const s2 = (await owner("select * from pricing_services where name='Blood Film X'"))[0];
  assert.equal(Number(s2.base_price), 150); assert.equal(s2.booking_enabled, false); assert.equal(s2.booking_code, null);

  // a test already marked "no counterpart" can still get a new service (the decision is replaced)
  await as(1); await lcmd('no_match', { item_id: item.nm, note: 'مفيش مقابل' });
  const r4 = await cmd('propose', P('nm', { name: 'No match service' }));
  await as(2); await cmd('review', { request_id: r4.request_id, decision: 'approved', note: 'موافق عليه' });
  assert.deepEqual((await owner("select status from clinic_labs.item_links where item_id=$1", [item.nm])).map(x => x.status), ['confirmed']);

  // reject: no service is created, the test goes back to review
  await as(1); const r5 = await cmd('propose', P('rej', { name: 'Rejected service' }));
  await as(2);
  await assert.rejects(() => cmd('review', { request_id: r5.request_id, decision: 'rejected', note: '' }), /سبب/);
  await cmd('review', { request_id: r5.request_id, decision: 'rejected', note: 'موجود بإسم آخر' });
  assert.equal((await owner("select count(*)::int n from pricing_services where name='Rejected service'"))[0].n, 0);
  assert.equal((await owner("select status from clinic_prices.service_proposals where id=(select proposal_id from clinic_labs.service_requests where id=$1)", [r5.request_id]))[0].status, 'rejected');
  assert.equal((await owner("select count(*)::int n from clinic_labs.item_links where item_id=$1", [item.rej]))[0].n, 0);
  await as(1); await cmd('propose', P('rej', { name: 'Rejected service 2' }));        // can propose again after a rejection
  rs = (await reqs()).requests; assert.equal(rs[0].status, 'pending'); assert(rs.some(r => r.status === 'rejected' && r.review_note === 'موجود بإسم آخر'));
  void r3;

  // everything is audited with the actor
  const audit = await owner("select action,actor_id from clinic_labs.audit where action like 'service_%' or details->>'via'='propose_service' order by id");
  assert(audit.length >= 8 && audit.every(a => a.actor_id));

  // rollback removes only what the migration added; created services stay
  await db.exec('reset role');
  await db.exec(fs.readFileSync('supabase/rollbacks/20261109130000_lab_new_service_requests.rollback.sql', 'utf8'));
  assert.equal((await db.query("select count(*)::int n from pg_proc where proname in ('lab_links_service_command','lab_links_service_requests')")).rows[0].n, 0);
  assert.equal((await db.query("select to_regclass('clinic_labs.service_requests') t")).rows[0].t, null);
  assert.equal((await db.query("select count(*)::int n from pricing_services where name='HbA1c Special'")).rows[0].n, 1);
  assert.equal((await db.query("select count(*)::int n from pg_proc where proname in ('lab_links_command','lab_links_workspace','price_import_command')")).rows[0].n, 3);
  await db.exec(mig);   // re-apply works
  await assert.rejects(() => db.exec(mig), /already applied/);
  console.log('PASS lab new-service SQL: access, validation, proposal flow reuse, maker-checker, approve+price+booking+link, missing cost, no_match replaced, reject, audit, rollback');
})().catch(e => { console.error(e.stack); process.exitCode = 1; });
