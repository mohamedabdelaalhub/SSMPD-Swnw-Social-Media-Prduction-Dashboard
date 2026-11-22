// Instinct voice-over job queue (supabase/migrations/20261122100000_vo_jobs.sql): submit guards, worker lease/sent/done/fail,
// 30-minute timeout, stale-lease requeue, permissions (service_role only).
const { PGlite } = require('@electric-sql/pglite'), fs = require('fs'), assert = require('assert/strict');
(async () => {
  const db = new PGlite();
  await db.exec('create role authenticated; create role anon; create role service_role;');
  await db.exec(fs.readFileSync('supabase/migrations/20261122100000_vo_jobs.sql', 'utf8'));
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const submit = (script, voice = 'auto', energy = 'moderate', notes = null) =>
    one('select public.vo_job_submit($1,$2,$3,$4) id', [script, voice, energy, notes]).then((r) => r.id);
  const api = (action, payload) => one('select public.vo_worker_api($1,$2::jsonb) r', [action, JSON.stringify(payload)]).then((r) => r.r);
  const get = (id) => one('select public.vo_job_get($1) r', [id]).then((r) => r.r);

  // guards
  await assert.rejects(submit(''), /script/);
  await assert.rejects(submit('x', 'robot'), /voice/);
  await assert.rejects(submit('x', 'auto', 'loud'), /energy/);
  await assert.rejects(submit('كلمنا على 01234567890'), /phone number or ID/);
  await assert.rejects(submit('الرقم القومي ٢٩٨٠١٠١٢٣٤٥٦٧٨'), /phone number or ID/);
  await assert.rejects(submit('رقم 0123 456 789'), /phone number or ID/);
  await assert.rejects(submit('تمام', 'auto', 'calm', 'call 01111111111'), /phone number or ID/);
  const id = await submit('اتصل بينا على 01010686264 أو 0236230005. سُونُو معاك.', 'auto', 'energetic', 'هادي');
  assert.equal((await get(id)).status, 'queued');
  assert.equal((await get('00000000-0000-4000-8000-000000000009')).status, 'not_found');

  // lease -> sent -> done
  const leased = await api('lease', { worker: 'vps', limit: 3 });
  assert.equal(leased.jobs.length, 1); assert.equal(leased.jobs[0].id, id); assert.equal(leased.jobs[0].voice, 'auto');
  assert.equal(leased.jobs[0].energy, 'energetic');
  assert.equal((await api('lease', { worker: 'vps' })).jobs.length, 0, 'a leased job is not leased twice');
  assert.equal((await api('sent', { id, voice: 'robot' })).ok, false);
  assert.equal((await api('sent', { id, voice: 'female', message_id: '<a@swnw.voiceover>' })).ok, true);
  assert.equal((await get(id)).status, 'sent');
  assert.equal((await api('done', { id, audio_base64: Buffer.from('hello').toString('base64') })).reason, 'audio size');
  assert.equal((await api('done', { id, audio_base64: Buffer.alloc(2000, 7).toString('base64') })).reason, 'not mp3');
  const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(3000, 1)]);
  assert.equal((await api('done', { id, audio_base64: mp3.toString('base64') })).ok, true);
  const done = await get(id);
  assert.equal(done.status, 'done'); assert.equal(done.voice, 'female');
  assert.ok(Buffer.from(done.audio_base64, 'base64').equals(mp3));
  assert.equal((await api('fail', { id, error: 'x' })).ok, false, 'a done job cannot be failed');

  // 30-minute timeout; a late mp3 is refused
  const late = await submit('نص تاني قصير.');
  await api('lease', { worker: 'vps' }); await api('sent', { id: late, voice: 'male' });
  await db.query("update ops_private.vo_jobs set created_at = now() - interval '31 minutes' where id = $1", [late]);
  assert.equal((await get(late)).status, 'timeout');
  assert.equal((await api('done', { id: late, audio_base64: mp3.toString('base64') })).reason, 'not active');

  // stale lease goes back to the queue, 3 expiries -> failed
  const stale = await submit('نص تالت.');
  for (let i = 1; i <= 3; i++) {
    assert.equal((await api('lease', { worker: 'vps' })).jobs.length, 1, 'requeued after lease ' + i);
    await db.query("update ops_private.vo_jobs set leased_at = now() - interval '6 minutes' where id = $1", [stale]);
  }
  assert.equal((await get(stale)).status, 'failed');

  // worker fail with timeout reason
  const f = await submit('نص رابع.'); await api('lease', { worker: 'vps' });
  assert.equal((await api('fail', { id: f, reason: 'timeout', error: 'no reply' })).ok, true);
  assert.equal((await get(f)).status, 'timeout');
  assert.equal((await api('nope', { id: f })).reason, 'action');

  // rate limit: 20 per hour
  await db.query("update ops_private.vo_jobs set status = 'done' where status in ('queued','leased','sent')");
  for (let i = (await one('select count(*)::int n from ops_private.vo_jobs')).n; i < 20; i++) {
    await submit('نص ' + i + '.');
    await db.query("update ops_private.vo_jobs set status = 'done' where status = 'queued'");
  }
  await assert.rejects(submit('واحد زيادة.'), /rate limit/);

  // open-jobs cap
  await db.query("update ops_private.vo_jobs set created_at = now() - interval '2 hours', status = 'done'");
  for (let i = 0; i < 6; i++) await submit('مفتوح ' + i + '.');
  await assert.rejects(submit('سابع.'), /too many open jobs/);

  // permissions: only service_role may execute; nobody else sees the table
  const can = async (role, fn) => (await one("select has_function_privilege($1, $2, 'execute') ok", [role, fn])).ok;
  for (const fn of ['public.vo_job_submit(text,text,text,text)', 'public.vo_job_get(uuid)', 'public.vo_worker_api(text,jsonb)']) {
    assert.equal(await can('anon', fn), false, fn); assert.equal(await can('authenticated', fn), false, fn); assert.equal(await can('service_role', fn), true, fn);
  }
  assert.equal((await one("select has_table_privilege('authenticated','ops_private.vo_jobs','select') ok")).ok, false);
  assert.equal((await one("select has_schema_privilege('anon','ops_private','usage') ok")).ok, false);

  // old audio is dropped after 7 days
  await db.query("update ops_private.vo_jobs set created_at = now() - interval '8 days' where id = $1", [id]);
  await get(id);
  assert.equal((await one('select audio is null gone from ops_private.vo_jobs where id = $1', [id])).gone, true);

  console.log('PASS vo_jobs: guards, lease/sent/done/fail, timeout, requeue, rate limit, permissions, retention');
  await db.close();
})().catch((e) => { console.error(e); process.exit(1); });
