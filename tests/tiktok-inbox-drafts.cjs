// "Send to TikTok as a draft": SQL rehearsal on PGlite (super admin only, once per reel, scope check),
// the drafts list in jsdom, and the worker's chunk plan. Synthetic data only, no network.
const { PGlite } = require('@electric-sql/pglite'), fs = require('fs'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const uid = n => '60000000-0000-4000-8000-' + String(n).padStart(12, '0');
(async () => {
  // ---------- SQL ----------
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table admins(id uuid primary key, role text, active boolean default true);
    create table content_items(id uuid primary key, stage text, brand text, content_format text, design_file_url text);
    create table activity_log(content_id uuid, actor_id uuid, action text, from_stage text, to_stage text);
    create function my_admin_id() returns uuid language sql stable as $$select nullif(current_setting('test.admin',true),'')::uuid$$;
    create function has_role(r text) returns boolean language sql stable security definer as $$select exists(select 1 from admins where id=my_admin_id() and role=r and active)$$;
    create function is_super() returns boolean language sql stable security definer as $$select has_role('super_admin')$$;
    create function can_manage_all_content() returns boolean language sql stable security definer as $$select has_role('super_admin')$$;
    grant usage on schema public to authenticated;`);
  for (const f of ['20261025143235_tiktok_content_posting_setup', '20261025143259_tiktok_publish_jobs_queue', '20261118030000_tiktok_audit_post_settings'])
    await db.exec(fs.readFileSync('supabase/migrations/' + f + '.sql', 'utf8').replace(/alter table public\.meta_publish_jobs[\s\S]*?;\n\n/, '').replace(/create index if not exists meta_publish_jobs_tiktok_due_idx[\s\S]*$/, ''));
  const mig = fs.readFileSync('supabase/migrations/20261118040000_tiktok_inbox_drafts.sql', 'utf8');
  await db.exec(mig); await db.exec(mig);
  await db.exec(`grant select, insert, update on public.tiktok_publish_jobs to authenticated;
    insert into admins values ('${uid(1)}','super_admin'),('${uid(2)}','page_manager');
    insert into content_items values ('${uid(10)}','published','sono','video','https://drive.google.com/file/d/x/view'),
      ('${uid(11)}','published','sono','image','https://x/y.png'),('${uid(12)}','published','dr_dina','video','https://drive.google.com/file/d/z/view');
    insert into tiktok_accounts(brand,open_id,access_token,refresh_token,access_token_expires_at,refresh_token_expires_at,scopes)
      values ('sono','o','a','r',now(),now()+interval '1 year','{user.info.basic,video.publish}'),
             ('dr_dina','o2','a','r',now(),now()+interval '1 year','{user.info.basic,video.publish,video.upload}');`);
  const as = async n => { await db.exec('reset role'); await db.query("select set_config('test.admin',$1,false)", [uid(n)]); await db.exec('set role authenticated'); };
  const q = id => db.query('select * from public.queue_tiktok_inbox_draft($1)', [id]);
  await as(2); await assert.rejects(() => q(uid(10)), /للسوبر أدمن/);
  await as(1);
  await assert.rejects(() => q(uid(10)), /video\.upload/, 'old connection without the scope');
  await assert.rejects(() => q(uid(11)), /للفيديوهات/);
  await db.exec('reset role'); await db.exec("update tiktok_accounts set scopes='{user.info.basic,video.publish,video.upload}' where brand='sono'");
  await as(1);
  const job = (await q(uid(10))).rows[0];
  assert.equal(job.mode, 'inbox'); assert.equal(job.status, 'pending'); assert.equal(job.privacy_level, null); assert.equal(job.brand, 'sono');
  await assert.rejects(() => q(uid(10)), /قبل كده/, 'no second draft by accident');
  assert.equal((await q(uid(12))).rows[0].brand, 'dr_dina');
  // a failed send can be retried
  await db.exec('reset role'); await db.query("update tiktok_publish_jobs set status='failed' where id=$1", [job.id]);
  await as(1); assert.ok((await q(uid(10))).rows[0].id);
  // the dashboard's own insert path can't create inbox jobs, and direct posts still need privacy
  await as(2);
  await assert.rejects(() => db.query(`insert into tiktok_publish_jobs(content_id,brand,scheduled_at,privacy_level,music_confirmation,created_by,mode) values($1,'sono',now(),'PUBLIC_TO_EVERYONE',true,$2,'inbox')`, [uid(10), uid(2)]), /row-level security/);
  await assert.rejects(() => db.query(`insert into tiktok_publish_jobs(content_id,brand,scheduled_at,privacy_level,music_confirmation,created_by) values($1,'sono',now(),null,true,$2)`, [uid(10), uid(2)]), /direct_has_privacy/);
  assert.ok((await db.query(`insert into tiktok_publish_jobs(content_id,brand,scheduled_at,privacy_level,music_confirmation,created_by) values($1,'sono',now(),'PUBLIC_TO_EVERYONE',true,$2) returning id`, [uid(10), uid(2)])).rows[0].id);
  await db.exec('reset role');
  assert.equal((await db.query("select count(*)::int n from activity_log where action like '%مسودة%'")).rows[0].n, 3);
  await db.exec(fs.readFileSync('supabase/rollbacks/20261118040000_tiktok_inbox_drafts.rollback.sql', 'utf8'));
  assert.equal((await db.query("select count(*)::int n from information_schema.columns where table_name='tiktok_publish_jobs' and column_name='mode'")).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from tiktok_publish_jobs")).rows[0].n, 1, 'direct post kept');

  // ---------- worker chunk plan ----------
  const worker = fs.readFileSync('supabase/functions/tiktok-publish-process/index.ts', 'utf8');
  const src = /export function chunkPlan\(size:number,chunk=10_000_000\)\{[\s\S]*?\n\}/.exec(worker)[0].replace('export ', '').replace('(size:number,chunk=10_000_000)', '(size,chunk=10000000)');
  const chunkPlan = eval('(' + src.replace('function chunkPlan', 'function') + ')');
  assert.deepEqual(chunkPlan(3_000_000), { chunk_size: 3_000_000, total_chunk_count: 1 });
  assert.deepEqual(chunkPlan(21_000_000), { chunk_size: 10_000_000, total_chunk_count: 2 }, 'leftover rides in the last chunk');
  assert.deepEqual(chunkPlan(30_000_000), { chunk_size: 10_000_000, total_chunk_count: 3 });
  assert.match(worker, /\/v2\/post\/publish\/inbox\/video\/init\//);
  assert.match(worker, /SEND_TO_USER_INBOX/);
  assert.match(fs.readFileSync('supabase/functions/tiktok-auth/index.ts', 'utf8'), /user\.info\.basic,video\.publish,video\.upload/);

  // ---------- drafts list (jsdom) ----------
  const dom = new JSDOM('<body><div id="c"></div></body>', { url: 'https://example.com', runScripts: 'outside-only' });
  const w = dom.window, d = w.document; w.queueMicrotask = queueMicrotask;
  const toasts = [], copied = [], queued = [];
  w.SSMPDToast = { show: m => toasts.push(m) };
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: t => { copied.push(t); return Promise.resolve(); } } });
  w.confirm = () => true;
  w.SSMPDAuth = { currentAdmin: { id: uid(1), role: 'super_admin' } };
  let jobs = [];
  w.SSMPDDb = {
    listTikTokDraftCandidates: () => Promise.resolve([{ id: 'a', title: 'ريل ١', caption_text: 'كابشن ١', brand: 'sono', published_at: '2026-11-01T10:00:00Z' }, { id: 'b', title: 'ريل ٢', body: 'نص ٢', brand: 'sono' }]),
    listTikTokInboxJobs: () => Promise.resolve(jobs),
    queueTikTokInboxDraft: id => { queued.push(id); jobs = [{ content_id: id, status: 'pending' }]; return Promise.resolve({}); }
  };
  for (const f of ['i18n-dictionary.js', 'i18n.js', 'tiktok-drafts.js']) w.eval(fs.readFileSync('assets/js/' + f, 'utf8'));
  await w.SSMPDTikTokDrafts.mount(d.getElementById('c'));
  assert.equal(d.querySelectorAll('[data-tt-draft]').length, 2);
  d.querySelector('[data-tt-draft="a"]').click();
  await new Promise(r => setTimeout(r, 20));
  assert.deepEqual(copied, ['كابشن ١']); assert.deepEqual(queued, ['a']);
  assert.ok(d.querySelector('[data-tt-draft="a"]').disabled, 'button locks after sending');
  d.querySelector('[data-tt-copy="b"]').click(); await new Promise(r => setTimeout(r, 5));
  assert.equal(copied[1], 'نص ٢');
  // not shown to anyone else
  const d2 = new JSDOM('<body><div id="c"></div></body>', { runScripts: 'outside-only' }).window;
  d2.SSMPDAuth = { currentAdmin: { role: 'page_manager' } }; d2.SSMPDDb = w.SSMPDDb;
  d2.eval(fs.readFileSync('assets/js/tiktok-drafts.js', 'utf8'));
  await d2.SSMPDTikTokDrafts.mount(d2.document.getElementById('c'));
  assert.equal(d2.document.getElementById('tiktok-drafts'), null);
  console.log('PASS: TikTok inbox drafts — super admin only, once per reel, scope check, rollback, chunk plan, drafts list + caption copy');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
