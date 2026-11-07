// Matcher unit tests (python) + generated import SQL applied to the migration in PGlite (synthetic fixtures only).
const { PGlite } = require('@electric-sql/pglite'), { spawnSync } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), assert = require('node:assert/strict');
(async () => {
  const unit = spawnSync('python3', ['-I', 'scripts/lab-link/test_lab_match.py'], { encoding: 'utf8' });
  assert.equal(unit.status, 0, unit.stderr);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'labimp-'));
  const gen = spawnSync('python3', ['-I', 'scripts/lab-link/build_lab_import.py', 'tests/fixtures/lab-link/lab_parsed.csv', 'tests/fixtures/lab-link/center_lab.json', out], { encoding: 'utf8' });
  assert.equal(gen.status, 0, gen.stderr);
  const sql = fs.readFileSync(path.join(out, 'lab_import.sql'), 'utf8');
  assert(!/'confirmed'/.test(sql.replace(/-- .*/g, '').replace("select i.id,s.id,'suggested'", '')), 'import must never write confirmed links');
  const clean = fs.readFileSync(path.join(out, 'lab_clean.csv'), 'utf8').split('\n');
  assert(clean.some(l => /Urine Analysis,Urine,1 day,4\.0/.test(l)), 'last test of a merged row takes the row price');
  assert(clean.some(l => /Uric acid,Pleural Urine Serum,1 day,10\.0.*split_from_merged_pdf_row/.test(l)), 'embedded price/turnaround of the first test is kept');
  assert(clean.some(l => /Thrombophilia Gene Screen.*stray_numbers_removed:80 80/.test(l)), 'stray numbers removed and flagged');
  const db = new PGlite();
  await db.exec(`create role anon;create role authenticated;
    create table admins(id uuid primary key,name text,role text,active boolean default true);
    create function my_admin_id() returns uuid language sql stable as $$select null::uuid$$;
    create schema clinic_prices;create function clinic_prices.manage() returns boolean language sql stable as $$select false$$;
    create table pricing_services(id uuid primary key,name text,base_price numeric,category text,canonical_code text,active boolean default true);`);
  for (const s of JSON.parse(fs.readFileSync('tests/fixtures/lab-link/center_lab.json', 'utf8'))) await db.query('insert into pricing_services(id,name,base_price,category,canonical_code) values($1,$2,$3,$4,$5)', [s.id, s.name, s.base_price, s.category, s.canonical_code]);
  await db.exec(fs.readFileSync('supabase/migrations/20261108120000_partner_lab_links.sql', 'utf8'));
  await db.exec(sql);
  const n1 = (await db.query('select (select count(*)::int from clinic_labs.price_items) i,(select count(*)::int from clinic_labs.item_links) l')).rows[0];
  assert.equal(n1.i, 10);            // 9 rows + 1 split
  assert(n1.l >= 10);
  assert.equal((await db.query("select count(*)::int n from clinic_labs.item_links where status<>'suggested'")).rows[0].n, 0);
  await db.exec(sql);                // idempotent
  const n2 = (await db.query('select (select count(*)::int from clinic_labs.price_items) i,(select count(*)::int from clinic_labs.item_links) l')).rows[0];
  assert.deepEqual(n2, n1);
  const ada = (await db.query("select l.rank,l.confidence,s.name from clinic_labs.item_links l join clinic_labs.price_items i on i.id=l.item_id join pricing_services s on s.id=l.service_id where i.test_name='ADA' and i.sample='Fluid' order by l.rank")).rows;
  assert.match(ada[0].name, /Fluid/);
  console.log('PASS lab link import: matcher unit tests, generated SQL applies, idempotent, nothing auto-confirmed');
})().catch(e => { console.error(e.message, e.where || ''); process.exitCode = 1; });
