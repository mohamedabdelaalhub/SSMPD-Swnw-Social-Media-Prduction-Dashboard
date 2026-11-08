// Migration 20261108210000: phone digit stripping in check-in/PBX + server-only grants for 2 definer functions.
const {PGlite}=require('@electric-sql/pglite'),fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const mig=fs.readFileSync('supabase/migrations/20261108210000_item3_phone_digits_and_definer_grants.sql','utf8');
 const code=mig.split('\n').filter(l=>!l.trim().startsWith('--')).join('\n');
 assert(!code.includes("'\\\\D'"),'no literal \\\\D regex left in code');
 assert.equal((code.match(/'\\D'/g)||[]).length,9,'9 fixed regex uses');
 for(const f of ['clinic_reception_checkin_static','clinic_reception_checkin_candidates','clinic_reception_pbx_event'])assert(code.includes('FUNCTION public.'+f+'('),f);
 for(const f of ['staff_kpis_admin','claude_autoschedule_approved']){assert.match(code,new RegExp('revoke execute on function public\\.'+f+'\\([^)]*\\) from public, anon, authenticated'));assert.match(code,new RegExp('grant execute on function public\\.'+f+'\\([^)]*\\) to service_role'));}
 const rb=fs.readFileSync('supabase/rollbacks/20261108210000_item3_phone_digits_and_definer_grants.rollback.sql','utf8');assert((rb.match(/'\\\\D'/g)||[]).length===9,'rollback restores old text');
 const db=new PGlite();const q=async s=>(await db.query(s)).rows[0].v;
 assert.equal(await q("select regexp_replace('+20 100-123 4567','\\D','','g') v"),'201001234567');
 assert.equal(await q("select regexp_replace('+20 100-123 4567','\\\\D','','g') v"),'+20 100-123 4567','old pattern did nothing');
 assert.equal(await q("select right(regexp_replace('+20 100 123 4567','\\D','','g'),10)=right(regexp_replace('01001234567','\\D','','g'),10) v"),true,'PBX match +20 vs local');
 await db.close();console.log('PASS item3: 9 phone regex fixed (old pattern proven no-op), +20 vs local PBX match, definer functions server-only, rollback restores.');
})().catch(e=>{console.error(e);process.exit(1);});
