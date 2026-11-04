/* Offline tests (PGlite, scratch DB, dummy rows) for video job claiming.
   Part C exercises the REAL claim_next_video_job(text,integer) SQL text extracted from supabase/migrations/20261006_video_studio.sql.
   Part F exercises the DRAFT fencing functions in supabase/drafts/20261104_video_job_fencing.sql (NOT applied anywhere).
   PGlite is a single connection, so true parallel claims cannot be simulated here; SKIP LOCKED behaviour is covered by the SQL text check below. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.join(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8');
const mig=read('supabase/migrations/20261006_video_studio.sql');
const a=mig.indexOf('create or replace function public.claim_next_video_job(p_worker_id text, p_max_input_schema_version integer)');
const endMarker='grant execute on function public.claim_next_video_job(text,integer) to service_role;';
const b=mig.indexOf(endMarker,a)+endMarker.length;
assert.ok(a>0&&b>a,'claim function text found');
const claimSql=mig.slice(a,b);
const draft=read('supabase/drafts/20261104_video_job_fencing.sql');
const J=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
(async()=>{
 const db=new PGlite();
 await db.exec(`create role service_role; create role anon; create role authenticated;
  create schema auth; create function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.role',true),'') $$;
  create table public.video_jobs(id uuid primary key, status text not null default 'pending', worker_id text, attempt_count int not null default 0, error_message text,
    render_started_at timestamptz, render_finished_at timestamptz, progress_percent int not null default 0, progress_stage text not null default 'wait',
    input_schema_version int not null default 1, output_video_url text, cover_url text, voiceover_url text, subtitles_url text,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now());
  create table public.video_worker_heartbeats(worker_id text primary key, status text not null default 'idle', current_job_id uuid, last_seen_at timestamptz not null default now(), updated_at timestamptz not null default now());
  create function public.touch() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$; create trigger video_jobs_touch before update on public.video_jobs for each row execute function public.touch();
  grant all on all tables in schema public to service_role; grant usage on schema auth to service_role, anon, authenticated; grant usage on schema public to service_role, anon, authenticated;`);
 await db.exec(claimSql);
 const as=async role=>{await db.exec('reset role;');await db.query("select set_config('test.role',$1,false)",[role]);await db.exec('set role '+role+';');};
 const reset=async()=>{await db.exec('reset role; truncate public.video_jobs, public.video_worker_heartbeats;');};
 const add=async(n,o={})=>db.query(`insert into public.video_jobs(id,status,attempt_count,input_schema_version,created_at,updated_at,worker_id) values($1,$2,$3,$4,now()+($5||' seconds')::interval,now()-($6||' minutes')::interval,$7)`,[J(n),o.status||'pending',o.attempts||0,o.ver||1,String(o.order||n),String(o.age||0),o.worker||null]);
 const row=async n=>(await db.query('select * from public.video_jobs where id=$1',[J(n)])).rows[0];
 const claim=async(w='w1',v=4)=>(await db.query('select public.claim_next_video_job($1,$2) as j',[w,v])).rows[0].j;
 // C0 the production SQL keeps the atomic-claim primitive
 assert.match(claimSql,/for update skip locked/i,'C0 SKIP LOCKED present');
 // C1 oldest pending first, status/worker/attempt set
 await reset();await add(1,{order:2});await add(2,{order:1});await as('service_role');
 let j=await claim('w1');assert.equal(j.id,J(2));assert.equal(j.status,'preparing');assert.equal(j.worker_id,'w1');assert.equal(j.attempt_count,1);
 // C2 the same job is not claimed twice; the next call takes the other job; then the queue is empty
 j=await claim('w2');assert.equal(j.id,J(1));assert.equal(await claim('w3'),null);
 // C3 schema-version filter
 await reset();await add(1,{ver:4});await add(2,{ver:5});await as('service_role');assert.equal(await claim('w1',3),null);assert.equal((await claim('w1',4)).id,J(1));assert.equal(await claim('w1',99),null,'C3 version above 4 is never claimable (least(p,4))');
 // C4 stale job (31 min, no heartbeat) goes back to pending and is claimed again with attempt+1
 await reset();await add(1,{status:'rendering',attempts:1,age:31,worker:'dead'});await as('service_role');
 j=await claim('w2');assert.equal(j.id,J(1));assert.equal(j.attempt_count,2);assert.equal(j.worker_id,'w2');
 // C5 a fresh job (5 min) is NOT recovered
 await reset();await add(1,{status:'rendering',attempts:1,age:5,worker:'alive'});await as('service_role');assert.equal(await claim('w2'),null);assert.equal((await row(1)).status,'rendering');
 // C6 stale but its worker still sends a heartbeat (< 2 min): NOT recovered
 await reset();await add(1,{status:'uploading',attempts:1,age:40,worker:'busy'});await db.query("insert into public.video_worker_heartbeats(worker_id,status,current_job_id,last_seen_at) values('busy','working',$1,now()-interval '1 minute')",[J(1)]);
 await as('service_role');assert.equal(await claim('w2'),null);assert.equal((await row(1)).status,'uploading');
 // C7 stale with an OLD heartbeat (5 min) is recovered
 await reset();await add(1,{status:'preparing',attempts:2,age:40,worker:'gone'});await db.query("insert into public.video_worker_heartbeats(worker_id,status,current_job_id,last_seen_at) values('gone','working',$1,now()-interval '5 minutes')",[J(1)]);
 await as('service_role');j=await claim('w2');assert.equal(j.id,J(1));assert.equal(j.attempt_count,3);
 // C8 retry cap: stale job with 3 attempts becomes failed, never reclaimed
 await reset();await add(1,{status:'rendering',attempts:3,age:45,worker:'dead'});await as('service_role');assert.equal(await claim('w2'),null);
 let r=await row(1);assert.equal(r.status,'failed');assert.equal(r.worker_id,null);assert.ok(r.render_finished_at);
 // C9 only service_role may claim
 await reset();await add(1);for(const role of ['anon','authenticated']){await as(role);await assert.rejects(db.query('select public.claim_next_video_job($1,$2)',['w',4]),e=>/permission denied|service_role required/i.test(String(e.message)),'C9 '+role);}
 // C10 KNOWN GAP (documents today's behaviour): a zombie can still write to a reclaimed job through a plain update (no fencing)
 await reset();await add(1,{status:'rendering',attempts:1,age:31,worker:'zombie'});await as('service_role');j=await claim('w2');assert.equal(j.worker_id,'w2');
 await db.query("update public.video_jobs set status='ready',worker_id='zombie' where id=$1",[J(1)]);assert.equal((await row(1)).status,'ready','C10 zombie overwrite is possible today (gap fixed only by the draft)');
 // ---- Part F: DRAFT fencing (applied only to this scratch database)
 await db.exec('reset role;');await db.exec('alter table public.video_jobs add column claim_token uuid;');await db.exec(draft.replace(/alter table public.video_jobs add column if not exists claim_token uuid;/,''));
 const fclaim=async(w='w1')=>(await db.query('select public.claim_next_video_job_fenced($1,$2) as j',[w,4])).rows[0].j;
 const fup=async(id,tok,patch)=>db.query('select public.video_job_update_fenced($1,$2,$3::jsonb) as j',[id,tok,JSON.stringify(patch)]);
 // F1 claim returns a token and stores it
 await reset();await add(1);await as('service_role');j=await fclaim('w1');assert.ok(j.claim_token);assert.equal((await row(1)).claim_token,j.claim_token);
 // F2 the token holder can update whitelisted columns
 let u=(await fup(J(1),j.claim_token,{status:'rendering',progress_percent:50})).rows[0].j;assert.equal(u.status,'rendering');assert.equal(u.progress_percent,50);
 // F3 non-whitelisted column rejected (cannot touch attempt_count / worker_id / claim_token)
 for(const bad of ['attempt_count','worker_id','claim_token','id']) await assert.rejects(fup(J(1),j.claim_token,{[bad]:'x'}),e=>/column not allowed/.test(String(e.message)),'F3 '+bad);
 // F4 ZOMBIE: after a stale reclaim the old token is rejected, the new holder succeeds
 const old=j.claim_token;await db.exec("reset role; alter table public.video_jobs disable trigger video_jobs_touch; update public.video_jobs set updated_at=now()-interval '31 minutes' where id='"+J(1)+"'; alter table public.video_jobs enable trigger video_jobs_touch;");await as('service_role');
 const j2=await fclaim('w2');assert.equal(j2.id,J(1));assert.notEqual(j2.claim_token,old);
 await assert.rejects(fup(J(1),old,{status:'ready'}),e=>/stale claim/.test(String(e.message)),'F4 old token');
 assert.equal((await fup(J(1),j2.claim_token,{status:'uploading'})).rows[0].j.status,'uploading');
 // F5 finished job: even the current token can no longer change it; wrong token / null token rejected
 await fup(J(1),j2.claim_token,{status:'ready'});await assert.rejects(fup(J(1),j2.claim_token,{status:'failed'}),e=>/stale claim/.test(String(e.message)),'F5 finished');
 await assert.rejects(fup(J(1),null,{status:'ready'}),e=>/claim token required/.test(String(e.message)),'F5 null token');
 // F6 empty queue returns null; only service_role can call the fenced functions
 assert.equal(await fclaim('w3'),null);
 for(const role of ['anon','authenticated']){await as(role);await assert.rejects(db.query('select public.claim_next_video_job_fenced($1,$2)',['w',4]),e=>/permission denied|service_role required/i.test(String(e.message)),'F6a '+role);await assert.rejects(fup(J(1),j2.claim_token,{status:'ready'}),e=>/permission denied|service_role required/i.test(String(e.message)),'F6b '+role);}
 await db.close();
 console.log('PASS video job lease/claim: 10 current-behaviour checks (C0-C10, C10 documents the zombie gap) and 6 draft fencing checks (F1-F6) on a scratch DB');
})().catch(e=>{console.error(e);process.exit(1);});
