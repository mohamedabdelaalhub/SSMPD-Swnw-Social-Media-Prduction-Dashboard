// Home-visit address + permanent/temporary patient notes; changing/deleting a permanent note needs the manager (20261120020000).
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception-bridge.cjs');
(async()=>{const b=await boot([]);const {db,as,owner,call,id}=b;
 const mig=n=>fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(x=>x.startsWith(n)),'utf8');
 try{await db.exec('reset role');
  const M=mig('20261120020000');await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  const ws=(await owner("insert into clinic_reception.workspaces(name,mode,owner_id) values('live','live',$1) returning id",[id(1)]))[0].id;
  await owner("insert into clinic_reception.settings(id) values(true) on conflict do nothing");await owner("update clinic_reception.settings set live_enabled=true,cutover_at=now() where id");
  await owner("insert into admins(id,name,role) values($1,'Mgr','reception')",[id(8)]);
  await owner("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,$3),($1,$4,$5)",[ws,id(4),['book','view'],id(8),['book','view','manage']]);
  const pat=(await owner("insert into clinic_reception.patients(workspace_id,file_no,name,phone,created_by) values($1,'F1','مريضة','0100',$2) returning id",[ws,id(1)]))[0].id;
  const prov=(await owner("insert into clinic_reception.providers(workspace_id,name,doctor_key,department,branch) values($1,'أخصائي','DOC-P','العلاج الطبيعي','حدائق الأهرام') returning id",[ws]))[0].id;
  const svc=(await owner("insert into clinic_reception.services(workspace_id,code,name,department,price,minutes) values($1,'HPT','جلسة منزلية','العلاج الطبيعي',500,60) returning id",[ws]))[0].id;
  const app=(await owner("insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at,status,created_by) values($1,$2,$3,$4,now(),now()+interval '1 hour','booked',$5) returning id",[ws,pat,prov,svc,id(1)]))[0].id;
  const x=(a,p)=>call('clinic_reception_patient_extras',[ws,a,p]);
  // service flag: manager only
  await as(4);await assert.rejects(()=>x('service_home',{service_id:svc,is_home:true}),/لمدير الاستقبال/);
  await as(8);await x('service_home',{service_id:svc,is_home:true});assert.equal((await x('services',{})).find(s=>s.id===svc).is_home,true);await as(4);await assert.rejects(()=>x('services',{}),/لمدير الاستقبال/);
  // booking save: home address required, bad maps link refused, then saved on the patient + snapshot on the appointment
  await as(4);
  await assert.rejects(()=>x('save_booking',{patient_id:pat,appointment_id:app,home:true,address:{street:'ش'}}),/المنطقة ورقم العمارة/);
  await assert.rejects(()=>x('save_booking',{patient_id:pat,appointment_id:app,home:true,address:{area:'حدائق',building:'45',maps_url:'https://evil.example/maps'}}),/خرائط جوجل/);
  const addr={area:'حدائق الأهرام',street:'شارع تجريبي',building:'45',floor:'3',apartment:'12',landmark:'قدام صيدلية',directions:'يمين الأسانسير',phone:'0100',maps_url:'https://maps.app.goo.gl/abc123',junk:'x'};
  await x('save_booking',{patient_id:pat,appointment_id:app,home:true,address:addr,note:'بتحب بعد العصر',appointment_note:'محتاج كرسي'});
  let g=await x('get',{patient_id:pat});assert.equal(g.address.building,'45');assert.equal(g.address.junk,undefined,'unknown keys dropped');assert.equal(g.note,'بتحب بعد العصر');assert.equal(g.can_manage,false);
  let bd=await x('board',{ids:[app]});assert.equal(bd.extras[app].home,true);assert.equal(bd.extras[app].note,'محتاج كرسي');assert.equal(bd.extras[app].patient_note,'بتحب بعد العصر');assert.equal(bd.extras[app].address.apartment,'12');assert.deepEqual(bd.home_services,[svc]);
  // existing permanent note cannot be overwritten directly
  await assert.rejects(()=>x('save_booking',{patient_id:pat,note:'حاجة تانية'}),/اطلب التعديل/);
  await x('save_booking',{patient_id:pat,note:'بتحب بعد العصر'});// same text is fine
  // delete request → manager approves → gone
  await assert.rejects(()=>x('note_change_request',{patient_id:pat,note:'',reason:''}),/سبب/);
  const rq=await x('note_change_request',{patient_id:pat,note:'',reason:'الحساب اتدفع'});assert.equal(rq.status,'pending');
  await assert.rejects(()=>x('note_change_request',{patient_id:pat,note:'',reason:'تاني'}),/مستني اعتماد/);
  await assert.rejects(()=>x('note_review',{id:rq.id,approve:true}),/لمدير الاستقبال/);
  g=await x('get',{patient_id:pat});assert.equal(g.pending.reason,'الحساب اتدفع');assert.equal(g.note,'بتحب بعد العصر','still there until approved');
  await as(8);assert.equal((await x('note_requests',{})).length,1);await x('note_review',{id:rq.id,approve:true});
  await as(4);g=await x('get',{patient_id:pat});assert.equal(g.note,null,'deleted after approval');assert.equal(g.pending,null);
  // change request rejected keeps the note
  await x('save_booking',{patient_id:pat,note:'ملاحظة جديدة'});const r2=await x('note_change_request',{patient_id:pat,note:'نص معدل',reason:'تصحيح'});
  await as(8);await x('note_review',{id:r2.id,approve:false,review_note:'لأ'});await as(4);assert.equal((await x('get',{patient_id:pat})).note,'ملاحظة جديدة');
  // non-home booking without temp note clears the appointment extras
  await x('save_booking',{patient_id:pat,appointment_id:app,home:false});bd=await x('board',{ids:[app]});assert.equal(bd.extras[app].home,false);assert.equal(bd.extras[app].patient_note,'ملاحظة جديدة');
  // another workspace's patient is refused
  await assert.rejects(()=>x('get',{patient_id:'40000000-0000-4000-8000-000000000999'}),/خارج المساحة/);
  await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261120020000_reception_home_visit_notes.rollback.sql','utf8'));
  console.log('reception home visit + patient notes: ok');
 }catch(e){console.error(e);process.exitCode=1;}finally{await db.close();}
})();
