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
  // ---- outage path: parked (fallback) bookings carry the payer step (migration 260000)
  await db.exec(`create schema clinic_reception;
    create table clinic_reception.fallback_bookings(id uuid primary key default gen_random_uuid(), booking_request_id text unique, phone text, status text default 'pending', customer_name text);
    create function clinic_reception.fallback_row(f clinic_reception.fallback_bookings) returns jsonb language sql stable as $$ select jsonb_build_object('fallback_booking_id', f.id, 'status', f.status) $$;
    create function clinic_reception.fallback_api(p_op text, p jsonb) returns jsonb language plpgsql as $$ begin
      if p_op = 'book' then insert into clinic_reception.fallback_bookings(booking_request_id, phone, customer_name) values (p->>'booking_request_id', p->>'phone', 'x') on conflict do nothing; return jsonb_build_object('ok', true, 'status', 'pending'); end if;
      return jsonb_build_object('ok', true, 'op', p_op); end $$;`);
  const F260 = 'migrations/20261127260000_fallback_bookings_payer.sql', R260 = 'rollbacks/20261127260000_fallback_bookings_payer.rollback.sql';
  await db.exec(sql(F260));
  const api = async (op, p) => (await db.query('select clinic_reception.fallback_api($1, $2::jsonb) r', [op, JSON.stringify(p)])).rows[0].r;
  const E3 = '00000000-0000-0000-0000-000000000001';
  assert.deepEqual(await api('status', { x: 1 }), { ok: true, op: 'status' }, 'other ops pass through');
  assert.equal((await api('book', { booking_request_id: 'aaaaaaaa-1111-2222-3333-444444444444', phone: '01000005555' })).ok, true, 'booking without payer unchanged');
  for (const bad of [{ payment_mode: 'cash' }, { payment_mode: 'insurance' }, { payment_mode: 'insurance', payer_entity_id: '99999999-9999-9999-9999-999999999999' }, { payment_mode: 'membership', payer_entity_id: E3, approval_no: 'AP-1234' }, { payment_mode: 'insurance', payer_entity_id: E3, approval_no: 'x;y' }, { payment_mode: 'direct', payer_entity_id: E3 }]) {
    const r = await api('book', { booking_request_id: 'bbbbbbbb-1111-2222-3333-444444444444', phone: '01000006666', ...bad });
    assert.deepEqual(r, { ok: false, error: 'invalid_payer' }, JSON.stringify(bad));
  }
  assert.equal((await db.query("select count(*)::int n from clinic_reception.fallback_bookings where booking_request_id like 'bbbbbbbb%'")).rows[0].n, 0, 'invalid payer: nothing parked');
  assert.equal((await api('book', { booking_request_id: 'cccccccc-1111-2222-3333-444444444444', phone: '+20 100 000 7777', payment_mode: 'insurance', payer_entity_id: E3, approval_no: 'AP-777' })).ok, true);
  const row = (await db.query("select clinic_reception.fallback_row(f) r from clinic_reception.fallback_bookings f where booking_request_id like 'cccccccc%'")).rows[0].r;
  assert.equal(row.payment_mode, 'insurance'); assert.equal(row.payer_entity_name, 'تأمين أ'); assert.equal(row.approval_no, 'AP-777'); assert(row.approval_at && row.fallback_booking_id, 'row keeps its old fields and adds the payer ones');
  await db.exec("insert into clinic_reception.fallback_bookings(booking_request_id, phone, customer_name, status, payment_mode, payer_entity_id) values ('dddddddd-1111-2222-3333-444444444444', '01000008888', 'y', 'pending', 'insurance', '" + E3 + "')");
  assert.equal(await att('WEB-DDDDDDDD', '01000008888', 'AP-888'), true, 'approval after booking works for a parked booking (WEB- reference)');
  assert.equal((await db.query("select approval_no from clinic_reception.fallback_bookings where booking_request_id like 'dddddddd%'")).rows[0].approval_no, 'AP-888');
  assert.equal(await att('WEB-DDDDDDDD', '01099999999', 'AP-999'), false, 'wrong phone');
  assert.equal(await att('WEB-EEEEEEEE', '01000008888', 'AP-999'), false, 'unknown parked reference');
  assert.equal(await att('SW-1', '01000001111', 'AP-5566'), true, 'confirmed bookings still work');
  assert.equal((await db.query("select has_function_privilege('anon','clinic_reception.fallback_api(text,jsonb)','execute') a, has_function_privilege('authenticated','clinic_reception.fallback_row(clinic_reception.fallback_bookings)','execute') b")).rows[0].a, false);
  await assert.rejects(() => db.exec(sql(F260)), /من قبل/, 'double apply refused'); await db.exec('rollback');
  await db.exec(sql(R260));
  assert.deepEqual(await api('status', {}), { ok: true, op: 'status' }, 'rollback restores fallback_api');
  assert.equal(Object.keys((await db.query("select clinic_reception.fallback_row(f) r from clinic_reception.fallback_bookings f limit 1")).rows[0].r).includes('payment_mode'), false, 'rollback restores fallback_row');
  assert.equal(await att('WEB-DDDDDDDD', '01000008888', 'AP-1'), false, 'rollback: attach only matches customer_bookings again');
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
