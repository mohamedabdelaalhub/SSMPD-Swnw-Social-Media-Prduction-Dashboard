// Static guard for 20261126150000: every reader patch in the migration is reversed fragment-for-fragment by the rollback.
const fs=require('fs'),assert=require('assert');
const mig=fs.readFileSync('supabase/migrations/20261126150000_hr_external_mission.sql','utf8');
const rb=fs.readFileSync('supabase/rollbacks/20261126150000_hr_external_mission.rollback.sql','utf8');
const pairs=(src,fn,tag)=>{const i=src.indexOf(tag+"('public."+fn);assert(i>=0,fn+' patch missing');const b=src.slice(i,src.indexOf(']);',i));return [...b.matchAll(/\$a\$([\s\S]*?)\$a\$/g)].map(m=>m[1]);};
for(const fn of ['hr_attendance_from_punches(date)','hr_attendance_today(date)','hr_attendance_range(date,date)']){
  const a=pairs(mig,fn,'pg_temp.mission_patch'),b=pairs(rb,fn,'pg_temp.mission_unpatch');
  assert(a.length&&a.length%2===0&&a.length===b.length,fn+' pair count');
  for(let i=0;i<a.length;i+=2){assert.strictEqual(b[i],a[i+1],fn+' rollback old #'+i);assert.strictEqual(b[i+1],a[i],fn+' rollback new #'+i);}
}
assert(/kind in \('leave','permission','training','advance','overtime','leave_credit','holiday_comp','mission'\)/.test(mig),'kind check adds mission');
assert(/kind in \('leave','permission','training','advance','overtime','leave_credit','holiday_comp'\)\);/.test(rb),'rollback restores kind check');
assert(/grant execute on function public\.hr_mission\(text, jsonb\) to authenticated/.test(mig)&&/revoke all on function public\.hr_mission\(text, jsonb\) from public, anon/.test(mig),'grants');
console.log('PASS hr external mission: 3 reader patches mirrored by the rollback, kind check and grants');
