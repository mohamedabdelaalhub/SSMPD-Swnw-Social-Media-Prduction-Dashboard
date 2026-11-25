// 20261125190000 SECURITY (3rd batch): held functions whose callers are now confirmed (service role / postgres) → service_role only.
// PGlite stubs with the exact live signatures (tests/fixtures/lock-held-definers-list.json); a definer wrapper filtered to the
// caller (like my_staff_kpis) keeps working for authenticated; missing signature refuses; idempotent; rollback restores.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const S=JSON.parse(fs.readFileSync('tests/fixtures/lock-held-definers-list.json','utf8'));
(async()=>{const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role;
  alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;`);
 for(const s of S)await db.exec(`create function public.${s} returns void language sql security definer as $$select$$;`);
 await db.exec(`create function public.my_staff_kpis_stub() returns void language plpgsql security definer as $$begin perform public.staff_kpis_admin(now(), now());end$$;`);
 const can=async(r,s)=>(await db.query(`select has_function_privilege($1,'public.${s}','execute') x`,[r])).rows[0].x;
 const M=fs.readFileSync('supabase/migrations/20261125190000_lock_held_definers.sql','utf8');
 const first=S[0],nm=first.split('(')[0],args=first.slice(first.indexOf('(')+1,-1);
 await db.exec(`alter function public.${first} rename to tmp_missing`);await assert.rejects(()=>db.exec(M),/signature changed/);
 await db.exec(`alter function public.tmp_missing(${args}) rename to ${nm}`);assert.equal(await can('anon',S[1]),true,'nothing applied after the refusal');
 await db.exec(M);await db.exec(M);
 for(const s of S){assert.equal(await can('anon',s),false,'anon '+s);assert.equal(await can('authenticated',s),false,'auth '+s);assert.equal(await can('service_role',s),true,'service '+s);}
 await db.exec('set role authenticated');await db.query('select public.my_staff_kpis_stub()');await db.exec('reset role');   // the definer wrapper still works
 await db.exec('set role authenticated');await assert.rejects(()=>db.query("select public.staff_kpis_admin(now(), now())"),/permission denied/);await db.exec('reset role');
 await db.exec(fs.readFileSync('supabase/rollbacks/20261125190000_lock_held_definers.rollback.sql','utf8'));
 for(const s of S)assert.equal(await can('anon',s),true,'rollback '+s);
 console.log(`PASS lock held definers: ${S.length} functions service_role only (anon ✗, authenticated ✗); a definer wrapper (my_staff_kpis) still works for staff; staff_kpis_admin refused to staff; missing signature refuses; idempotent; rollback restores.`);
})().catch(e=>{console.error(e);process.exit(1);});
