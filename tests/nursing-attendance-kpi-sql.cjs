// Owner 2026-11-23 «تفضل»: nursing attendance KPI penalty (phase 2). Boots exactly like tests/nursing-attendance-routing-sql.cjs
// (stub HR attendance + 20261122310000), adds «أداء الفريق» tables + the real public.staff_kpis body, then applies the phase-2 migration.
const fs=require('fs'),path=require('path'),os=require('os'),assert=require('node:assert/strict');
const p1=fs.readFileSync(path.join(__dirname,'nursing-attendance-routing-sql.cjs'),'utf8');
const pre=p1.slice(0,p1.indexOf('\nconst body=`'));
const {setup,da}=(new Function('require','__dirname',pre+';return {setup,da};'))(require,__dirname);
const tk=fs.readFileSync('supabase/migrations/20261112150000_task_cancelled_status.sql','utf8');
const fnStart=tk.indexOf('CREATE OR REPLACE FUNCTION public.staff_kpis(');
const staffKpis=tk.slice(fnStart,tk.indexOf('end $function$;',fnStart)+'end $function$;'.length);
assert(fnStart>0&&staffKpis.includes("and assignee_id is not null group by assignee_id\n  )"),'staff_kpis source moved; update this test');
const live=fs.readFileSync('supabase/live-capture/20261107_tables_public.sql','utf8');
const tbl=n=>{const i=live.indexOf('CREATE TABLE public.'+n+' (');return live.slice(i,live.indexOf(');',i)+2);};
const kpiSql=path.join(os.tmpdir(),'nursing-kpi-stub-'+process.pid+'.sql');
fs.writeFileSync(kpiSql,tbl('kpi_defs')+'\n'+tbl('kpi_targets')+'\n'+staffKpis+'\n');
const LAST="${mig('nursing_attendance_routing')}]";assert(setup.includes(LAST));
const setup2=setup.replace(LAST,"${mig('nursing_attendance_routing')},"+JSON.stringify(kpiSql)+",${mig('nursing_attendance_kpi')}]");
const body=`
{const q=async(sql,a)=>{const r=await owner(sql,a);await as(1);return r;};await as(1);
await q('update clinic_reception.settings set live_enabled=true,cutover_at=coalesce(cutover_at,now())');
const N=async(n,a,p)=>{await as(n);try{return await call('clinic_reception_nursing',[live,a,p||{}]);}finally{await as(1);}};
const svc=(await snap(live)).services.find(x=>x.code==='DERM').id;
const physio=(await cmd(live,'provider',{name:'د. علاج طبيعي',department:'العلاج الطبيعي',branch:'حدائق الأهرام'})).id;
const dental=(await cmd(live,'provider',{name:'د. أسنان',department:'الاسنان',branch:'حدائق الأهرام'})).id;
for(const [k,nn] of [[41,'ممرضة علاج طبيعي'],[42,'ممرضة أسنان'],[43,'ممرضة عام']])await q("insert into public.admins(id,email,name,role,active) values($1,$2,$3,'nursing',true) on conflict (id) do update set role='nursing',active=true,name=$3",[id(k),'n'+k+'@test',nn]);
for(const k of [41,42,43])await q("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,array['view','execute']) on conflict do nothing",[live,id(k)]).catch(()=>{});
const P=(await q("insert into clinic_people.people(admin_id,department,job_title) values($1,'العلاج الطبيعي','تمريض علاج طبيعي') returning id",[id(41)]))[0].id;
const D=(await q("insert into clinic_people.people(admin_id,department,job_title) values($1,'التمريض','ممرضة أسنان') returning id",[id(42)]))[0].id;
const G=(await q("insert into clinic_people.people(admin_id,department,job_title) values($1,'التمريض','تمريض') returning id",[id(43)]))[0].id;
const ev=async(pid,status,firstIn,late,excused)=>{await q("delete from clinic_people.t_eval where person_id=$1",[pid]);if(status)await q("insert into clinic_people.t_eval(person_id,status,exp_start,exp_end,first_in,late_min,excused) values($1,$2,now()-interval '50 minutes',now()+interval '7 hours',"+(firstIn||'null')+",$3,$4)",[pid,status,late||0,!!excused]);};
await ev(P,'absent');await ev(D,'on_time',"now()-interval '50 minutes'");await ev(G,'on_time',"now()-interval '50 minutes'");
const mk=async(prov,ago)=>(await q("insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at,status,created_by) values($1,$2,$3,$4,now()-($5||' minutes')::interval,now()-($5||' minutes')::interval+interval '20 minutes','booked',$6) returning id",[live,pat,prov,svc,String(ago),id(1)]))[0].id;
const ap1=await mk(physio,40),ap2=await mk(physio,30),early=await mk(physio,120),dn=await mk(dental,10);
const cx=await mk(physio,35);await q("update clinic_reception.appointments set status='cancelled' where id=$1",[cx]);
// general nursing starts ap1 (opens the file) while the physio nurse is absent
const archive=(await q('select patient_id from clinic_reception.patients where id=$1',[pat]))[0].patient_id;
await N(43,'open_file',{patient_id:archive,appointment_id:ap1});
const run=async()=>{await owner('select clinic_reception.nursing_kpi_compute(clinic_reception.today())');await as(1);};
const row=async k=>(await q('select * from clinic_reception.nursing_day_kpi where admin_id=$1 and day=clinic_reception.today()',[id(k)]))[0];
await run();
let r=await row(41);assert.equal(r.state,'absent');assert(r.late_min>=50&&r.late_min<=52,'absent: shift start → now');
assert.equal(r.cases_rerouted,2,'only non-cancelled cases after shift start');assert.equal(r.cases_kept,1);assert.equal(r.cases_returned,1);
assert.deepEqual(r.absorbed_by.map(x=>[x.name,x.cases]),[['ممرضة عام',1]]);
assert.equal(+r.points,Math.ceil(r.late_min/15)+6,'1 point per started 15 minutes + 3 per re-routed case');
assert.equal(+(await row(42)).points,0,'on-time dental nurse: a row with 0 points');assert.equal(await row(43),undefined,'general nursing has no row');
// he clocks in 20 minutes ago, 30 minutes late: only cases before his check-in count
await ev(P,'late',"now()-interval '20 minutes'",30);await run();r=await row(41);
assert.equal(r.state,'present');assert.equal(r.late_min,30);assert.equal(r.cases_rerouted,2);assert.equal(+r.points,2+6);
// late but nobody waiting: light penalty only
await ev(D,'late',"now()-interval '35 minutes'",15);await run();assert.equal(+(await row(42)).points,1);
// approved permission (excused) → recorded, 0 points; approved leave → no row
await ev(P,'late',"now()-interval '20 minutes'",30,true);await run();r=await row(41);assert.equal(r.excused,true);assert.equal(+r.points,0);assert.equal(r.cases_rerouted,2);
await ev(P,'leave');await run();assert.equal(await row(41),undefined);
// weights are data, not code
await ev(P,'absent');await q('update clinic_reception.nursing_kpi_weights set per_case=5');await run();r=await row(41);assert.equal(+r.points,Math.ceil(r.late_min/15)+10);
await q('update clinic_reception.nursing_kpi_weights set per_case=3');
assert.equal(+(await owner('select clinic_reception.nursing_kpi_run() n'))[0].n,4,'run = yesterday (none) + today');await as(1);
// «أداء الفريق»: KPI defined, nursing target, staff_kpis sums the day points
const def=(await q("select * from public.kpi_defs where kpi='nursing_attendance_penalty'"))[0];assert.equal(def.direction,'lower');assert.equal(def.scales,true);
assert.equal(+(await q("select target from public.kpi_targets where role='nursing' and kpi='nursing_attendance_penalty'"))[0].target,4);
const fd=(await q("select pg_get_functiondef('public.staff_kpis(timestamptz,timestamptz)'::regprocedure) d"))[0].d;
assert.equal(fd.split("'nursing_attendance_penalty'").length,2);assert(fd.includes('clinic_reception.nursing_day_kpi'));
// clients cannot read the table or run the computation
await as(41);await assert.rejects(()=>db.query('select * from clinic_reception.nursing_day_kpi'),/permission|denied/i);
await assert.rejects(()=>db.query('select clinic_reception.nursing_kpi_run()'),/permission|denied/i);await as(1);
// rollback
await db.exec('reset role;'+require('fs').readFileSync('supabase/rollbacks/'+require('fs').readdirSync('supabase/rollbacks').find(f=>f.endsWith('_nursing_attendance_kpi.rollback.sql')),'utf8'));await as(1);
assert.equal((await q("select count(*) n from public.kpi_defs where kpi='nursing_attendance_penalty'"))[0].n,0);
assert(!(await q("select pg_get_functiondef('public.staff_kpis(timestamptz,timestamptz)'::regprocedure) d"))[0].d.includes('nursing_day_kpi'));
assert.equal((await q("select to_regclass('clinic_reception.nursing_day_kpi') r"))[0].r,null);
await db.close();console.log('PASS nursing attendance KPI: absent/late windows, re-routed/returned/kept + who absorbed, 1 per 15 min + 3 per case, excused = 0, leave = no row, weights as data, KPI def/target, staff_kpis line, gates, rollback.');}})().catch(e=>{console.error(e);process.exit(1);});`;
const runner=da.slice(da.indexOf('const file=path.join')).replace(/doctor-assistant-run-/g,'nursing-kpi-run-');
const file=path.join(os.tmpdir(),'nursing-kpi-outer-'+process.pid+'.cjs');
fs.writeFileSync(file,setup2.replace(/__dirname/g,JSON.stringify(__dirname))+'const body='+JSON.stringify(body)+';\n'+runner);
process.on('exit',()=>{for(const f of [file,kpiSql]){try{fs.unlinkSync(f);}catch(_){}}});
require(file);
