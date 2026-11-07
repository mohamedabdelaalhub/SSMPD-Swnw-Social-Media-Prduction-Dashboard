// SQL rehearsal of 20261108120000_partner_lab_links.sql on an in-memory Postgres (PGlite). Synthetic data only.
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

  // access: anon has no execute, a non-manager is refused, tables are not readable directly
  await db.exec('reset role');
  assert.equal((await db.query("select has_function_privilege('anon','public.lab_links_command(text,jsonb)','execute') v")).rows[0].v, false);
  assert.equal((await db.query("select has_function_privilege('authenticated','public.lab_links_workspace(uuid)','execute') v")).rows[0].v, true);
  await as(3);
  await assert.rejects(() => ws(), /لا تملك/);
  await assert.rejects(() => cmd('confirm', { item_id: item.tsh, service_id: svc.tsh }), /لا تملك/);
  await assert.rejects(() => db.query('select * from clinic_labs.item_links'), /permission denied/);

  // workspace content: items with ranked links, only active lab-category services (no X Ray, no inactive)
  await as(1);
  let w = await ws();
  assert.equal(w.items.length, 6);
  assert.equal(w.items.find(i => i.id === item.ada).links.length, 2);
  assert.equal(w.items.find(i => i.id === item.ada).links[0].rank, 1);
  assert.deepEqual(w.services.map(s => s.name).sort(), ['ADA - Fluid', 'ADA - Serum', 'CBC', 'TSH']);

  // confirm requires an existing pending suggestion; records the acting user
  await assert.rejects(() => cmd('confirm', { item_id: item.tsh, service_id: svc.cbc }), /اقتراح غير معلق/);
  await cmd('confirm', { item_id: item.tsh, service_id: svc.tsh });
  let l = (await owner("select * from clinic_labs.item_links where item_id=$1 and service_id=$2", [item.tsh, svc.tsh]))[0];
  assert.equal(l.status, 'confirmed'); assert.equal(l.reviewed_by, id(1));
  await as(1);
  await assert.rejects(() => cmd('confirm', { item_id: item.tsh, service_id: svc.tsh }), /مربوط بالفعل/);

  // reject needs a reason; rejected stays on record; restore brings it back
  await assert.rejects(() => cmd('reject', { item_id: item.ada, service_id: svc.ada_f }), /سبب/);
  await cmd('reject', { item_id: item.ada, service_id: svc.ada_f, note: 'عينة سائل مختلفة' });
  assert.equal((await owner("select status from clinic_labs.item_links where item_id=$1 and service_id=$2", [item.ada, svc.ada_f]))[0].status, 'rejected');
  await as(2); await cmd('restore', { item_id: item.ada, service_id: svc.ada_f });
  assert.equal((await owner("select status from clinic_labs.item_links where item_id=$1 and service_id=$2", [item.ada, svc.ada_f]))[0].status, 'suggested');

  // choose another service: needs a reason, inactive services refused, creates a manual confirmed link
  await as(2);
  await assert.rejects(() => cmd('choose', { item_id: item.odd, service_id: svc.cbc }), /سبب/);
  await assert.rejects(() => cmd('choose', { item_id: item.odd, service_id: inactive, note: 'اختيار يدوي' }), /غير نشطة/);
  await cmd('choose', { item_id: item.odd, service_id: svc.cbc, note: 'اسم مختلف في قائمة المركز' });
  l = (await owner("select * from clinic_labs.item_links where item_id=$1", [item.odd]))[0];
  assert.equal(l.status, 'confirmed'); assert.equal(l.suggested_by, 'manual'); assert.equal(l.reviewed_by, id(2));

  // no_match: reason required; blocks confirm until reopened; reopen needs a reason and clears it
  await as(1);
  await assert.rejects(() => cmd('no_match', { item_id: item.x }), /سبب/);
  await cmd('no_match', { item_id: item.x, note: 'غير متوفر بالمركز' });
  await assert.rejects(() => cmd('choose', { item_id: item.x, service_id: svc.cbc, note: 'محاولة' }), /بلا مقابل/);
  await cmd('reopen', { item_id: item.x, note: 'تبين وجود مقابل' });
  assert.equal((await owner("select count(*)::int n from clinic_labs.item_links where item_id=$1", [item.x]))[0].n, 0);
  await as(1);
  await assert.rejects(() => cmd('reopen', { item_id: item.x, note: 'لا شيء' }), /لا يوجد قرار/);

  // bulk confirm: ONLY high-confidence pending suggestions, one row per item, each recorded for the acting user
  await as(2);
  const bulk = await cmd('bulk_confirm', { item_ids: [item.ada, item.cbc, item.low, item.tsh, item.odd] });
  assert.equal(bulk.confirmed, 2);                     // ada (rank-1 high) + cbc; tsh/odd already decided, low is only medium
  assert.equal(bulk.skipped.length, 3);
  const bc = await owner("select item_id,reviewed_by,status from clinic_labs.item_links where status='confirmed' and review_note like 'تأكيد جماعي%' order by item_id");
  assert.equal(bc.length, 2); assert(bc.every(r => r.reviewed_by === id(2)));
  assert.equal((await owner("select status from clinic_labs.item_links where item_id=$1 and service_id=$2", [item.ada, svc.ada_f]))[0].status, 'suggested'); // sibling candidate untouched
  assert.equal((await owner("select status from clinic_labs.item_links where item_id=$1", [item.low]))[0].status, 'suggested');
  await as(2); await assert.rejects(() => cmd('bulk_confirm', { item_ids: [] }), /1 إلى 200/);

  // set_cost only fills a missing cost
  await as(1);
  await assert.rejects(() => cmd('set_cost', { item_id: item.tsh, cost: 5, note: 'تعديل' }), /مسجلة/);
  await cmd('set_cost', { item_id: item.odd, cost: 42.5, note: 'من ملف المعمل' });
  assert.equal(Number((await owner("select cost from clinic_labs.price_items where id=$1", [item.odd]))[0].cost), 42.5);

  // every action is audited with the actor
  const audit = await owner("select action,actor_id from clinic_labs.audit order by id");
  assert(audit.length >= 9 && audit.every(a => a.actor_id));
  assert.equal(Number((await owner('select clinic_labs.service_cost($1) c', [svc.tsh]))[0].c), 25);

  // rollback removes everything the migration added and leaves foreign tables alone
  await db.exec('reset role');
  await db.exec(fs.readFileSync('supabase/rollbacks/20261108120000_partner_lab_links.rollback.sql', 'utf8'));
  assert.equal((await db.query("select count(*)::int n from pg_namespace where nspname='clinic_labs'")).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from pg_proc where proname like 'lab_links_%'")).rows[0].n, 0);
  assert.equal((await db.query('select count(*)::int n from pricing_services')).rows[0].n, 6);
  await db.exec(mig); // re-apply after rollback works
  console.log('PASS lab link SQL: access, workspace, confirm/reject/choose/no_match/reopen, bulk-high-only, audit, rollback');
})().catch(e => { console.error(e.message, e.where || ''); process.exitCode = 1; });
