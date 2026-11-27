// 20261127130000 «ورديات مرنة» + «وردية اليوم السريعة» (PGlite, real HR chain: schedules → swaps → closures → leave rules →
// double shift → exit auto-close → overtime control → external missions, then this file).
//  A) quick shift: HR / direct manager only (unrelated nurse, the employee himself refused), only on an empty day, rest day asks
//     «إضافي ولا عادي», leave / closure / duplicate refused, past days HR only (≤ 3 days), lateness from the quick start, cancel rules.
//  B) doctor shift: HR links a nurse to doctors; periods follow live availability (trigger), walk-in ignored, two sittings far apart
//     → two periods with lateness back from the break, no doctor → no row (never absent, weekly pattern ignored), doctor cancels →
//     shift removed, frozen shift kept once she clocked in, quick wins on a doctor-free day, flex_stop brings the weekly pattern back.
//  C) readers: hr_attendance_today.unscheduled, hr_shifts_workspace.flex, nurse_presence «off» with the punch + can_quick, staff_today keys.
//  D) payroll: a worked extra quick day adds one absence_day to the allowance. E) second run refused; rollback restores everything.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception-bridge.cjs');
const M=f=>fs.readFileSync('supabase/migrations/'+f+'.sql','utf8');
(async()=>{const {db,as,call,owner,id,fin,key}=await boot(['reception_canonical_catalog','reception_catalog_readiness','reception_catalog_lock_order']);try{
await db.exec("alter table admins add column if not exists email text;alter table contracting_entities add column category text default 'cash';alter table pricing_services add column created_by uuid;create or replace function public.is_super() returns boolean language sql stable as $$select has_role('super_admin')$$;");
for(const suffix of ['human_resources_workspace','price_lists_workspace','price_lists_booking_integration'])await db.exec(M(fs.readdirSync('supabase/migrations').find(n=>n.endsWith('_'+suffix+'.sql')).slice(0,-4)));
await db.exec(M('20261024183344_contract_price_imports_and_service_identity'));await db.exec(M('20261024183400_hr_attendance_import_and_calculated_payroll'));
for(const f of ['20261115100000_hr_pay_guaranteed_minimum','20261112100000_live_presence','20261113100000_shift_schedules','20261113110000_attendance_reports','20261115130000_hr_attendance_from_punches',
  '20261115200000_hr_shift_swaps','20261115210000_hr_shift_swap_rules_credit','20261115230000_center_closures','20261116100000_hr_leave_rules','20261116110000_hr_holiday_comp_day',
  '20261116120000_hr_double_shift_payroll','20261116160000_hr_exit_autoclose','20261118010000_hr_overtime_control','20261126150000_hr_external_mission'])await db.exec(M(f));
// nursing layer: the real nurse_presence + a stand-in of the layer that holds staff_today (same anchor as the live body)
const rt=M('20261122310000_nursing_attendance_routing');const np=rt.slice(rt.indexOf('create function clinic_reception.nurse_presence'),rt.indexOf('$$;',rt.indexOf('create function clinic_reception.nurse_presence'))+3);
await db.exec(`alter table clinic_reception.availability add column if not exists source text not null default 'manual';
create or replace function clinic_reception.is_nurse(p uuid) returns boolean language sql stable as $$select exists(select 1 from admins where id=p and role='nursing')$$;
${np}
create function clinic_reception.nursing_before_vitals(p_workspace uuid, p_action text, p_payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $f$
declare me uuid := public.my_admin_id(); mgr boolean := public.has_role('super_admin'); day date := (now() at time zone 'Africa/Cairo')::date;
begin
  if p_action = 'staff_today' then
    return (with ns as (select a5.id, a5.name nm, clinic_reception.nurse_presence(a5.id, day) as pr from public.admins a5 where clinic_reception.is_nurse(a5.id))
      select jsonb_build_object('nurses', coalesce((select jsonb_agg(jsonb_build_object('admin_id', ns.id, 'state', ns.pr->>'state',
            'late_min', case when mgr or public.has_role('head_nursing') or ns.id = me then (ns.pr->>'late_min')::int end,
            'first_in', ns.pr->'first_in')) from ns), '[]'::jsonb)));
  end if;
  raise exception 'unknown';
end $f$;
create function public.clinic_reception_nursing(p_workspace uuid, p_action text, p_payload jsonb default '{}') returns jsonb language sql security definer as $f$select clinic_reception.nursing_before_vitals(p_workspace,p_action,p_payload)$f$;
grant execute on function public.clinic_reception_nursing(uuid,text,jsonb) to authenticated;
create table if not exists public.personal_notice_reads(admin_id uuid not null,notice_key text not null,read_at timestamptz not null default now(),primary key(admin_id,notice_key));
create function clinic_finance.home_inbox_before_unread_daily() returns jsonb language sql stable security definer as $f$select jsonb_build_object('notices',jsonb_build_array(jsonb_build_object('key','task:x','type','task','id','x','at',now()-interval '1 hour','message','مهمة قديمة','read',false)),'unread',1,'limited',false)$f$;
create function public.personal_home_inbox() returns jsonb language plpgsql stable security definer as $f$begin return clinic_finance.home_inbox_before_unread_daily(); end$f$;
grant execute on function public.personal_home_inbox() to authenticated;`);
const snap=async()=>owner(`select string_agg(p.oid::regprocedure::text||':'||md5(pg_get_functiondef(p.oid)),',' order by p.oid::regprocedure::text) s from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where p.prokind='f' and (p.proname in ('hr_attendance_today','hr_attendance_range','hr_shifts_workspace','nurse_presence','nursing_before_vitals','hr_payroll_calculate','personal_home_inbox','home_inbox_before_unread_daily') or p.proname like 'attendance_eval%' or p.proname like 'payroll_before%')`);
const before=(await snap())[0].s;
await db.exec(M('20261127130000_hr_flex_shifts'));

const T=(await owner("select ((now() at time zone 'Africa/Cairo')::date)::text d, extract(hour from now() at time zone 'Africa/Cairo')::int h"))[0];const today=T.d;
const add=n=>{const d=new Date(today+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const dow=s=>new Date(s+'T12:00:00Z').getUTCDay();
const at=(d,hm)=>d+'T'+hm+':00+02:00';
const refused=async(p,re,msg)=>{await assert.rejects(p,re,msg);};
for(const n of [5,6,7])await owner("insert into admins(id,name,role) values($1,$2,'nursing')",[id(n),'ممرضة '+n]);
await as(1);
const tpl=(await owner("insert into clinic_people.shift_templates(name,start_time,end_time,grace_minutes,created_by) values('صباحي','09:00','17:00',10,$1) returning id",[id(1)]))[0].id;
const person=async(name,admin,mgr)=>{const p=await call('hr_command',['person',{full_name:name}]);await owner('update clinic_people.people set admin_id=$2, manager_id=$3 where id=$1',[p,admin,mgr]);return p;};
const pM=await person('مديرة تمريض',id(5),null), pE=await person('ممرضة أسنان',id(6),pM), pH=await person('ممرضة بدون جدول',null,pM), pN=await person('ممرضة علاج طبيعي',id(7),pM);
for(const p of [pE,pN])for(let k=0;k<7;k++)await owner('insert into clinic_people.person_shifts(person_id,dow,template_id,valid_from,created_by) values($1,$2,$3,$4,$5)',[p,k,k===5?null:tpl,add(-30),id(1)]);
for(const [p,u] of [[pE,31],[pN,32],[pH,33]])await owner("insert into clinic_people.device_user_map(device_id,device_user_id,person_id) values('DEV1',$1,$2)",[u,p]);
const punch=(u,ts,k=0)=>owner("insert into clinic_people.device_punches(device_id,device_user_id,ts,punch) values('DEV1',$1,$2::timestamptz,$3)",[u,ts,k]);
const ev=async(p,d,now)=>(await owner('select * from clinic_people.attendance_eval($1::date,$2::timestamptz) where person_id=$3',[d,now,p]))[0];
const q=(a,p)=>call('hr_day_shift',[a,p]);

// A) quick shift
let fri=null,wk=null;for(let k=1;k<=7;k++){if(dow(add(k))===5&&!fri)fri=add(k);if(dow(add(k))!==5&&!wk)wk=add(k);}
await as(5);
await refused(q('quick_save',{person_id:pE,day:wk,start:'10:00',end:'14:00'}),/وردية أسبوعية/,'a weekly shift day is not empty');
await refused(q('quick_save',{person_id:pE,day:fri,start:'10:00',end:'14:00'}),/إضافي ولا يوم عادي/,'rest day asks extra or normal');
const qs=await q('quick_save',{person_id:pE,day:fri,start:'10:00',end:'14:00',extra:true,note:'تغطية'});
assert.equal(qs.extra,true);assert.equal(qs.start,'10:00');assert.equal(qs.end,'14:00');
await refused(q('quick_save',{person_id:pE,day:fri,start:'15:00',end:'18:00',extra:false}),/فيه وردية بالفعل/,'one quick shift per day');
await refused(q('quick_save',{person_id:pH,day:add(-1),start:'10:00',end:'14:00'}),/البشرية بس/,'manager cannot fix past days');
await refused(q('quick_save',{person_id:pH,day:add(1),start:'10:00',end:'10:30'}),/من ساعة لـ 16 ساعة/);
await as(2);await refused(q('quick_save',{person_id:pE,day:add(1),start:'10:00',end:'14:00'}),/المدير المباشر/,'unrelated nurse refused');
await as(6);await refused(q('quick_save',{person_id:pE,day:add(1),start:'10:00',end:'14:00'}),/المدير المباشر/,'the employee himself refused');
await as(1);
await refused(q('quick_save',{person_id:pH,day:add(-5),start:'10:00',end:'14:00'}),/3 أيام/,'HR: 3 days back at most');
const past=await q('quick_save',{person_id:pH,day:add(-2),start:'09:00',end:'15:00'});assert.equal(past.extra,false,'no weekly pattern → not a rest day');
await owner("insert into clinic_people.requests(person_id,kind,from_date,to_date,units,note,status,created_by) values($1,'leave',$2,$2,1,'إجازة اختبار','approved',$3)",[pH,add(3),id(1)]);
await refused(q('quick_save',{person_id:pH,day:add(3),start:'10:00',end:'14:00'}),/إجازة معتمدة/);
// the quick shift is a real shift: on time / late from its own start, label and colour
await punch(31,at(fri,'10:22'));
let e=await ev(pE,fri,at(fri,'11:00'));assert.equal(e.status,'late');assert.equal(e.late_min,22);assert.equal(e.template_name,'وردية اليوم (إضافي)');assert.equal(e.template_id,null);
e=await ev(pH,add(-2),at(add(-2),'20:00'));assert.equal(e.status,'absent','no punch on a quick shift → absent like any shift');
// cancel: the manager cannot touch a past day (or a started shift with a punch); HR can
await as(5);await refused(q('quick_cancel',{id:past.id}),/يوم فات/);
const qh=await q('quick_save',{person_id:pH,day:add(2),start:'12:00',end:'18:00'});await q('quick_cancel',{id:qh.id});
assert.equal((await ev(pH,add(2),at(add(2),'13:00'))),undefined,'cancelled quick shift → no row');
await as(1);await q('quick_cancel',{id:qs.id,reason:'اختبار'});assert.equal(await ev(pE,fri,at(fri,'11:00')),undefined,'Friday back to rest');

// B) doctor shift
const ws=(await owner("select id from clinic_reception.workspaces where mode='live' limit 1"))[0]?.id||(await owner("insert into clinic_reception.workspaces(name,mode,owner_id) values('live test','live',$1) returning id",[id(4)]))[0].id;
const prov=async n=>(await owner("insert into clinic_reception.providers(workspace_id,name,department,branch) values($1,$2,'علاج طبيعي','حدائق الأهرام') returning id",[ws,n]))[0].id;
const dr1=await prov('د. علاج طبيعي تجريبي 1'),dr2=await prov('د. علاج طبيعي تجريبي 2');
const av=(p,d,s,e,src='manual')=>owner('insert into clinic_reception.availability(workspace_id,provider_id,starts_at,ends_at,source) values($1,$2,$3::timestamptz,$4::timestamptz,$5) returning id',[ws,p,s,e,src]);
await as(5);await refused(q('flex_save',{person_id:pN,provider_ids:[dr1,dr2]}),/البشرية بس/,'manager cannot link to a doctor');
await as(1);
const X=add(3),Y=add(4),Z=add(5),W=add(6),V=add(7);
const pv=await q('preview',{provider_ids:[dr1],before_min:30,after_min:15,valid_from:X});assert.equal(pv.days.length,7);
await q('flex_save',{person_id:pN,provider_ids:[dr1,dr2],before_min:30,after_min:15,valid_from:today});
await av(dr1,X,at(X,'14:00'),at(X,'21:15'));
await av(dr2,Y,at(Y,'16:00'),at(Y,'19:00'));await av(dr1,Y,at(Y,'18:00'),at(Y,'22:00'));
await av(dr1,Z,at(Z,'12:00'),at(Z,'15:00'));await av(dr1,Z,at(Z,'18:00'),at(Z,'22:00'));
await av(dr1,V,at(V,'10:00'),at(V,'11:00'),'walk_in');
const rows=async d=>owner("select period,to_char(start_at at time zone 'Africa/Cairo','HH24:MI') s,to_char(end_at at time zone 'Africa/Cairo','HH24:MI') e from clinic_people.day_shifts where person_id=$1 and day=$2 and active and source='doctor' order by period",[pN,d]);
assert.deepEqual((await rows(X)).map(r=>r.s+'-'+r.e),['13:30-21:30'],'one doctor: 30 min before, 15 after');
assert.deepEqual((await rows(Y)).map(r=>r.s+'-'+r.e),['15:30-22:15'],'two doctors overlapping: first to last');
assert.deepEqual((await rows(Z)).map(r=>r.s+'-'+r.e),['11:30-15:15','17:30-22:15'],'a 3-hour gap → two periods');
assert.equal((await rows(V)).length,0,'walk-in windows do not make a shift');
e=await ev(pN,W,at(W,'12:00'));assert.equal(e,undefined,'no doctor → no shift (weekly pattern ignored, never absent)');
await punch(32,at(Z,'11:35'));await punch(32,at(Z,'15:20'),1);await punch(32,at(Z,'17:55'));
e=await ev(pN,Z,at(Z,'19:00'));assert.equal(e.status,'on_time');assert.equal(e.late_min,5+25,'5 min at the start + 25 min back late from the break');assert.equal(e.template_name,'حسب الطبيب');
assert.equal(new Date(e.exp_start).toISOString(),new Date(at(Z,'11:30')).toISOString());assert.equal(new Date(e.exp_end).toISOString(),new Date(at(Z,'22:15')).toISOString());
// doctor cancels day X (availability deleted, as the reception exception does) → shift gone, shown as «doctor_off»
await owner('delete from clinic_reception.availability where provider_id=$1 and starts_at=$2::timestamptz',[dr1,at(X,'14:00')]);
assert.equal((await rows(X)).length,0);
let mo=await q('month',{person_id:pN,from:today,to:add(10)});
assert.ok(mo.shifts.some(s=>s.day===X&&!s.active&&s.cancel_reason==='doctor_off'),'month shows the cancelled doctor day');
assert.ok(mo.flex&&mo.flex.doctors.length===2&&mo.flex_days.includes(W),'month returns the link and the flex days');
// quick shift on the doctor-free day W is allowed and needs no extra choice; on a doctor day it is refused
await as(5);await refused(q('quick_save',{person_id:pN,day:Y,start:'10:00',end:'14:00'}),/فيه وردية بالفعل/);
const qw=await q('quick_save',{person_id:pN,day:W,start:'10:00',end:'14:00'});assert.equal(qw.extra,false);
await as(1);
// frozen shift: a doctor shift that starts within 2 hours is kept when she already clocked in, removed when she did not
if(T.h>=1&&T.h<=19){
  const s0=new Date(Date.now()+60*60e3),e0=new Date(Date.now()+4*60*60e3);
  const a1=(await av(dr2,today,s0.toISOString(),e0.toISOString()))[0].id;
  assert.equal((await rows(today)).length,1,'today doctor shift stored');
  await owner('delete from clinic_reception.availability where id=$1',[a1]);
  assert.equal((await rows(today)).length,0,'frozen but no punch → removed');
  const a2=(await av(dr2,today,s0.toISOString(),e0.toISOString()))[0].id;
  await punch(32,new Date(Date.now()-5*60e3).toISOString());
  await owner('delete from clinic_reception.availability where id=$1',[a2]);
  assert.equal((await rows(today)).length,1,'frozen and she clocked in → kept');
}
// flex_stop from Z: the weekly pattern is back from Z on
await q('flex_stop',{person_id:pN,from:Z});
assert.equal((await rows(Z)).length,0);e=await ev(pN,Z,at(Z,'19:00'));assert.equal(e.template_name,'صباحي','weekly pattern again after the link ends');
assert.equal((await rows(Y)).length,1,'days before the stop keep their doctor shift');

// C) readers
await q('flex_save',{person_id:pH,department:'علاج طبيعي',valid_from:today});
const ht=await call('hr_attendance_today',[today]);
const unsch=Number((await owner("select count(*) c from clinic_people.people p where p.status<>'ended' and p.kind<>'doctor' and not exists(select 1 from clinic_people.person_shifts s where s.person_id=p.id) and not exists(select 1 from clinic_people.flex_links f where f.person_id=p.id)"))[0].c);
assert.equal(Number(ht.unscheduled),unsch,'flex people are not «بدون جدول»');
const sw=await call('hr_shifts_workspace',[]);assert.equal(sw.people.find(p=>p.id===pH).flex,true);assert.equal(sw.people.find(p=>p.id===pE).flex,false);
await punch(31,new Date(Date.now()-60e3).toISOString());
const offDay=await owner('select clinic_reception.nurse_presence($1,$2::date) j',[id(6),today]);
const pr=offDay[0].j;
if(pr.state==='off'){assert.ok(pr.punch_in,'«off» carries today\'s first check-in');}
await as(5);let st=await call('clinic_reception_nursing',[ws,'staff_today',{}]);
let me6=st.nurses.find(n=>n.admin_id===id(6));
if(me6.state==='off'){assert.equal(me6.can_quick,true,'her manager can add a quick shift');assert.equal(me6.person_id,pE);assert.ok(me6.punch_in);}
await as(2);st=await call('clinic_reception_nursing',[ws,'staff_today',{}]);me6=st.nurses.find(n=>n.admin_id===id(6));
assert.equal(me6.can_quick,false);assert.equal(me6.person_id,null,'person id only for someone who can act');
await as(1);

// C2) notices in the employee's own inbox: doctor cancelled (X), quick shift added by her manager (W); never her own actions
await as(7);let ib=await call('personal_home_inbox',[]);
const hn=ib.notices.filter(n=>n.type==='hr_shift');
assert.ok(hn.some(n=>/الطبيب لغى يوم/.test(n.message)&&n.message.includes(X.slice(8,10)+'/'+X.slice(5,7))),'doctor cancelled → notice');
assert.ok(hn.some(n=>/اتحطتلك وردية يوم/.test(n.message)&&/10:00 لـ 14:00/.test(n.message)),'quick shift added → notice');
assert.equal(ib.unread,1+hn.length,'unread counts the shift notices');assert.equal(ib.notices.length,1+hn.length,'base notices kept');
await owner('insert into personal_notice_reads(admin_id,notice_key) values($1,$2)',[id(7),hn[0].key]);
ib=await call('personal_home_inbox',[]);assert.equal(ib.unread,hn.length,'read state honoured');
await as(6);ib=await call('personal_home_inbox',[]);assert.ok(ib.notices.some(n=>n.type==='hr_shift'&&/اتلغت ورديتك يوم/.test(n.message)),'quick shift cancelled by HR → notice to her');
await as(5);ib=await call('personal_home_inbox',[]);assert.equal(ib.notices.filter(n=>n.type==='hr_shift').length,0,'the manager gets no notice for his own action / other people');
await as(1);

// D) payroll: worked extra quick day
const c=await fin('business_command',['request',{kind:'employment',subject:'EMP-X',employee_name:'ممرضة يوم إضافي',base:6000,from:'2026-01-01',to:'2026-12-31',reference:'CONTRACT-X',note:'عقد اختبار'},key()]);
await owner('update admins set has_hr_access=true where id=$1',[id(3)]);await as(3);await fin('business_command',['review',{id:c,approve:true,note:'اعتماد العقد'},key()]);
await as(1);const pp=await call('hr_command',['person',{full_name:'ممرضة يوم إضافي',finance_subject:'EMP-X'}]);
const rule=await call('hr_payroll_command',['rule',{person_id:pp,valid_from:'2026-01-01',valid_to:'2026-12-31',late_grace:15,late_minute:2,absence_day:200,overtime_hour:50,note:'قواعد اختبار'}]);
await as(3);await call('hr_payroll_command',['rule_review',{id:rule,decision:'approved',review_note:'اعتماد القواعد'}]);await as(1);
await owner("insert into clinic_people.day_shifts(person_id,day,start_at,end_at,source,extra,created_by) values($1,'2026-10-09','2026-10-09T10:00+02:00','2026-10-09T14:00+02:00','quick',true,$2),($1,'2026-10-10','2026-10-10T10:00+02:00','2026-10-10T14:00+02:00','quick',true,$2)",[pp,id(1)]);
await owner("insert into clinic_people.attendance(person_id,day,scheduled_start,scheduled_end,actual_start,actual_end,note,status,created_by,reviewed_by) values($1,'2026-10-09','2026-10-09T10:00+02:00','2026-10-09T14:00+02:00','2026-10-09T10:00+02:00','2026-10-09T14:00+02:00','اختبار','approved',$2,$3)",[pp,id(1),id(3)]);
const calc=await call('hr_payroll_calculate',[pp,'2026-10-01']);
assert.equal(Number(calc.extra_days),1,'only the worked extra day is paid');assert.equal(Number(calc.extra_days_pay),200);
assert.equal(Number(calc.pre_tax_net),6000+200);

// E) second run refused; rollback restores every patched body
await db.exec('reset role');await assert.rejects(()=>db.exec(M('20261127130000_hr_flex_shifts')),/من قبل/);await db.exec('rollback').catch(()=>{});
await db.exec(fs.readFileSync('supabase/rollbacks/20261127130000_hr_flex_shifts.rollback.sql','utf8'));
assert.equal((await snap())[0].s,before,'rollback restores the original definitions');
assert.equal((await owner("select to_regclass('clinic_people.day_shifts') t"))[0].t,null);
console.log('PASS hr flex shifts: quick shift (who / which day / rest-day extra / lateness / cancel), doctor shift (availability trigger, two periods, no doctor = no shift, cancel, freeze, stop), readers, extra-day payroll, rollback.');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exit(1)});
