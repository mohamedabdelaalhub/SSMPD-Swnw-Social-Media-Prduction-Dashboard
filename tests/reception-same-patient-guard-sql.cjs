// Owner 2026-11-19: the same patient cannot be booked at overlapping times; a same-day booking needs confirmation.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite'),{randomUUID}=require('crypto');
(async()=>{const db=new PGlite(),id=()=>randomUUID(),q=(s,p)=>db.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0];
 const U=id(),A=id(),ws=id(),d1=id(),d2=id(),s1=id(),s2=id(),p1=id(),p2=id();
 try{await db.exec(`create role authenticated;create role anon;create schema auth;create schema clinic_reception;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create table admins(id uuid primary key,user_id uuid,name text,active boolean default true);
  create function my_admin_id() returns uuid language sql stable security definer as $$select id from admins where user_id=auth.uid()$$;
  create table clinic_reception.providers(id uuid primary key,name text,department text);
  create table clinic_reception.services(id uuid primary key,name text,minutes int);
  create table clinic_reception.patients(id uuid primary key,name text,file_no text);
  create table clinic_reception.appointments(id uuid primary key default gen_random_uuid(),workspace_id uuid,patient_id uuid,provider_id uuid,service_id uuid,starts_at timestamptz,ends_at timestamptz,status text default 'booked',source text,created_by uuid,created_at timestamptz default now(),confirmed_at timestamptz);
  create table clinic_reception.appointment_extras(appointment_id uuid primary key,note text);
  create table clinic_reception.external_bookings(id uuid primary key default gen_random_uuid(),reception_patient_id uuid,provider_id uuid,starts_at timestamptz,state text);
  create function clinic_reception.access(w uuid,a text) returns uuid language plpgsql security definer as $$begin if my_admin_id() is null then raise exception 'سجل الدخول';end if;return my_admin_id();end $$;
  create function clinic_reception_command(p_workspace uuid,p_action text,p_payload jsonb,p_token uuid) returns jsonb language plpgsql security definer as $$
  declare v uuid;t timestamptz;begin
   if p_action in ('book','walk_in') then t:=coalesce(nullif(p_payload->>'starts_at','')::timestamptz,now());
    insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at,source,created_by) values(p_workspace,(p_payload->>'patient_id')::uuid,(p_payload->>'provider_id')::uuid,(p_payload->>'service_id')::uuid,t,t+interval '20 minutes',p_payload->>'source',my_admin_id()) returning id into v;
   elsif p_action='reschedule' then t:=(p_payload->>'starts_at')::timestamptz;update clinic_reception.appointments set starts_at=t,ends_at=t+interval '20 minutes' where id=(p_payload->>'id')::uuid returning id into v;
   end if;return jsonb_build_object('id',v);end $$;
  grant usage on schema public to authenticated;`);
  await q("insert into admins values($1,$2,'دينا')",[A,U]);await db.exec(`select set_config('request.jwt.claim.sub','${U}',false)`);
  await q("insert into clinic_reception.providers values($1,'أخصائي جلدية','جلدية'),($2,'أخصائي ليزر','ليزر')",[d1,d2]);
  await q("insert into clinic_reception.services values($1,'كشف جلدية',20),($2,'جلسة ليزر',20)",[s1,s2]);
  await q("insert into clinic_reception.patients values($1,'شهد تجريبية','P-1'),($2,'مريض تاني','P-2')",[p1,p2]);
  // two legacy overlapping rows exist before the migration; arriving them must still work
  await q("insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at) values($1,$2,$3,$4,'2030-01-02T10:00:00+02','2030-01-02T10:20:00+02'),($1,$2,$5,$6,'2030-01-02T10:10:00+02','2030-01-02T10:30:00+02')",[ws,p2,d1,s1,d2,s2]);
  const M=fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(x=>x.includes('_reception_same_patient_guard.sql')),'utf8');
  await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  await q("update clinic_reception.appointments set status='arrived' where patient_id=$1",[p2]);
  const book=(p)=>one("select clinic_reception_command($1,'book',$2,gen_random_uuid()) r",[ws,p]);
  let r=await book({patient_id:p1,provider_id:d1,service_id:s1,starts_at:'2030-01-01T17:00:00+02'});assert.ok(r.r.id);
  const first=r.r.id;await q("insert into clinic_reception.appointment_extras values($1,'هتيجي مع والدتها')",[first]);
  // same day, another doctor: warning with the other booking in DETAIL
  let err;try{await book({patient_id:p1,provider_id:d2,service_id:s2,starts_at:'2030-01-01T18:00:00+02'});}catch(e){err=e;}
  assert.ok(err);assert.equal(err.hint,'same_patient_same_day');assert.match(err.message,/عنده حجز تاني في نفس اليوم/);
  const det=JSON.parse(err.detail);assert.equal(det.length,1);assert.equal(det[0].service,'كشف جلدية');assert.equal(det[0].doctor,'أخصائي جلدية');
  assert.equal(det[0].booked_by,'دينا');assert.equal(det[0].note,'هتيجي مع والدتها');assert.equal(det[0].file_no,'P-1');
  // confirmed: books
  r=await book({patient_id:p1,provider_id:d2,service_id:s2,starts_at:'2030-01-01T18:00:00+02',same_day_ok:true});assert.ok(r.r.id);
  // overlapping time: refused even when confirmed
  await assert.rejects(()=>book({patient_id:p1,provider_id:d2,service_id:s2,starts_at:'2030-01-01T17:10:00+02',same_day_ok:true}),/المريض ده محجوز في نفس الوقت: كشف جلدية مع أخصائي جلدية \(17:00 – 17:20\)/);
  // a reschedule into an overlap is refused too
  await assert.rejects(()=>one("select clinic_reception_command($1,'reschedule',$2,gen_random_uuid())",[ws,{id:r.r.id,starts_at:'2030-01-01T17:05:00+02'}]),/محجوز في نفس الوقت/);
  // a different day: no warning; walk-in today checks today
  r=await book({patient_id:p1,provider_id:d1,service_id:s1,starts_at:'2030-01-05T17:00:00+02'});assert.ok(r.r.id);
  await one("select clinic_reception_command($1,'walk_in',$2,gen_random_uuid())",[ws,{patient_id:p1,provider_id:d1,service_id:s1}]);
  await assert.rejects(()=>one("select clinic_reception_command($1,'walk_in',$2,gen_random_uuid())",[ws,{patient_id:p1,provider_id:d2,service_id:s2}]),/same_patient|عنده حجز تاني/);
  // an automatic booking being booked is not asked
  await q("insert into clinic_reception.external_bookings(reception_patient_id,provider_id,starts_at,state) values($1,$2,'2030-01-05T19:00:00+02','pending')",[p1,d2]);
  r=await book({patient_id:p1,provider_id:d2,service_id:s2,starts_at:'2030-01-05T19:00:00+02'});assert.ok(r.r.id);
  // details popup
  const dd=(await one("select clinic_reception_appointment_details($1,$2) d",[ws,first])).d;assert.equal(dd.doctor,'أخصائي جلدية');assert.equal(dd.note,'هتيجي مع والدتها');
  await q("update clinic_reception.appointments set status='cancelled' where id=$1",[first]);
  assert.equal((await one("select clinic_reception_appointment_details($1,$2) d",[ws,first])).d.status,'cancelled');
  // other actions pass through untouched
  assert.ok((await one("select clinic_reception_command($1,'other',$2,gen_random_uuid()) r",[ws,{}])).r);
  // rollback restores the previous command
  await db.exec(fs.readFileSync('supabase/rollbacks/'+fs.readdirSync('supabase/rollbacks').find(x=>x.includes('_reception_same_patient_guard.')),'utf8'));
  r=await book({patient_id:p1,provider_id:d2,service_id:s2,starts_at:'2030-01-05T17:00:00+02'});assert.ok(r.r.id,'no guard after rollback');
  console.log('reception same-patient guard: ok');
 }catch(e){console.error(e);process.exitCode=1;}finally{await db.close();}})();
