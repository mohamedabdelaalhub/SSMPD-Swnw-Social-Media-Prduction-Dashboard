// 20261126160000: a unit provider (doctor_key NULL, e.g. «التمريض») executes its service with no doctor contract and fee 0;
// a provider with a doctor_key still needs exactly one contract (unchanged). Live order of calls: sync_doctor_contract, then execute.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs');
const cairoDay=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(t);
(async()=>{
 const {db,rpc,as,id}=await boot(['reception_services_packages']);
 const today=cairoDay(new Date());
 const w=await rpc('clinic_reception_bootstrap');let k=100;const key=()=>'63000000-0000-4000-8000-'+String(++k).padStart(12,'0');
 const cmd=(a,p)=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:key()});
 let snap=await rpc('clinic_reception_snapshot',{p_workspace:w,p_from:today,p_to:today});
 const doc=snap.providers[0],consult=snap.services.find(s=>s.code==='CONSULT'),pat=snap.patients[0].id;
 await db.exec('reset role');
 // mirror live: 20261116230000 moved the core agreement-validity checks from current_date to clinic_reception.today() (Cairo).
 // Without it this test failed between 00:00 and 02:00 Cairo (core used the UTC date, the unit agreement starts on the Cairo date).
 await db.exec(fs.readFileSync('supabase/migrations/20261116230000_reception_agreements_cairo_date.sql','utf8'));
 // live-shaped: today(), finance contracts table + resolver, and the 20261108230000 sync_doctor_contract
 await db.exec(`create or replace function clinic_reception.today() returns date language sql stable as $f$select (now() at time zone 'Africa/Cairo')::date$f$;
  create schema if not exists clinic_finance;
  create table clinic_finance.doctor_contracts(id uuid primary key default gen_random_uuid(),doctor_key text,service_scope text,status text,valid_from date,valid_to date,rate numeric,basis text default 'performed',base_scope text default 'service',deduction text default 'none',reference text default 'x',created_by uuid,reviewed_by uuid);
  create function clinic_finance.doctor_contract_for_service(p_doctor text,p_code text,p_name text,p_department text,p_on date) returns setof clinic_finance.doctor_contracts language sql stable as $f$select * from clinic_finance.doctor_contracts c where c.doctor_key=p_doctor and c.status='active' and p_on between c.valid_from and c.valid_to and c.service_scope=p_code$f$;
`);
 const mig=fs.readFileSync('supabase/migrations/20261108230000_department_contracts.sql','utf8');
 const def=mig.slice(mig.indexOf('create or replace function clinic_reception.sync_doctor_contract'),mig.indexOf('end $$;',mig.indexOf('create or replace function clinic_reception.sync_doctor_contract'))+7);
 await db.exec(def);
 // a unit provider in the consult department (doctor_key NULL) + a doctor provider with a key but no contract
 const unit=(await db.query("insert into clinic_reception.providers(workspace_id,name,department,branch,active) select workspace_id,'التمريض',department,branch,true from clinic_reception.providers where id=$1 returning id",[doc.id])).rows[0].id;
 await db.query("update clinic_reception.providers set doctor_key='DOC-1' where id=$1",[doc.id]);
 // an arrived visit with two ordered consults (postgres fixture)
 const me=id(1);
 const ap=(await db.query("insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at,status,created_by,arrived_at) values($1,$2,$3,$4,now(),now()+interval '15 minutes','arrived',$5,now()) returning id",[w,pat,unit,consult.id,me])).rows[0].id;
 const v=(await db.query("insert into clinic_reception.visits(workspace_id,appointment_id,patient_id,opened_by) values($1,$2,$3,$4) returning id",[w,ap,pat,me])).rows[0].id;
 const ord=async p=>(await db.query("insert into clinic_reception.orders(workspace_id,visit_id,service_id,provider_id,quantity,price,snapshot,created_by) select $1,$2,s.id,$3,1,s.price,to_jsonb(s),$4 from clinic_reception.services s where s.id=$5 returning id",[w,v,p,me,consult.id])).rows[0].id;
 const o1=await ord(unit),o2=await ord(doc.id);
 const sync=(o,p)=>db.query('select clinic_reception.sync_doctor_contract($1,$2,$3)',[w,o,p]);
 // BEFORE the fix: the unit is refused like on live
 await assert.rejects(sync(o1,unit),/حدد عقدًا واحدًا معتمدًا للطبيب والخدمة/);
 await db.exec(fs.readFileSync('supabase/migrations/20261126160000_unit_provider_no_doctor_fee.sql','utf8'));
 await assert.rejects(db.exec(fs.readFileSync('supabase/migrations/20261126160000_unit_provider_no_doctor_fee.sql','utf8')),/تم تطبيق هذا الملف من قبل/);
 // any hour: simulate 00:00–02:00 Cairo (today() = server date + 1) — a fresh unit pair still executes (core and wrapper both use today())
 const realToday=(await db.query("select pg_get_functiondef('clinic_reception.today()'::regprocedure) d")).rows[0].d;
 await db.exec("create or replace function clinic_reception.today() returns date language sql stable as $f$select current_date + 1$f$");
 const unit2=(await db.query("insert into clinic_reception.providers(workspace_id,name,department,branch,active) select workspace_id,'المعمل',department,branch,true from clinic_reception.providers where id=$1 returning id",[doc.id])).rows[0].id;
 const oW=await ord(unit2);await db.query("select set_config('test.admin',$1,false)",[me]);await sync(oW,unit2);
 await as(1);await cmd('execute',{id:oW,provider_id:unit2});await db.exec('reset role');
 assert.equal((await db.query("select status from clinic_reception.orders where id=$1",[oW])).rows[0].status,'completed','executes in the Cairo-ahead window');
 await db.exec(realToday);
 // AFTER: unit → 0% agreement, execute completes with fee 0; a second sync does not duplicate
 await db.query("select set_config('test.admin',$1,false)",[me]);await sync(o1,unit);await sync(o1,unit);
 const ag=(await db.query("select rate,status,reference from clinic_reception.doctor_agreements where provider_id=$1",[unit])).rows;
 assert.equal(ag.length,1);assert.equal(Number(ag[0].rate),0);assert.equal(ag[0].status,'active');
 await as(1);await cmd('execute',{id:o1,provider_id:unit});await db.exec('reset role');
 const r1=(await db.query("select status,doctor_fee from clinic_reception.orders where id=$1",[o1])).rows[0];
 assert.equal(r1.status,'completed');assert.equal(Number(r1.doctor_fee),0);
 // doctor WITH a key and no contract: still refused (unchanged)
 await assert.rejects(sync(o2,doc.id),/حدد عقدًا واحدًا معتمدًا للطبيب والخدمة/);
 // ... and with exactly one contract it syncs a 30% agreement as before
 await db.query("insert into clinic_finance.doctor_contracts(doctor_key,service_scope,status,valid_from,valid_to,rate,created_by,reviewed_by) values('DOC-1','CONSULT','active',current_date-1,current_date+30,30,$1,$1)",[me]);
 await sync(o2,doc.id);
 assert.equal(Number((await db.query("select rate from clinic_reception.doctor_agreements where provider_id=$1 and status='active'",[doc.id])).rows[0].rate),30);
 // rollback restores the previous function
 await db.exec(fs.readFileSync('supabase/rollbacks/20261126160000_unit_provider_no_doctor_fee.rollback.sql','utf8'));
 assert.equal((await db.query("select to_regprocedure('clinic_reception.sync_doctor_contract_before_units(uuid,uuid,uuid)') x")).rows[0].x,null);
 const o3=await ord(unit);await assert.rejects(sync(o3,unit),/حدد عقدًا واحدًا معتمدًا للطبيب والخدمة/);
 console.log('PASS unit provider no doctor fee: unit (no doctor_key) refused before; after the fix gets one 0% agreement (idempotent), executes with fee 0; doctor without contract still refused, with one contract syncs 30%; re-apply refused; rollback restores the refusal.');
})().catch(e=>{console.error(e);process.exit(1);});
