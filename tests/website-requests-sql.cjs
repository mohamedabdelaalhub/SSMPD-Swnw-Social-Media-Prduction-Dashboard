// Website forms → dashboard (owner 2026-11-27): table + ingest + reception list/mark + rollback, on an in-memory Postgres.
const fs = require('fs'), path = require('path'), assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const sql = f => fs.readFileSync(path.join(__dirname, '..', 'supabase', f), 'utf8');
(async () => {
  const db = new PGlite();
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema clinic_reception;
    grant usage on schema public, clinic_reception to anon, authenticated, service_role;
    create function public.has_role(r text) returns boolean language sql as $f$ select r = any(string_to_array(coalesce(current_setting('test.roles', true), ''), ',')) $f$;
    create function clinic_reception.access(p_workspace uuid, p_action text) returns uuid language plpgsql as $f$
    begin if current_setting('test.role', true) not in ('reception', 'finance') then raise exception 'ممنوع'; end if;
      if p_action = 'book' and current_setting('test.can_book', true) is distinct from 'yes' then raise exception 'ممنوع'; end if;
      return '00000000-0000-0000-0000-0000000000aa'::uuid; end $f$;`);
  await db.exec(sql('migrations/20261127010000_website_requests.sql'));
  const W = '00000000-0000-0000-0000-000000000001';
  const ing = async (id, kind, fields, ip) => (await db.query('select public.website_request_ingest($1,$2,$3::jsonb,$4) r', [id, kind, JSON.stringify(fields), ip || null])).rows[0].r;
  // service role: ingest, idempotent, whitelist, validation
  await db.exec('set role service_role');
  let r = await ing('req-0000000001', 'contact', { name: 'منى', phone: '01000000001', message: 'عايزة أسأل', evil: 'x', age: 30 }, 'ip-hash-aaaaaaaaaaaa');
  assert.equal(r.ok, true); assert.equal(r.created, true);
  const again = await ing('req-0000000001', 'contact', { message: 'تاني' }, 'ip-hash-aaaaaaaaaaaa');
  assert.deepEqual([again.ok, again.created, again.id], [true, false, r.id], 'retry returns the same request');
  await db.exec('reset role');
  const stored = (await db.query('select fields from public.website_requests where id=$1', [r.id])).rows[0].fields;
  assert.deepEqual(Object.keys(stored).sort(), ['age', 'message', 'name', 'phone'], 'only whitelisted keys are kept');
  await db.exec('set role service_role');
  assert.equal((await ing('x', 'contact', { message: 'a' })).error, 'invalid');
  assert.equal((await ing('req-0000000002', 'nope', { message: 'a' })).error, 'invalid');
  assert.equal((await ing('req-0000000003', 'job', { evil: 'a' })).error, 'invalid');
  assert.equal((await ing('req-0000000004', 'job', { name: 'a' })).error, 'invalid', 'needs message, phone or email');
  for (let i = 0; i < 9; i++) assert.equal((await ing('req-rate-00000' + i, 'job', { message: 'm' + i }, 'ip-hash-bbbbbbbbbbbb')).ok, true);
  assert.equal((await ing('req-rate-000099', 'job', { message: 'x' }, 'ip-hash-bbbbbbbbbbbb')).ok, true);
  assert.equal((await ing('req-rate-000100', 'job', { message: 'x' }, 'ip-hash-bbbbbbbbbbbb')).error, 'rate_limited');
  await db.exec('reset role');
  // anon / authenticated cannot touch the table or ingest directly
  for (const role of ['anon', 'authenticated']) {
    await db.exec('set role ' + role);
    await assert.rejects(() => db.query('select * from public.website_requests'), /permission denied/);
    await assert.rejects(() => db.query("select public.website_request_ingest('req-0000000009','job','{\"message\":\"a\"}'::jsonb,null)"), /permission denied/);
    await db.exec('reset role');
  }
  // reception: list and mark; others refused
  await db.exec("set role authenticated; set test.role = 'other'; set test.roles = 'designer'");
  await assert.rejects(() => db.query('select public.website_requests_list($1)', [W]), /ممنوع/);
  // a finance viewer passes the base 'view' check of clinic_reception.access but is refused by the role gate
  await db.exec("set test.role = 'finance'; set test.roles = 'accountant'");
  await assert.rejects(() => db.query('select public.website_requests_list($1)', [W]), /ليس لديك صلاحية/, 'finance viewer is refused');
  await db.exec("set test.role = 'reception'; set test.roles = 'reception'");
  let list = (await db.query('select public.website_requests_list($1) r', [W])).rows[0].r;
  assert.ok(list.length >= 2 && !('ip_hash' in list[0]) && !('request_id' in list[0]), 'no ip_hash / request_id in the list');
  assert.equal((await db.query("select public.website_requests_list($1,'new') r", [W])).rows[0].r.length, list.length);
  await assert.rejects(() => db.query("select public.website_requests_mark($1,$2,'done')", [W, r.id]), /ممنوع/, 'marking needs the book permission');
  await db.exec("set test.can_book = 'yes'");
  assert.equal((await db.query("select public.website_requests_mark($1,$2,'reviewed') r", [W, r.id])).rows[0].r.status, 'reviewed');
  assert.equal((await db.query("select public.website_requests_list($1,'reviewed') r", [W])).rows[0].r.length, 1);
  await assert.rejects(() => db.query("select public.website_requests_mark($1,$2,'zzz')", [W, r.id]), /حالة/);
  await assert.rejects(() => db.query("select public.website_requests_mark($1,gen_random_uuid(),'done')", [W]), /غير موجود/);
  await db.exec('reset role');
  // applying twice is refused; rollback removes everything
  await assert.rejects(() => db.exec(sql('migrations/20261127010000_website_requests.sql')), /من قبل/);
  await db.exec('rollback');
  await db.exec(sql('rollbacks/20261127010000_website_requests.rollback.sql'));
  assert.equal((await db.query("select count(*)::int n from pg_proc where proname like 'website_request%'")).rows[0].n, 0);
  assert.equal((await db.query("select to_regclass('public.website_requests') t")).rows[0].t, null);
  await db.close();
  console.log('PASS website requests: ingest (idempotent, whitelist, validation, rate limit), no direct anon/authenticated access, reception list/mark with permissions, rollback');
})().catch(e => { console.error(e); process.exit(1); });
