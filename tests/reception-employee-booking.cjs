const scenario=require('./reception-management-pilot.cjs'),assert=require('node:assert/strict'),fs=require('fs');
(async()=>{const x=await scenario(true),{b,live,day,provider,patient}=x,{db,owner,as,call,id,key}=b;
await owner("delete from clinic_reception.members where admin_id=$1",[id(4)]);
await owner("insert into admins(id,name,role,active) values($1,'خدمة عملاء','customer_service',true),($2,'موظف آخر','customer_service',true),($3,'غير مفعل','reception',false),($4,'مصمم','designer',true),($5,'تمريض','nursing',true)",[7,8,9,10,11].map(id));
await db.exec(`create or replace function can_access_leads() returns boolean language sql stable as $$select has_role('super_admin') or has_role('general_manager') or has_role('reception') or has_role('customer_service')$$;alter table patients add column age integer,add column phone_normalized text,add column created_by uuid;alter table leads add column customer_name text,add column phone_raw text,add column phone_normalized text,add column patient_type text;create sequence patient_code_seq;alter table patients alter column patient_code set default 'QA-'||nextval('patient_code_seq');create schema psychcare;`);
const basics=fs.readFileSync('supabase/migrations/20261017224904_psychology_specialist.sql','utf8');await db.exec(basics.slice(basics.indexOf('create function psychcare.phone'),basics.indexOf('-- A restrictive policy')));
await owner("update patients set age=25 where id=$1",[patient]);
await db.exec(fs.readFileSync('supabase/migrations/20261022194140_reception_employee_booking.sql','utf8'));
for(const n of [1,2,3,4,5,6,7,8,11]){await as(n);assert.equal((await call('clinic_reception_workspaces'))[0].id,live);assert.equal(await call('clinic_reception_bootstrap'),live);assert.equal((await call('clinic_reception_snapshot',[live,day,day])).workspace.mode,'live');}
for(const n of [9,10]){await as(n);assert.deepEqual(await call('clinic_reception_workspaces'),[]);await assert.rejects(()=>call('clinic_reception_bootstrap'),/صلاحية/);}
await as(4);await assert.rejects(()=>call('clinic_reception_command',[live,'provider',{},key()]),/صلاحية/);await assert.rejects(()=>call('clinic_reception_command',[live,'service',{},key()]),/صلاحية|النموذج/);
const lead=key();await owner("insert into leads(id,customer_name,phone_raw,source,assigned_to) values($1,'مريض اختبار','01012345678','facebook',$2)",[lead,id(7)]);await as(8);await assert.rejects(()=>call('clinic_reception_prepare_lead',[lead,{}]),/خارج صلاحيتك/);
await as(7);let p=await call('clinic_reception_prepare_lead',[lead,{}]);assert(p.needs_details);await assert.rejects(()=>call('clinic_reception_prepare_lead',[lead,{age:''}]),/سن المريض/);const baseline=(await owner('select count(*)::int n from patients'))[0].n;await as(7);p=await call('clinic_reception_prepare_lead',[lead,{age:30}]);assert(!p.needs_details);assert(p.created);const again=await call('clinic_reception_prepare_lead',[lead,{}]);assert.equal(again.patient_id,p.patient_id);assert.equal(again.reception_patient_id,p.reception_patient_id);assert.equal((await owner('select count(*)::int n from patients'))[0].n,baseline+1);
const secondLead=key();await owner("insert into leads(id,customer_name,phone_raw,source,assigned_to) values($1,'مريض اختبار','+201012345678','facebook',$2)",[secondLead,id(7)]);await as(7);assert.equal((await call('clinic_reception_prepare_lead',[secondLead,{}])).patient_id,p.patient_id);
const snap=await call('clinic_reception_snapshot',[live,day,day]),service=snap.services[0],activeProvider=snap.providers[0].id;await as(1);await call('clinic_reception_command',[live,'availability',{provider_id:activeProvider,starts_at:day+'T06:00Z',ends_at:day+'T18:00Z'},key()]);const before=(await owner('select count(*)::int n from clinic_finance.entries'))[0].n;await as(7);const token=key(),payload={patient_id:p.reception_patient_id,service_id:service.id,provider_id:activeProvider,starts_at:day+'T10:00Z',lead_id:lead},appointment=await call('clinic_reception_command',[live,'book',payload,token]);assert.deepEqual(await call('clinic_reception_command',[live,'book',payload,token]),appointment);const records=await call('clinic_reception_shared_records',['lead',lead,day,day,0]);assert.equal(records.appointments[0].patient_id,p.patient_id);assert.equal(records.appointments[0].id,appointment.id);assert.equal((await owner('select current_status from leads where id=$1',[lead]))[0].current_status,'booked_on_system');assert.equal((await owner('select count(*)::int n from clinic_finance.entries'))[0].n,before);
await as(4);
const linked=await call('clinic_reception_command',[live,'patient_attach',{patient_id:patient},key()]);
const existingAppointment=await call('clinic_reception_command',[live,'book',{
  patient_id:linked.id,service_id:service.id,provider_id:activeProvider,starts_at:day+'T13:00Z'
},key()]);
const archiveHistory=await call('clinic_reception_shared_records',['patient',patient,day,day,0]);
assert(archiveHistory.appointments.some(row=>row.id===existingAppointment.id&&row.patient_id===patient));
assert.equal((await owner("select has_function_privilege('anon','public.clinic_reception_prepare_lead(uuid,jsonb)','execute') ok"))[0].ok,false);
await db.exec(fs.readFileSync('supabase/migrations/20261114163000_reception_consultation_eligibility.sql','utf8'));
await as(4);
const graded=await call('clinic_reception_snapshot',[live,day,day]);
assert(graded.consultation_scopes);
assert.deepEqual(graded.consultation_scopes[activeProvider],[]);
await owner("insert into pricing_services(name,base_price,supplies_used,profit_margin_percent,active,booking_enabled,booking_code,booking_department,booking_minutes) values ('كشف استشاري',600,'[]',0,true,true,'0001372','خدمات الكشف',20),('كشف أخصائي',500,'[]',0,true,true,'0001371','خدمات الكشف',20)");
await as(1);
const doctor=(await owner('select doctor_key,name from clinic_reception.providers where id=$1',[activeProvider]))[0];
const contract=await call('clinic_finance_doctor_command',['contract',{
  doctor_key:doctor.doctor_key,doctor_name:doctor.name,scope:'0001372',from:day,to:'2030-01-01',
  rate:20,basis:'performed',base_scope:'service',deduction:'none',refund_policy:'proportional_revenue',reference:'QA-CONSULT'
},key()]);
await owner("update clinic_finance.doctor_contracts set status='active' where id=$1",[contract]);
await as(4);
const consult=await call('clinic_reception_snapshot',[live,day,day]);
assert.deepEqual(consult.consultation_scopes[activeProvider],['0001372']);
const consultPayload={patient_id:linked.id,provider_id:activeProvider,starts_at:day+'T14:00Z'};
const specialist=consult.services.find(row=>row.code==='0001371');
await assert.rejects(()=>call('clinic_reception_command',[live,'book',{...consultPayload,service_id:specialist.id},key()]),/خارج تخصص/);
const consultant=consult.services.find(row=>row.code==='0001372');
const consultation=await call('clinic_reception_command',[live,'book',{...consultPayload,service_id:consultant.id},key()]);
assert(consultation.id);
await db.exec('reset role');
await db.exec(fs.readFileSync('supabase/migrations/20261114180000_reception_provider_service_scopes.sql','utf8'));
await owner("insert into pricing_services(name,base_price,supplies_used,profit_margin_percent,active,booking_enabled,booking_code,booking_department,booking_minutes) values ('ليزر جزء تجريبي',200,'[]',0,true,true,'QA-LASER-X','الجلدية والتجميل',20)");
await owner("insert into clinic_reception.provider_service_scopes values($1,'QA-LASER-X')",[activeProvider]);
await as(4);
const noContract=await call('clinic_reception_snapshot',[live,day,day]);
const laser=noContract.services.find(row=>row.code==='QA-LASER-X');
const laserPayload={patient_id:linked.id,service_id:laser.id,provider_id:activeProvider,starts_at:day+'T15:00Z'};
await assert.rejects(()=>call('clinic_reception_command',[live,'book',laserPayload,key()]),/خارج تخصص/);
await as(1);
const laserContract=await call('clinic_finance_doctor_command',['contract',{
 doctor_key:doctor.doctor_key,doctor_name:doctor.name,scope:'QA-LASER-X',from:day,to:'2030-01-01',
 rate:20,basis:'performed',base_scope:'service',deduction:'none',refund_policy:'proportional_revenue',reference:'QA-LASER-CONTRACT'
},key()]);
await owner("update clinic_finance.doctor_contracts set status='active' where id=$1",[laserContract]);
await as(4);
const allowedLaser=await call('clinic_reception_snapshot',[live,day,day]);
assert.deepEqual(allowedLaser.provider_service_scopes[activeProvider],['QA-LASER-X']);
assert.equal(allowedLaser.providers.find(row=>row.id===activeProvider).department,snap.providers[0].department);
assert((await call('clinic_reception_command',[live,'book',laserPayload,key()])).id);
await db.close();console.log('PASS staff connected access, inactive/unrelated denial, customer-service lead scope, required basics, archive dedupe, retry identity, actual booking + lead attribution + shared patient history, no booking journal.');})().catch(e=>{console.error(e.message,e.where,e.stack);process.exit(1)});
