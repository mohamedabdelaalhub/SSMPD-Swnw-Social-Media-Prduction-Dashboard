// Website booking form extras (owner 2026-11-27): customer_bookings.needed_service (also Masa NeededService) and .gender (dashboard only), additive and
// nullable; booking-sync-ingest validates and stores them. In-memory Postgres for the migration + rollback, structural checks for the edge function.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict'), ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const sql = f => fs.readFileSync(path.join(__dirname, '..', 'supabase', f), 'utf8');
(async () => {
  const db = new PGlite();
  await db.exec("create table public.customer_bookings(id uuid primary key default gen_random_uuid(), booking_request_id text unique, customer_name text, phone text);");
  await db.exec("insert into public.customer_bookings(booking_request_id, customer_name) values ('old-1', 'قديم');");
  await db.exec(sql('migrations/20261127180000_customer_bookings_gender_service.sql'));
  assert.equal((await db.query("select needed_service, gender from public.customer_bookings where booking_request_id='old-1'")).rows[0].gender, null, 'old rows untouched');
  await db.exec("insert into public.customer_bookings(booking_request_id, gender, needed_service) values ('n-1', 'female', 'كشف متابعة')");
  await assert.rejects(() => db.exec("insert into public.customer_bookings(booking_request_id, gender) values ('n-2', 'x')"), /check/i, 'bad gender refused');
  await assert.rejects(() => db.exec("insert into public.customer_bookings(booking_request_id, needed_service) values ('n-3', '" + 'ا'.repeat(81) + "')"), /check/i, 'service capped at 80');
  await assert.rejects(() => db.exec(sql('migrations/20261127180000_customer_bookings_gender_service.sql')), /من قبل/, 'double apply refused');
  await db.exec('rollback');
  await db.exec(sql('rollbacks/20261127180000_customer_bookings_gender_service.rollback.sql'));
  assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_name='customer_bookings' and column_name in ('gender','needed_service')")).rows[0].n, 0, 'rollback drops both');
  assert.equal((await db.query("select count(*)::int n from public.customer_bookings")).rows[0].n, 2, 'rows survive the rollback');
  await db.close();
  const f = 'supabase/functions/booking-sync-ingest/index.ts', src = fs.readFileSync(f, 'utf8');
  assert.equal(ts.createSourceFile(f, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS).parseDiagnostics.length, 0, 'ingest parses');
  assert(/body\.gender !== "male" && body\.gender !== "female"/.test(src) && /error: "invalid_gender"/.test(src) && /patch\.gender = body\.gender/.test(src), 'gender validated and stored');
  assert(/patch\.needed_service = \(textValue\(body\.needed_service\) \|\| ""\)\.slice\(0, 80\) \|\| null/.test(src), 'service trimmed to 80');
  console.log('PASS customer bookings gender / needed_service: additive migration + rollback, constraints, old rows untouched, ingest validates and stores both.');
})().catch(e => { console.error(e); process.exit(1); });
