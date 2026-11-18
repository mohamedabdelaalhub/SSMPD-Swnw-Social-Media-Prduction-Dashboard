// SQL rehearsal of 20261118030000_tiktok_audit_post_settings.sql and its rollback on PGlite. Synthetic data only.
const { PGlite } = require('@electric-sql/pglite'), fs = require('fs'), assert = require('node:assert/strict');
const uid = n => '50000000-0000-4000-8000-' + String(n).padStart(12, '0');
(async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table admins(id uuid primary key, role text, active boolean default true);
    create table content_items(id uuid primary key);
    create function my_admin_id() returns uuid language sql stable as $$select nullif(current_setting('test.admin',true),'')::uuid$$;
    create function has_role(r text) returns boolean language sql stable security definer as $$select exists(select 1 from admins where id=my_admin_id() and role=r and active)$$;
    create function can_manage_all_content() returns boolean language sql stable as $$select has_role('super_admin')$$;
    grant usage on schema public to authenticated;`);
  await db.exec(fs.readFileSync('supabase/migrations/20261025143259_tiktok_publish_jobs_queue.sql', 'utf8'));
  await db.exec(`grant select, insert, update on public.tiktok_publish_jobs to authenticated;
    insert into admins values ('${uid(1)}','page_manager'),('${uid(2)}','designer');
    insert into content_items values ('${uid(9)}');
    -- an old row (before the migration) that the new rules would refuse must stay untouched
    insert into tiktok_publish_jobs(content_id,brand,scheduled_at,privacy_level,commercial_content) values ('${uid(9)}','sono',now(),'SELF_ONLY',true);`);
  const mig = fs.readFileSync('supabase/migrations/20261118030000_tiktok_audit_post_settings.sql', 'utf8');
  await db.exec(mig); await db.exec(mig); // idempotent
  const as = async n => { await db.exec('reset role'); await db.query("select set_config('test.admin',$1,false)", [uid(n)]); await db.exec('set role authenticated'); };
  const ins = (o = {}) => db.query(`insert into tiktok_publish_jobs(content_id,brand,scheduled_at,privacy_level,commercial_content,your_brand,branded_content,music_confirmation,title,is_aigc,created_by)
    values($1,'sono',now(),$2,$3,$4,$5,$6,$7,$8,$9) returning id,title,is_aigc`,
    [uid(9), o.privacy ?? 'PUBLIC_TO_EVERYONE', !!o.commercial, !!o.your, !!o.branded, o.music ?? true, o.title ?? 'كابشن', !!o.aigc, o.by ?? uid(1)]);

  await as(1);
  const ok = (await ins({ aigc: true, commercial: true, your: true })).rows[0];
  assert.equal(ok.title, 'كابشن'); assert.equal(ok.is_aigc, true);
  await assert.rejects(() => ins({ music: false }), /row-level security/, 'music confirmation required');
  await assert.rejects(() => ins({ privacy: 'PUBLIC' }), /privacy_level_known/);
  await assert.rejects(() => ins({ commercial: true, branded: true, privacy: 'SELF_ONLY' }), /branded_not_private/);
  await assert.rejects(() => ins({ commercial: true }), /commercial_choice/);
  await assert.rejects(() => ins({ title: 'x'.repeat(2201) }), /title_len/);
  assert.ok((await ins({ title: 'x'.repeat(2200), commercial: true, branded: true, privacy: 'FOLLOWER_OF_CREATOR' })).rows[0].id);
  await as(2); await assert.rejects(() => ins({ by: uid(2) }), /row-level security/);

  await db.exec('reset role');
  assert.equal((await db.query("select count(*)::int n from tiktok_publish_jobs where privacy_level='SELF_ONLY' and commercial_content")).rows[0].n, 1, 'old row kept');
  // rollback restores the old shape
  await db.exec(fs.readFileSync('supabase/rollbacks/20261118030000_tiktok_audit_post_settings.rollback.sql', 'utf8'));
  const cols = (await db.query("select column_name from information_schema.columns where table_name='tiktok_publish_jobs' and column_name in ('title','is_aigc')")).rows;
  assert.equal(cols.length, 0);
  await as(1); assert.ok((await db.query(`insert into tiktok_publish_jobs(content_id,brand,scheduled_at,privacy_level,created_by) values($1,'sono',now(),'PUBLIC',$2) returning id`, [uid(9), uid(1)])).rows[0].id);
  console.log('PASS: TikTok audit settings migration — caption, AI flag, privacy/branded/commercial/music guards, idempotent, rollback');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
