// 20261128180000 «تنبيه الخدمة المكررة» (owner 2026-11-28): the SAME service (same code) already on the visit / on the patient's
// visits today / booked for the patient today → 'order_add' / 'book' / 'walk_in' / journey service request refused with hint
// 'duplicate_service' (message «الخدمة دي (…) موجودة بالفعل … عايز تضيفها تاني فعلاً؟») unless confirm_duplicate; the «again» RPC
// adds it; cancelled ones do not count; another service / another day pass; a replayed token returns the first answer; rollback.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs'),{randomUUID}=require('crypto');
(async()=>{const {db,as,rpc,id}=await boot(['reception_services_packages','reception_contracts_controls','reception_booking_qty_continuation_no_answer','reception_booking_confirm_duration','reception_weekly_schedule_walk_in']);
 const w=await rpc('clinic_reception_bootstrap'),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const tomorrow=new Date(Date.parse(date)+86400000).toISOString().slice(0,10);
 const cmd=(a,p,t=randomUUID())=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:t});
 const q=async(sql,a,who=1)=>{await db.exec('reset role');const r=(await db.query(sql,a)).rows;await as(who);return r;};
 let s=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:date,p_to:date});const provider=s.providers[0].id,dept=s.providers[0].department;
 await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
 for(const [c,n,pr] of [['INJ','حقنة عضل',50],['ECG','رسم قلب',200],['XR','أشعة صدر',150]])await cmd('service',{code:c,name:n,department:dept,price:pr,minutes:15,bom:[]});
 s=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:date,p_to:date});const S=c=>s.services.find(x=>x.code===c).id;
 for(const d of [date,tomorrow])await cmd('availability',{provider_id:provider,starts_at:d+'T04:00:00Z',ends_at:d+'T21:00:00Z'});
 // journey request service lives on live only (live-capture): a minimal stand-in with the same signature when this database lacks it
 await db.exec('reset role');
 if(!(await db.query("select to_regprocedure('public.clinic_reception_journey_request_service(uuid,uuid,uuid,uuid)') p")).rows[0].p){
  await db.exec(`create table if not exists clinic_reception.journey_events(id uuid primary key default gen_random_uuid(),workspace_id uuid,idempotency_key text,metadata jsonb);
   create function public.clinic_reception_journey_request_service(p_workspace uuid,p_appointment uuid,p_service uuid,p_token uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $f$
   declare v clinic_reception.visits%rowtype;s clinic_reception.services%rowtype;o uuid;e uuid;begin
    select id into e from clinic_reception.journey_events where workspace_id=p_workspace and idempotency_key='service-request:'||p_token::text;
    if e is not null then return jsonb_build_object('event_id',e,'duplicate',true);end if;
    select * into v from clinic_reception.visits where appointment_id=p_appointment and status='open';select * into s from clinic_reception.services where id=p_service;
    insert into clinic_reception.orders(workspace_id,visit_id,service_id,provider_id,quantity,price,snapshot,created_by) values(p_workspace,v.id,s.id,(select provider_id from clinic_reception.appointments where id=p_appointment),1,s.price,to_jsonb(s),public.my_admin_id()) returning id into o;
    insert into clinic_reception.journey_events(workspace_id,idempotency_key,metadata) values(p_workspace,'service-request:'||p_token::text,jsonb_build_object('order_id',o)) returning id into e;
    return jsonb_build_object('order_id',o,'event_id',e);end $f$;
   revoke all on function public.clinic_reception_journey_request_service(uuid,uuid,uuid,uuid) from public,anon;grant execute on function public.clinic_reception_journey_request_service(uuid,uuid,uuid,uuid) to authenticated;`);}
 const M=fs.readFileSync('supabase/migrations/20261128180000_duplicate_service_warn.sql','utf8');await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback').catch(()=>{});
 const pat=async n=>(await db.query("insert into clinic_reception.patients(workspace_id,file_no,name,phone,created_by) values($1,$2,$3,'01000000000',$4) returning id",[w,'D'+n,'مريض '+n,id(1)])).rows[0].id;
 const A=await pat(1),B=await pat(2);
 const refused=async(p,re,where)=>{let err=null;try{await p;}catch(e){err=e;}assert(err,'refused: '+re);assert.equal(err.hint,'duplicate_service',err.message);assert.match(err.message,re);if(where)assert.equal(JSON.parse(err.detail).where,where);return err;};
 // booking: same service same day for the same patient (reception user, admin 3)
 await as(3);const k=randomUUID();const b1=await cmd('book',{patient_id:A,provider_id:provider,service_id:S('INJ'),starts_at:date+'T08:00:00Z'},k);
 const b1r=await cmd('book',{patient_id:A,provider_id:provider,service_id:S('INJ'),starts_at:date+'T08:00:00Z'},k);assert.equal(b1r.id,b1.id,'replayed token = first answer, no warning');
 await refused(cmd('book',{patient_id:A,provider_id:provider,service_id:S('INJ'),starts_at:date+'T09:00:00Z'}),/^الخدمة دي \(حقنة عضل\) محجوزة بالفعل للمريض ده النهارده الساعة \d{1,2}:\d{2} [صم]( بواسطة .+)?\. عايز تحجزها تاني فعلاً؟$/,'booking');
 await cmd('book',{patient_id:A,provider_id:provider,service_id:S('ECG'),starts_at:date+'T09:00:00Z'});   // another service → fine
 await cmd('book',{patient_id:A,provider_id:provider,service_id:S('INJ'),starts_at:tomorrow+'T09:00:00Z'});   // another day → fine
 await cmd('book',{patient_id:B,provider_id:provider,service_id:S('INJ'),starts_at:date+'T09:15:00Z'});   // another patient → fine
 const b2=await cmd('book',{patient_id:A,provider_id:provider,service_id:S('INJ'),starts_at:date+'T10:00:00Z',confirm_duplicate:true});assert(b2.id,'confirmed second booking saved');
 await cmd('cancel',{id:b2.id,reason:'اختبار'}).catch(()=>q("update clinic_reception.appointments set status='cancelled' where id=$1",[b2.id],3));
 // visit: arrive → «+ إضافة خدمة» of the same service on the same visit
 const v=(await cmd('arrive',{id:b1.id})).id;
 await refused(cmd('order_add',{visit_id:v,service_id:S('INJ'),provider_id:provider,quantity:1}),/^الخدمة دي \(حقنة عضل\) موجودة بالفعل على الزيارة دي — اتضافت الساعة \d{1,2}:\d{2} [صم]( بواسطة .+)?\. عايز تضيفها تاني فعلاً؟$/,'visit');
 // a service booked for the patient later today counts too (ECG at 09:00 not arrived yet)
 await refused(cmd('order_add',{visit_id:v,service_id:S('ECG'),provider_id:provider,quantity:1}),/^الخدمة دي \(رسم قلب\) محجوزة بالفعل للمريض ده النهارده الساعة/,'booking');
 const n0=+(await q('select count(*) n from clinic_reception.orders where visit_id=$1',[v],3))[0].n;
 await cmd('order_add',{visit_id:v,service_id:S('XR'),provider_id:provider,quantity:1});
 await cmd('order_add',{visit_id:v,service_id:S('INJ'),provider_id:provider,quantity:1,confirm_duplicate:true});
 assert.equal(+(await q('select count(*) n from clinic_reception.orders where visit_id=$1',[v],3))[0].n,n0+2,'XR + confirmed INJ added');
 // cancelled orders do not count: cancel every XR then add XR again → fine
 await q("update clinic_reception.orders set status='cancelled' where visit_id=$1 and service_id=$2",[v,S('XR')],3);
 await cmd('order_add',{visit_id:v,service_id:S('XR'),provider_id:provider,quantity:1});
 // «أثناء التسجيل»: the read-only check the screens call the moment a service is chosen (reception user), saves nothing
 const chk=p=>rpc('clinic_reception_duplicate_service_check',{p_workspace:w,p_payload:p});const before=+(await q('select count(*) n from clinic_reception.orders',[],3))[0].n;
 let c1=await chk({visit_id:v,service_id:S('INJ')});assert.equal(c1.duplicate,true);assert.equal(c1.booking,false);assert.match(c1.message,/^الخدمة دي \(حقنة عضل\) موجودة بالفعل على الزيارة دي — اتضافت الساعة .+ عايز تضيفها تاني فعلاً؟$/);
 c1=await chk({appointment_id:b1.id,service_id:S('INJ')});assert.equal(c1.duplicate,true);
 c1=await chk({patient_id:A,day:date,service_id:S('ECG')});assert.equal(c1.duplicate,true);assert.equal(c1.booking,true);assert.match(c1.message,/عايز تحجزها تاني فعلاً؟$/);
 assert.equal((await chk({patient_id:B,day:tomorrow,service_id:S('XR')})).duplicate,false);assert.equal((await chk({visit_id:v})).duplicate,false);
 assert.equal(+(await q('select count(*) n from clinic_reception.orders',[],3))[0].n,before,'the check saves nothing');
 await db.exec('reset role');assert.equal((await db.query("select has_function_privilege('anon','public.clinic_reception_duplicate_service_check(uuid,jsonb)','execute') x")).rows[0].x,false);await as(3);
 // journey «طلب خدمة» on the same visit → refused; the «again» RPC adds it
 await refused(rpc('clinic_reception_journey_request_service',{p_workspace:w,p_appointment:b1.id,p_service:S('INJ'),p_token:randomUUID()}),/موجودة بالفعل على الزيارة دي/,'visit');
 const jr=await rpc('clinic_reception_journey_request_service_again',{p_workspace:w,p_appointment:b1.id,p_service:S('INJ'),p_token:randomUUID()});assert(jr.order_id,'again adds it');
 // walk-in of B with the service already booked today → refused
 await refused(cmd('walk_in',{patient_id:B,provider_id:provider,service_id:S('INJ')}),/محجوزة بالفعل للمريض ده النهارده/,'booking');
 // anon cannot call the «again» RPC; the inner functions are closed
 await db.exec('reset role');
 for(const f of ['clinic_reception.command_before_dup_service(uuid,text,jsonb,uuid)','clinic_reception.journey_request_service_before_dup(uuid,uuid,uuid,uuid)','clinic_reception.dup_service_find(uuid,uuid,uuid,uuid,date)'])
  assert.equal((await db.query("select has_function_privilege('authenticated',$1,'execute') x",[f])).rows[0].x,false,f+' closed');
 assert.equal((await db.query("select has_function_privilege('anon','public.clinic_reception_journey_request_service_again(uuid,uuid,uuid,uuid)','execute') x")).rows[0].x,false);
 assert.equal((await db.query("select has_function_privilege('authenticated','public.clinic_reception_journey_request_service_again(uuid,uuid,uuid,uuid)','execute') x")).rows[0].x,true);
 // rollback restores the previous functions
 await db.exec(fs.readFileSync('supabase/rollbacks/20261128180000_duplicate_service_warn.rollback.sql','utf8'));
 assert.equal((await db.query("select to_regprocedure('clinic_reception.command_before_dup_service(uuid,text,jsonb,uuid)') p")).rows[0].p,null);
 await as(3);await cmd('book',{patient_id:A,provider_id:provider,service_id:S('INJ'),starts_at:date+'T11:00:00Z'});   // no guard after rollback
 await db.close();console.log('PASS duplicate service: the read-only check at choose (visit / appointment / patient+day, saves nothing); booking / walk-in / «+ إضافة خدمة» / journey request refused with the owner\'s message, confirm or «again» adds it, cancelled / other service / other day / other patient pass, replay = first answer, closed inner functions, rollback.');
})().catch(e=>{console.error(e);process.exit(1);});
