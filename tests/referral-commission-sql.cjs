// Referral commission (external lab/radiology only, after partner cost and supplies) + posting. PGlite rehearsal on stubs of the reception tables and the PRODUCTION text of so_attach / so_set_status (supabase/live-capture).
const { PGlite } = require('@electric-sql/pglite'), fs = require('fs'), crypto = require('crypto'), assert = require('node:assert/strict');
const live = fs.readFileSync('supabase/live-capture/20261107_public_b.sql', 'utf8');
const grab = name => { const a = live.indexOf('CREATE OR REPLACE FUNCTION public.' + name + '(p_workspace'); assert(a >= 0, name); return live.slice(a, live.indexOf('$function$;', live.indexOf('$function$', a + 200) + 10) + 11); };
const ATTACH = grab('clinic_reception_so_attach'), STATUS = grab('clinic_reception_so_set_status');
const PIN = '9d6dfad2a03938e9cfb17185898c6bf4';
const A = fs.readFileSync('supabase/migrations/20261109110000_referral_commission_external.sql', 'utf8'), AR = fs.readFileSync('supabase/rollbacks/20261109110000_referral_commission_external.rollback.sql', 'utf8');
const B = fs.readFileSync('supabase/migrations/20261109111000_referral_commission_posting.sql', 'utf8'), BR = fs.readFileSync('supabase/rollbacks/20261109111000_referral_commission_posting.rollback.sql', 'utf8');
(async () => {
  const db = new PGlite();
  const rej = async (f, re) => { await assert.rejects(f, re); await db.exec('rollback').catch(() => {}); };
  const q = async (s, a = []) => (await db.query(s, a)).rows;
  await db.exec(`create role authenticated; create role service_role; create role anon; create schema clinic_reception;
    create table clinic_reception.workspaces(id uuid primary key, mode text);
    create table clinic_reception.services_stub(id uuid primary key);
    create table clinic_reception.orders(id uuid primary key, workspace_id uuid, visit_id uuid, service_id uuid, provider_id uuid, quantity numeric default 1, price numeric, discount numeric default 0, snapshot jsonb default '{}', cost numeric default 0);
    create table clinic_reception.service_performers(service_id uuid, doctor_key text);
    create table clinic_reception.external_providers(id uuid primary key, workspace_id uuid, kind text, active boolean default true, terms jsonb default '{}');
    create table clinic_reception.provider_cost_list(provider_id uuid, service_id uuid, year int, cost numeric);
    create table clinic_reception.referral_rates(id uuid primary key default gen_random_uuid(), workspace_id uuid, doctor_key text, category text, percent numeric, valid_from date, valid_to date, unique(workspace_id, doctor_key, category, valid_from));
    create table clinic_reception.providers(id uuid primary key default gen_random_uuid(), workspace_id uuid, name text, doctor_key text, active boolean default true);
    create table clinic_reception.order_ext(order_id uuid primary key, kind text, mode text, billing_party text, referring_doctor_key text, performing_doctor_key text, external_provider_id uuid, status text default 'referred', report_file_ref text, priced jsonb);
    create table clinic_reception.journal(id uuid primary key default gen_random_uuid(), workspace_id uuid, source text, source_id uuid, dimensions jsonb);
    create table clinic_reception.journal_lines(entry_id uuid, account text, debit numeric default 0, credit numeric default 0);
    create function clinic_reception.access(w uuid, c text) returns uuid language sql as $$ select '00000000-0000-4000-8000-000000000001'::uuid $$;
    create function clinic_reception.post(p_workspace uuid,p_source text,p_id uuid,p_description text,p_debit text,p_credit text,p_amount numeric,p_dimensions jsonb default '{}') returns uuid language plpgsql as $$ declare v uuid; begin insert into clinic_reception.journal(workspace_id,source,source_id,dimensions) values(p_workspace,p_source,p_id,p_dimensions) returning id into v; insert into clinic_reception.journal_lines values(v,p_debit,p_amount,0),(v,p_credit,0,p_amount); return v; end $$;`);
  await db.exec(ATTACH.replace(/;$/, '') + ';'); await db.exec(STATUS.replace(/;$/, '') + ';');
  await db.exec('grant execute on function public.clinic_reception_so_attach(uuid,uuid,jsonb), public.clinic_reception_so_set_status(uuid,uuid,text) to authenticated');
  const def = async sig => (await q('select pg_get_functiondef($1::regprocedure) d', [sig]))[0].d, md5 = s => crypto.createHash('md5').update(s).digest('hex');
  const stBefore = await def('public.clinic_reception_so_set_status(uuid,uuid,text)');
  const SIG = 'public.clinic_reception_so_attach(uuid,uuid,jsonb)', before = await def(SIG);
  console.log('local md5 of production text:', md5(before), md5(before) === PIN ? '(= production pin)' : '(differs: PGlite formatting; structural fallback path is exercised)');
  const W = crypto.randomUUID(), P = crypto.randomUUID(), S = crypto.randomUUID(), PV = crypto.randomUUID();
  await db.exec(`insert into clinic_reception.workspaces values('${W}','live'); insert into clinic_reception.external_providers(id,workspace_id,kind,terms) values('${P}','${W}','lab','{}'),('${PV}','${W}','radiology','{"providerSharePercent":40,"centerSharePercent":60}');
    insert into clinic_reception.provider_cost_list values('${P}','${S}',extract(year from current_date)::int,400);
    insert into clinic_reception.providers(workspace_id,name,doctor_key) values('${W}','Dr Ref','REF-1');
    insert into clinic_reception.referral_rates(workspace_id,doctor_key,category,percent,valid_from) values('${W}','REF-1','lab',10,'2020-01-01'),('${W}','REF-1','radiology',10,'2020-01-01'),('${W}','REF-1','consult',10,'2020-01-01');`);
  const order = async (price, discount = 0, cost = 0) => { const id = crypto.randomUUID(); await db.query("insert into clinic_reception.orders(id,workspace_id,service_id,quantity,price,discount,cost,snapshot) values($1,$2,$3,1,$4,$5,$6,'{\"department\":\"x\"}')", [id, W, S, price, discount, cost]); return id; };
  const attach = async (id, ext) => (await q('select public.clinic_reception_so_attach($1,$2,$3::jsonb) r', [W, id, JSON.stringify(ext)]))[0].r.priced;
  const ext = o => ({ kind: 'lab', mode: 'external', provider_id: P, referring_doctor_key: 'REF-1', ...o });
  // BEFORE the fix (production behaviour): commission on net for internal too, and net not net-cost
  const o0 = await order(1000); assert.equal(+(await attach(o0, ext({}))).referral_commission, 100);
  const o0i = await order(1000); assert.equal(+(await attach(o0i, { kind: 'lab', mode: 'internal', referring_doctor_key: 'REF-1' })).referral_commission, 100);
  // apply migration A (twice must be refused), then check
  await db.exec(A); await rej(() => db.exec(A), /من قبل/);
  const oa = await order(1000, 0, 100);   // supplies 100 already known on the order
  let p = await attach(oa, ext({}));
  assert.equal(+p.provider_payable, 400); assert.equal(+p.referral_base, 500); assert.equal(+p.referral_commission, 50); assert.equal(+p.referral_supplies, 100);
  const ob = await order(1000); p = await attach(ob, ext({})); assert.equal(+p.referral_commission, 60, 'no supplies: (1000-400)*10%');
  const oc = await order(1000, 10); p = await attach(oc, ext({})); assert.equal(+p.net, 900); assert.equal(+p.referral_commission, 50, 'discount 10%: (900-400)*10%');
  const od = await order(300); p = await attach(od, ext({})); assert.equal(+p.referral_commission, 0, 'partner cost above the price: base floored at 0');
  const oi = await order(1000); p = await attach(oi, { kind: 'lab', mode: 'internal', referring_doctor_key: 'REF-1' }); assert.equal(+p.referral_commission, 0, 'internal lab: no commission'); assert.equal(+p.referral_rate, 0);
  const os = await order(1000); p = await attach(os, { kind: 'service', mode: 'internal', category: 'consult', referring_doctor_key: 'REF-1' }); assert.equal(+p.referral_commission, 0, 'internal service: no commission');
  const or = await order(1000); p = await attach(or, { kind: 'radiology', mode: 'external', billing_party: 'center', provider_id: PV, referring_doctor_key: 'REF-1' }); assert.equal(+p.provider_payable, 400); assert.equal(+p.referral_commission, 60, 'radiology external center-billed');
  const op = await order(1000); p = await attach(op, { kind: 'radiology', mode: 'external', billing_party: 'provider', provider_id: PV, referring_doctor_key: 'REF-1' }); assert.equal(+p.center_receivable, 600); assert.equal(+p.referral_commission, 60, 'provider-billed: base = center share');
  const on = await order(1000); p = await attach(on, ext({ referring_doctor_key: null })); assert.equal(+p.referral_commission, 0);
  const ou = await order(1000); p = await attach(ou, ext({ referring_doctor_key: 'NOBODY' })); assert.equal(+p.referral_commission, 0, 'doctor without a rate row');
  // grants kept by the in-place replace
  assert.equal((await q("select has_function_privilege('authenticated','public.clinic_reception_so_attach(uuid,uuid,jsonb)','execute') g"))[0].g, true);
  // rollback restores the byte-identical definition
  await db.exec(AR); assert.equal(await def(SIG), before, 'rollback byte-identical'); await db.exec(A); // re-apply is possible after rollback
  // a function that drifted (anchors missing) is refused
  await db.exec(AR);
  await db.exec(`create or replace function public.clinic_reception_so_attach(p_workspace uuid, p_order uuid, p_ext jsonb) returns jsonb language plpgsql as $$ begin return '{}'::jsonb; end $$`);
  await rej(() => db.exec(A), /تغيّرت عن نص الإنتاج/);
  await db.exec(AR);
  // ---- posting migration
  await rej(() => db.exec(B), /طبّق ملف/);
  await db.exec(A);
  await db.exec(B); await rej(() => db.exec(B), /من قبل/);
  const pay = async (id, extx) => { await attach(id, extx); await q('select public.clinic_reception_so_set_status($1,$2,$3)', [W, id, 'done']); };
  const bal = async () => +(await q("select coalesce(sum(l.credit-l.debit),0) b from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id=j.id join clinic_reception.providers pr on pr.id=(j.dimensions->>'provider_id')::uuid where pr.doctor_key='REF-1' and l.account='2120'"))[0].b;
  const q1 = await order(1000, 0, 0); await attach(q1, ext({}));
  await db.query('update clinic_reception.orders set cost=100 where id=$1', [q1]);     // supplies consumed at execution (after booking)
  await q('select public.clinic_reception_so_set_status($1,$2,$3)', [W, q1, 'scheduled']); assert.equal(+(await q('select count(*) n from clinic_reception.referral_postings'))[0].n, 0, 'only completion posts');
  await q('select public.clinic_reception_so_set_status($1,$2,$3)', [W, q1, 'done']);
  assert.equal(await bal(), 50, 'posted (1000-400-100)*10% to the doctor 2120 balance'); assert.equal((await q("select count(*) n from clinic_reception.journal_lines where account='5111' and debit=50"))[0].n, 1);
  await q('select public.clinic_reception_so_set_status($1,$2,$3)', [W, q1, 'done']); assert.equal(await bal(), 50, 'idempotent');
  const qi = await order(1000); await pay(qi, { kind: 'lab', mode: 'internal', referring_doctor_key: 'REF-1' }); assert.equal(await bal(), 50, 'internal posts nothing');
  const qn = await order(1000); await db.query("insert into clinic_reception.referral_rates(workspace_id,doctor_key,category,percent,valid_from) values($1,'NOPROV','lab',10,'2020-01-01')", [W]); await pay(qn, ext({ referring_doctor_key: 'NOPROV' }));
  assert.equal((await q("select state, amount::text a from clinic_reception.referral_postings where referring_doctor_key='NOPROV'"))[0].state, 'no_provider');
  assert.equal(await bal(), 50);
  // set_status keeps its grants and the original behaviour
  assert.equal((await q("select has_function_privilege('authenticated','public.clinic_reception_so_set_status(uuid,uuid,text)','execute') g"))[0].g, true);
  assert.equal((await q("select has_function_privilege('authenticated','clinic_reception.referral_post(uuid,uuid)','execute') g"))[0].g, false);
  await rej(() => db.exec(BR), /مرحّلة/);
  await db.exec("delete from clinic_reception.journal_lines; delete from clinic_reception.journal; update clinic_reception.referral_postings set state='zero', journal_id=null");
  await db.exec(BR); assert.equal(await def('public.clinic_reception_so_set_status(uuid,uuid,text)'), stBefore, 'set_status rollback byte-identical');
  assert.equal(await q("select to_regclass('clinic_reception.referral_postings') t").then(r => r[0].t), null);
  console.log('PASS referral commission: external-only, base after partner cost + supplies, discounts, floors, idempotent, grants kept, rollback byte-identical; posting (separate) idempotent, completion-only, no_provider reported');
})().catch(e => { console.error(e); process.exit(1); });
