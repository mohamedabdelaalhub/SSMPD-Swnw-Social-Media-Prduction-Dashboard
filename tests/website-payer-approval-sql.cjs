// Website payment step (owner 2026-11-27): payer columns on customer_bookings, names-only payer options, unambiguous-only quote,
// approval attach with one neutral answer. In-memory Postgres, migrations + rollbacks.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const sql = f => fs.readFileSync(path.join(__dirname, '..', 'supabase', f), 'utf8');
const M = ['migrations/20261127230000_customer_bookings_payer_approval.sql', 'migrations/20261127240000_website_payer_options.sql', 'migrations/20261127250000_website_booking_attach_approval.sql'];
const R = ['rollbacks/20261127250000_website_booking_attach_approval.rollback.sql', 'rollbacks/20261127240000_website_payer_options.rollback.sql', 'rollbacks/20261127230000_customer_bookings_payer_approval.rollback.sql'];
(async () => {
  const db = new PGlite();
  await db.exec(`create role service_role; create role anon; create role authenticated; create schema clinic_prices;
    create table clinic_prices.lists(id uuid primary key default gen_random_uuid(), contract_id uuid, status text);
    create table public.contracting_entities(id uuid primary key default gen_random_uuid(), name text not null, category text not null default 'cash');
    create table public.contracting_entity_contracts(id uuid primary key default gen_random_uuid(), entity_id uuid not null references public.contracting_entities(id), start_date date not null, end_date date, status text not null, discount_percent numeric default 0);
    create table public.customer_bookings(id uuid primary key default gen_random_uuid(), booking_request_id text unique, booking_reference text, phone text, status text default 'confirmed', updated_at timestamptz default now());
    insert into public.contracting_entities(id,name,category) values
      ('00000000-0000-0000-0000-000000000001','تأمين أ','insurance'),('00000000-0000-0000-0000-000000000002','نقابة ب','unions'),
      ('00000000-0000-0000-0000-000000000003','حضانة ج','cash'),('00000000-0000-0000-0000-000000000004','نادٍ د','cash'),
      ('00000000-0000-0000-0000-000000000005','تأمين منتهٍ','insurance'),('00000000-0000-0000-0000-000000000006','جهة تفاوض','cash'),('00000000-0000-0000-0000-000000000007','مرجع','doctor_referrals');
    insert into public.contracting_entity_contracts(entity_id,start_date,end_date,status,discount_percent) values
      ('00000000-0000-0000-0000-000000000001', current_date-10, null, 'active', 50), ('00000000-0000-0000-0000-000000000002', current_date-10, current_date+10, 'active', 30),
      ('00000000-0000-0000-0000-000000000003', current_date-10, null, 'active', 20), ('00000000-0000-0000-0000-000000000004', current_date-10, null, 'active', 10),
      ('00000000-0000-0000-0000-000000000005', current_date-100, current_date-1, 'active', 0), ('00000000-0000-0000-0000-000000000006', current_date-10, null, 'negotiating', 15),
      ('00000000-0000-0000-0000-000000000007', current_date-10, null, 'active', 15);
    insert into clinic_prices.lists(contract_id,status) select id,'active' from public.contracting_entity_contracts where entity_id='00000000-0000-0000-0000-000000000004';
    insert into public.customer_bookings(booking_request_id,booking_reference,phone,status) values ('b1','SW-1','+20 100 000 1111','confirmed'),('b2','SW-2','01000002222','confirmed'),('b3','SW-3','01000003333','cancelled'),('b4','SW-4','01000004444','confirmed');`);
  for (const f of M) await db.exec(sql(f));
  await db.exec("update public.customer_bookings set payment_mode='insurance', payer_entity_id='00000000-0000-0000-0000-000000000001' where booking_request_id in ('b1','b3'); update public.customer_bookings set payment_mode='direct' where booking_request_id='b4'; update public.customer_bookings set payment_mode='entity', payer_entity_id='00000000-0000-0000-0000-000000000003' where booking_request_id='b2';");
  await assert.rejects(() => db.exec("update public.customer_bookings set payment_mode='x' where booking_request_id='b1'"), /check/i, 'bad mode refused');
  await db.exec('rollback');
  await assert.rejects(() => db.exec("update public.customer_bookings set approval_no='ab' where booking_request_id='b1'"), /check/i, 'short approval refused');
  await db.exec('rollback');
  const opts = (await db.query('select public.website_payer_options() o')).rows[0].o;
  assert.deepEqual(opts.insurance.map(x => x.name), ['تأمين أ'], 'only active insurer');
  assert.deepEqual(opts.membership.map(x => x.name), ['نقابة ب']);
  assert.deepEqual(opts.entity.map(x => x.name).sort(), ['حضانة ج', 'نادٍ د'].sort(), 'cash entities with active contract only (not negotiating, not referrals)');
  assert.deepEqual(Object.keys(opts.insurance[0]).sort(), ['id', 'name'], 'names only, no prices / percentages');
  const q = async (e, b) => (await db.query('select public.website_payer_quote($1::uuid,$2::numeric,current_date) p', [e, b])).rows[0].p;
  assert.equal(Number(await q('00000000-0000-0000-0000-000000000003', 500)), 400, '20% off, no price list');
  assert.equal(await q('00000000-0000-0000-0000-000000000004', 500), null, 'price list overrides: unclear');
  assert.equal(await q('00000000-0000-0000-0000-000000000001', 500), null, 'insurance is never quoted');
  assert.equal(await q('00000000-0000-0000-0000-000000000002', 500), null, 'union not quoted');
  assert.equal(await q(null, 500), null); assert.equal(await q('00000000-0000-0000-0000-000000000003', -5), null);
  const att = async (r, p, a) => (await db.query('select public.website_booking_attach_approval($1,$2,$3) ok', [r, p, a])).rows[0].ok;
  assert.equal(await att('SW-1', '01000001111', 'AP-5566'), true, 'phone matches on last 10 digits (+20 formats)');
  assert.equal((await db.query("select approval_no from public.customer_bookings where booking_request_id='b1'")).rows[0].approval_no, 'AP-5566');
  assert.equal(await att('SW-1', '01099999999', 'AP-1'), false, 'wrong phone');
  assert.equal(await att('SW-1', '01000001111', 'x'), false, 'too short');
  assert.equal(await att('SW-1', '01000001111', "AP;drop"), false, 'bad chars');
  assert.equal(await att('SW-3', '01000003333', 'AP-777'), false, 'cancelled booking');
  assert.equal(await att('SW-4', '01000004444', 'AP-777'), false, 'direct booking has no payer');
  assert.equal(await att('NOPE', '01000001111', 'AP-777'), false, 'unknown reference');
  assert.equal(await att(null, null, null), false);
  assert.equal((await db.query("select has_function_privilege('anon','public.website_booking_attach_approval(text,text,text)','execute') a, has_function_privilege('authenticated','public.website_payer_options()','execute') b, has_function_privilege('service_role','public.website_payer_options()','execute') c")).rows[0].a, false, 'anon cannot call');
  const g = (await db.query("select has_function_privilege('authenticated','public.website_payer_options()','execute') b, has_function_privilege('service_role','public.website_payer_options()','execute') c")).rows[0];
  assert.equal(g.b, false); assert.equal(g.c, true);
  for (const f of M) await assert.rejects(() => db.exec(sql(f)), /من قبل/, 'double apply refused: ' + f), await db.exec('rollback');
  for (const f of R) await db.exec(sql(f));
  assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_name='customer_bookings' and column_name in ('payment_mode','payer_entity_id','approval_no','approval_at')")).rows[0].n, 0, 'rollback drops columns');
  assert.equal((await db.query("select count(*)::int n from pg_proc where proname like 'website_%'")).rows[0].n, 0, 'rollback drops functions');
  assert.equal((await db.query('select count(*)::int n from public.customer_bookings')).rows[0].n, 4, 'rows survive');
  await db.close();
  const ts = require('typescript'), parses = f => ts.createSourceFile(f, fs.readFileSync(f, 'utf8'), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS).parseDiagnostics.length === 0;
  const pf = 'supabase/functions/website-payer/index.ts', ps = fs.readFileSync(pf, 'utf8'), ig = fs.readFileSync('supabase/functions/booking-sync-ingest/index.ts', 'utf8');
  assert(parses(pf) && parses('supabase/functions/booking-sync-ingest/index.ts'), 'edge functions parse');
  assert(/X-Booking-Sync-Secret/.test(ps) && /error: "unauthorized"/.test(ps) && /\}, 401\)/.test(ps), 'website-payer secret-gated');
  assert(['options', 'quote', 'attach_approval'].every(o => ps.includes('body.op === "' + o + '"')) && /unknown_op/.test(ps), 'known ops only');
  assert(!/console\./.test(ps) && !/error\.message/.test(ps), 'no logs, no DB error text');
  assert(/website-payer\]\nverify_jwt|\[functions\.website-payer\][\s\S]*?verify_jwt = false/.test(fs.readFileSync('supabase/config.toml', 'utf8')), 'config entry');
  assert(/invalid_payment_mode/.test(ig) && /invalid_payer_entity_id/.test(ig) && /invalid_approval_no/.test(ig) && /patch\.approval_at = now/.test(ig), 'ingest validates payer fields');
  console.log('PASS website payer approval: columns, names-only options, unambiguous-only quote, neutral approval attach, service-role only, rollbacks.');
})().catch(e => { console.error(e); process.exit(1); });
