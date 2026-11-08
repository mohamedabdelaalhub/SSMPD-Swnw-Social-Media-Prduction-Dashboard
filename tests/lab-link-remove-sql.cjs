// SQL rehearsal of 20261109120000_partner_lab_link_remove.sql (on top of 20261108120000_partner_lab_links.sql) on an in-memory Postgres (PGlite). Synthetic data only.
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
    create table pricing_services(id uuid primary key default gen_random_uuid(),name text,base_price numeric,category text,canonical_code text,active boolean default true);
    grant usage on schema public to authenticated;`);
  const mig = fs.readFileSync('supabase/migrations/20261108120000_partner_lab_links.sql', 'utf8');
  await db.exec(mig);
  const mig2 = fs.readFileSync('supabase/migrations/20261109120000_partner_lab_link_remove.sql', 'utf8');
  await db.exec(mig2);
  const admins = [[1, 'super_admin', 'مدير'], [2, 'general_manager', 'مدير عام'], [3, 'reception', 'استقبال']];
  for (const [n, role, name] of admins) await db.query('insert into admins(id,name,role) values($1,$2,$3)', [id(n), name, role]);
  const svc = {};
  for (const [k, name, price, cat] of [['ada_s', 'ADA - Serum', 500, 'التحاليل'], ['ada_f', 'ADA - Fluid', 400, 'التحاليل'], ['tsh', 'TSH', 20, 'باقي التحاليل'], ['cbc', 'CBC', 60, 'التحاليل'], ['xray', 'X Ray', 100, 'الأشعة']])
    svc[k] = (await db.query('insert into pricing_services(name,base_price,category) values($1,$2,$3) returning id', [name, price, cat])).rows[0].id;
  const inactive = (await db.query("insert into pricing_services(name,base_price,category,active) values('Old test',10,'التحاليل',false) returning id")).rows[0].id;
  const ver = (await db.query("insert into clinic_labs.price_versions(lab_name,source_name,version) values('Lab X','Test list',1) returning id")).rows[0].id;
  const item = {};
  for (const [k, n, sample, cost] of [['ada', 'ADA', 'Serum', 100], ['tsh', 'TSH', 'Serum', 25], ['cbc', 'CBC', 'EDTA', 30], ['odd', 'Odd test', null, null], ['low', 'Lowconf', null, 10], ['x', 'Other', null, 5]])
    item[k] = (await db.query('insert into clinic_labs.price_items(version_id,source_row,test_name,sample,cost) values($1,$2,$3,$4,$5) returning id', [ver, Object.keys(item).length + 1, n, sample, cost])).rows[0].id;
  const sug = (i, s, conf, rank) => db.query("insert into clinic_labs.item_links(item_id,service_id,confidence,score,rank,suggested_by) values($1,$2,$3,0.9,$4,'matcher-v2')", [item[i], svc[s], conf, rank]);
  await sug('ada', 'ada_s', 'high', 1); await sug('ada', 'ada_f', 'low', 2);
  await sug('tsh', 'tsh', 'high', 1); await sug('cbc', 'cbc', 'high', 1); await sug('low', 'cbc', 'medium', 1);
  const as = async n => { await db.exec('reset role'); await db.query("select set_config('test.admin',$1,false)", [id(n)]); await db.exec('set role authenticated'); };
  const cmd = async (a, p) => (await db.query('select public.lab_links_command($1,$2::jsonb) v', [a, JSON.stringify(p)])).rows[0].v;
  const ws = async () => (await db.query('select public.lab_links_workspace() v')).rows[0].v;
  const owner = async (q, a = []) => { await db.exec('reset role'); return (await db.query(q, a)).rows; };

  const rows = async () => (await ws()).items;
  const row = async k => (await rows()).find(i => i.id === item[k]);
  // access unchanged
  await db.exec('reset role');
  assert.equal((await db.query("select has_function_privilege('anon','public.lab_links_command(text,jsonb)','execute') v")).rows[0].v, false);
  assert.equal((await db.query("select has_function_privilege('authenticated','public.lab_links_command(text,jsonb)','execute') v")).rows[0].v, true);
  assert.equal((await db.query("select has_function_privilege('authenticated','clinic_labs.command_before_remove(text,jsonb)','execute') v")).rows[0].v, false);
  await as(3);
  await assert.rejects(() => cmd('remove_row', { item_id: item.odd, note: 'لا مقابل' }), /لا تملك/);
  await assert.rejects(() => ws(), /لا تملك/);
  await as(1);
  // old actions still work through the wrapper
  await cmd('confirm', { item_id: item.tsh, service_id: svc.tsh });
  assert.equal((await row('tsh')).links.find(l => l.status === 'confirmed').service_id, svc.tsh);
  // remove: reason required, confirmed rows refused, unmatched rows can be removed
  await assert.rejects(() => cmd('remove_row', { item_id: item.odd }), /سبب/);
  await assert.rejects(() => cmd('remove_row', { item_id: item.tsh, note: 'لا مقابل' }), /مربوط/);
  assert.equal((await row('odd')).removed_at, null);
  await cmd('remove_row', { item_id: item.odd, note: 'غير موجود عندنا' });
  const r = await row('odd');
  assert(r.removed_at && r.removed_by === id(1) && r.removed_note === 'غير موجود عندنا', 'marks exposed');
  assert.equal((await ws()).reviewers[id(1)], 'مدير');
  await assert.rejects(() => cmd('remove_row', { item_id: item.odd, note: 'مرة تانية' }), /محذوف بالفعل/);
  // a removed row refuses every other action until restored; the cost and candidates stay
  for (const [a, p] of [['no_match', { note: 'سبب ما' }], ['choose', { service_id: svc.cbc, note: 'سبب ما' }], ['set_cost', { cost: 5, note: 'مصدر' }], ['reopen', { note: 'سبب ما' }]])
    await assert.rejects(() => cmd(a, { item_id: item.odd, ...p }), /محذوف/);
  // a no_match row can be removed too, and still keeps its decision + cost
  await cmd('no_match', { item_id: item.x, note: 'ليس عندنا' });
  await cmd('remove_row', { item_id: item.x, note: 'إغلاق صف بلا مقابل' });
  const x = await row('x');
  assert(x.removed_at && x.cost === 5 && x.links.some(l => l.status === 'no_match'), 'cost + decision kept');
  assert.equal(Number((await owner('select cost from clinic_labs.price_items where id=$1', [item.x]))[0].cost), 5);
  // bulk confirm skips removed rows and reports them
  await cmd('remove_row', { item_id: item.cbc, note: 'سبب الحذف' });
  const b = await cmd('bulk_confirm', { item_ids: [item.cbc, item.ada] });
  assert.equal(b.confirmed, 1); assert(b.skipped.some(z => z.item_id === item.cbc && /محذوف/.test(z.reason)));
  const b2 = await cmd('bulk_confirm', { item_ids: [item.cbc] });
  assert.equal(b2.confirmed, 0);
  // restore
  await assert.rejects(() => cmd('restore_row', { item_id: item.ada }), /غير محذوف/);
  await cmd('restore_row', { item_id: item.cbc });
  assert.equal((await row('cbc')).removed_at, null);
  await cmd('no_match', { item_id: item.cbc, note: 'يعمل بعد الاسترجاع' });
  // audit trail
  const au = await owner("select action from clinic_labs.audit where action in ('remove_row','restore_row') order by id");
  assert.deepEqual(au.map(a => a.action), ['remove_row', 'remove_row', 'remove_row', 'restore_row']);
  assert.equal(Number((await owner("select (details->>'cost_kept')::numeric c from clinic_labs.audit where action='remove_row' and item_id=$1", [item.x]))[0].c), 5);
  // the service cost for reports ignores removal (confirmed rows cannot be removed anyway)
  assert.equal(Number((await owner('select clinic_labs.service_cost($1) c', [svc.tsh]))[0].c), 25);
  // idempotent re-apply is refused; byte-clean rollback restores the reviewed functions
  await db.exec('reset role');
  await assert.rejects(() => db.exec(mig2), /من قبل/);
  await db.exec('rollback');
  await db.exec(fs.readFileSync('supabase/rollbacks/20261109120000_partner_lab_link_remove.rollback.sql', 'utf8'));
  await as(1);
  assert.equal(Object.keys((await ws()).items[0]).includes('removed_at'), false);
  await db.exec('reset role');
  await db.exec(mig2);   // re-appliable after rollback
  assert.equal(Number((await owner('select count(*)::int c from clinic_labs.price_items'))[0].c), 6, 'no row ever deleted');
  console.log('PASS lab link remove SQL: permission, reason, confirmed refused, removed row frozen, cost kept, bulk skip, restore, audit, rollback');
})().catch(e => { console.error(e.stack || e.message); process.exitCode = 1; });
