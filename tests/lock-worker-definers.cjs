// 20261125170000 SECURITY: anon-executable SECURITY DEFINER functions locked (scan 2026-11-25). PGlite with stub functions of
// the exact live signatures (tests/fixtures/lock-worker-definers-lists.json, from the read-only scan):
//   D server/worker/cron → anon ✗ authenticated ✗ service_role ✓;  A triggers + B guarded dashboard RPCs → anon ✗ authenticated ✓;
//   C public token pages → anon ✓;  HELD → unchanged (anon ✓ until their callers are confirmed);
//   a missing signature refuses the whole file;  rollback restores.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const L=JSON.parse(fs.readFileSync('tests/fixtures/lock-worker-definers-lists.json','utf8'));
const TRIG=new Set(['ai_clip_auto_enqueue','audit_nutrition_daily_completion','business_graph_from_decision','business_graph_from_knowledge','business_graph_from_measurement','business_graph_from_recommendation','business_queue_completed_task','capture_administrative_assistant_mention','log_patient_account_access_status_change','log_patient_identity_verification_status_change','log_patient_identity_verification_submitted','patient360_escalate_case','task_file_queue_from_comment','task_file_queue_from_result','task_updates_sia_claude_request']);
(async()=>{const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
  alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;`);   // live pg_default_acl
 const all=[...L.A,...L.B,...L.C,...L.D,...L.H];
 for(const s of all){const name=s.split('(')[0];
  await db.exec(TRIG.has(name)?`create function public.${s} returns trigger language plpgsql security definer as $$begin return null;end$$;`
                              :`create function public.${s} returns void language sql security definer as $$select$$;`);
  await db.exec(`grant execute on function public.${s} to anon,authenticated,service_role;`);}   // live state
 const can=async(role,s)=>(await db.query(`select has_function_privilege($1,'public.${s}','execute') x`,[role])).rows[0].x;
 const M=fs.readFileSync('supabase/migrations/20261125170000_lock_worker_definers.sql','utf8');
 // a missing signature refuses everything
 await db.exec(`alter function public.${L.D[0]} rename to tmp_missing`);
 await assert.rejects(()=>db.exec(M),/signature changed/);
 const n=L.D[0].split('(')[0];await db.exec(`alter function public.tmp_missing(${L.D[0].slice(L.D[0].indexOf('(')+1,-1)}) rename to ${n}`);
 assert.equal(await can('anon',L.D[1]),true,'nothing applied after the refusal');
 await db.exec(M);await db.exec(M);   // idempotent
 for(const s of L.D){assert.equal(await can('anon',s),false,'D anon '+s);assert.equal(await can('authenticated',s),false,'D auth '+s);assert.equal(await can('service_role',s),true,'D service '+s);}
 for(const s of [...L.A,...L.B]){assert.equal(await can('anon',s),false,'A/B anon '+s);assert.equal(await can('authenticated',s),true,'A/B auth '+s);}
 for(const s of L.C){assert.equal(await can('anon',s),true,'C public '+s);}
 for(const s of L.H){assert.equal(await can('anon',s),true,'held unchanged '+s);}
 await db.exec(fs.readFileSync('supabase/rollbacks/20261125170000_lock_worker_definers.rollback.sql','utf8'));
 for(const s of [...L.D,...L.A,...L.B])assert.equal(await can('anon',s),true,'rollback '+s);
 console.log(`PASS lock worker definers: D (${L.D.length}) service_role only; A (${L.A.length}) + B (${L.B.length}) no anon, authenticated kept; C (${L.C.length}) public pages keep anon; held (${L.H.length}) unchanged; missing signature refuses the file; idempotent; rollback restores.`);
})().catch(e=>{console.error(e);process.exit(1);});
