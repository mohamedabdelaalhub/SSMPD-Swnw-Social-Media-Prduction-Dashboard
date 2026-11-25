// 20261125180000 SECURITY (2nd batch): read-only SECURITY DEFINER functions anon could execute (scan 2026-11-25). PGlite with
// stubs of the exact live signatures (tests/fixtures/lock-readonly-definers-lists.json):
//   R → anon ✗, authenticated ✓ (dashboard after login);  K public pages → anon ✓;  HELD → unchanged;
//   a missing signature refuses the file;  idempotent;  rollback restores.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const L=JSON.parse(fs.readFileSync('tests/fixtures/lock-readonly-definers-lists.json','utf8'));
(async()=>{const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;create table public.media_buyer_plans(id uuid);
  alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;`);
 for(const s of [...L.R,...L.K,...L.H])await db.exec(`create function public.${s} returns void language sql security definer as $$select$$;`);
 const can=async(role,s)=>(await db.query(`select has_function_privilege($1,'public.${s}','execute') x`,[role])).rows[0].x;
 const M=fs.readFileSync('supabase/migrations/20261125180000_lock_readonly_definers.sql','utf8');
 const first=L.R[0],nm=first.split('(')[0],args=first.slice(first.indexOf('(')+1,-1);
 await db.exec(`alter function public.${first} rename to tmp_missing`);await assert.rejects(()=>db.exec(M),/signature changed/);
 await db.exec(`alter function public.tmp_missing(${args}) rename to ${nm}`);assert.equal(await can('anon',L.R[1]),true,'nothing applied after the refusal');
 await db.exec(M);await db.exec(M);
 for(const s of L.R){assert.equal(await can('anon',s),false,'R anon '+s);assert.equal(await can('authenticated',s),true,'R auth '+s);assert.equal(await can('service_role',s),true);}
 for(const s of L.K)assert.equal(await can('anon',s),true,'K public '+s);
 for(const s of L.H)assert.equal(await can('anon',s),true,'held '+s);
 await db.exec(fs.readFileSync('supabase/rollbacks/20261125180000_lock_readonly_definers.rollback.sql','utf8'));
 for(const s of L.R)assert.equal(await can('anon',s),true,'rollback '+s);
 console.log(`PASS lock read-only definers: R (${L.R.length}) no anon, authenticated kept; K (${L.K.length}) public pages keep anon; held (${L.H.length}) unchanged; missing signature refuses; idempotent; rollback restores.`);
})().catch(e=>{console.error(e);process.exit(1);});
