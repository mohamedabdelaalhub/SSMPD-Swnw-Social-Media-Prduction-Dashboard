// Home nursing phase 1 (owner 2026-11-20): performer (doctor / nurse alone / nurse with doctor) + nurse, nurse time held.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite'),{randomUUID}=require('crypto');
(async()=>{const db=new PGlite(),id=()=>randomUUID(),q=(s,p)=>db.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0];
 const U=id(),A=id(),N1=id(),N2=id(),HN=id(),X=id(),OFF=id(),ws=id(),d1=id(),s1=id(),p1=id(),p2=id();
 const M='supabase/migrations/'+fs.readdirSync('supabase/migrations').find(x=>x.includes('_reception_booking_nurse_performer.sql'));
 const R='supabase/rollbacks/'+fs.readdirSync('supabase/rollbacks').find(x=>x.includes('_reception_booking_nurse_performer.'));
 try{await db.exec(`create role authenticated;create role anon;create schema auth;create schema clinic_reception;create schema clinic_people;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create table admins(id uuid primary key,user_id uuid,name text,email text,role text,active boolean default true);
  create table admin_extra_roles(admin_id uuid,role text);
  create table clinic_people.people(id uuid primary key default gen_random_uuid(),admin_id uuid unique,full_name text,code text);
  create function my_admin_id() returns uuid language sql stable security definer as $$select id from admins where user_id=auth.uid()$$;
  create table clinic_reception.appointments(id uuid primary key default gen_random_uuid(),workspace_id uuid,patient_id uuid,provider_id uuid,service_id uuid,starts_at timestamptz,ends_at timestamptz,status text default 'booked');
  create function clinic_reception.access(w uuid,a text) returns uuid language plpgsql security definer as $$begin if my_admin_id() is null then raise exception 'سجل الدخول';end if;return my_admin_id();end $$;
  create function clinic_reception_command(p_workspace uuid,p_action text,p_payload jsonb,p_token uuid) returns jsonb language plpgsql security definer as $$
  declare v uuid;t timestamptz;begin
   if p_payload ? 'performer_mode' or p_payload ? 'nurse_admin_id' then raise exception 'inner got extra keys';end if;
   if p_action in ('book','walk_in') then t:=coalesce(nullif(p_payload->>'starts_at','')::timestamptz,now());
    insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at) values(p_workspace,(p_payload->>'patient_id')::uuid,(p_payload->>'provider_id')::uuid,(p_payload->>'service_id')::uuid,t,t+interval '30 minutes') returning id into v;
   elsif p_action='reschedule' then t:=(p_payload->>'starts_at')::timestamptz;update clinic_reception.appointments set starts_at=t,ends_at=t+interval '30 minutes' where id=(p_payload->>'id')::uuid returning id into v;
   end if;return jsonb_build_object('id',v);end $$;`);
  await q("insert into admins values($1,$2,'دينا','d@x','reception'),($3,null,'ممرضة أولى','n1@x','nursing'),($4,null,null,'n2@x','page_manager'),($5,null,'رئيسة التمريض','h@x','head_nursing'),($6,null,'موظف','x@x','reception'),($7,null,'ممرضة قديمة','o@x','nursing')",[A,U,N1,N2,HN,X,OFF]);
  await q("update admins set active=false where id=$1",[OFF]);await q("insert into admin_extra_roles values($1,'nursing')",[N2]);await q("insert into clinic_people.people(admin_id,full_name,code) values($1,'ممرضة تانية','EMP-000007')",[N2]);
  await db.exec(`select set_config('request.jwt.claim.sub','${U}',false)`);
  await db.exec(fs.readFileSync(M,'utf8'));await assert.rejects(()=>db.exec(fs.readFileSync(M,'utf8')),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  const cmd=(a,p)=>one("select clinic_reception_command($1,$2,$3,gen_random_uuid()) r",[ws,a,p]).then(x=>x.r);
  // nurse list: role or extra role nursing/head_nursing, active only, HR name/code when present
  const list=(await one("select clinic_reception_nurses($1) l",[ws])).l;
  assert.deepEqual(list.map(n=>n.id).sort(),[N1,N2,HN].sort());assert.equal(list.find(n=>n.id===N2).name,'ممرضة تانية');assert.equal(list.find(n=>n.id===N2).code,'EMP-000007');
  // default: no keys → doctor
  let r=await cmd('book',{patient_id:p1,provider_id:d1,service_id:s1,starts_at:'2030-01-01T10:00:00+02'});
  let a=await one("select performer_mode,nurse_admin_id from clinic_reception.appointments where id=$1",[r.id]);assert.equal(a.performer_mode,'doctor');assert.equal(a.nurse_admin_id,null);
  // nurse alone
  r=await cmd('book',{patient_id:p1,provider_id:d1,service_id:s1,starts_at:'2030-01-02T10:00:00+02',performer_mode:'nurse_alone',nurse_admin_id:N1});const first=r.id;
  a=await one("select performer_mode,nurse_admin_id from clinic_reception.appointments where id=$1",[first]);assert.equal(a.performer_mode,'nurse_alone');assert.equal(a.nurse_admin_id,N1);
  // same nurse, overlapping time → refused (the whole booking rolls back)
  const before=(await one("select count(*)::int n from clinic_reception.appointments")).n;
  await assert.rejects(()=>cmd('book',{patient_id:p2,provider_id:d1,service_id:s1,starts_at:'2030-01-02T10:15:00+02',performer_mode:'nurse_with_doctor',nurse_admin_id:N1}),/ممرضة أولى عنده\/عندها زيارة تانية في نفس الوقت/);
  assert.equal((await one("select count(*)::int n from clinic_reception.appointments")).n,before,'nothing saved');
  // another nurse at that time is fine; same nurse right after is fine
  r=await cmd('book',{patient_id:p2,provider_id:d1,service_id:s1,starts_at:'2030-01-02T10:15:00+02',performer_mode:'nurse_with_doctor',nurse_admin_id:N2});assert.ok(r.id);
  r=await cmd('book',{patient_id:p2,provider_id:d1,service_id:s1,starts_at:'2030-01-02T10:30:00+02',performer_mode:'nurse_alone',nurse_admin_id:N1});assert.ok(r.id);
  // bad input
  await assert.rejects(()=>cmd('book',{patient_id:p1,provider_id:d1,service_id:s1,performer_mode:'nurse_alone'}),/اختار الممرض/);
  await assert.rejects(()=>cmd('book',{patient_id:p1,provider_id:d1,service_id:s1,performer_mode:'nurse_alone',nurse_admin_id:X}),/مش متسجّل في التمريض/);
  await assert.rejects(()=>cmd('book',{patient_id:p1,provider_id:d1,service_id:s1,performer_mode:'nurse_alone',nurse_admin_id:OFF}),/مش متسجّل في التمريض/);
  await assert.rejects(()=>cmd('book',{patient_id:p1,provider_id:d1,service_id:s1,performer_mode:'x'}),/مين اللي هينفّذ/);
  // doctor mode ignores a sent nurse
  r=await cmd('book',{patient_id:p1,provider_id:d1,service_id:s1,starts_at:'2030-01-03T10:00:00+02',performer_mode:'doctor',nurse_admin_id:N1});
  assert.equal((await one("select nurse_admin_id from clinic_reception.appointments where id=$1",[r.id])).nurse_admin_id,null);
  // reschedule into the nurse's other visit → refused; without keys the performer is kept
  await assert.rejects(()=>cmd('reschedule',{id:first,starts_at:'2030-01-02T10:40:00+02',performer_mode:'nurse_alone',nurse_admin_id:N1}),/زيارة تانية/);
  await cmd('reschedule',{id:first,starts_at:'2030-01-04T10:00:00+02'});assert.equal((await one("select nurse_admin_id from clinic_reception.appointments where id=$1",[first])).nurse_admin_id,N1);
  // a cancelled visit does not hold the nurse
  await q("update clinic_reception.appointments set status='cancelled' where id=$1",[first]);
  r=await cmd('book',{patient_id:p1,provider_id:d1,service_id:s1,starts_at:'2030-01-04T10:00:00+02',performer_mode:'nurse_alone',nurse_admin_id:N1});assert.ok(r.id);
  // constraint: nurse without nurse mode is impossible
  await assert.rejects(()=>q("update clinic_reception.appointments set nurse_admin_id=$1 where performer_mode='doctor'",[N1]),/appointments_performer_check/);
  // rollback restores the previous command
  await db.exec(fs.readFileSync(R,'utf8'));assert.equal((await one("select to_regprocedure('public.clinic_reception_nurses(uuid)') f")).f,null);
  await assert.rejects(()=>cmd('book',{patient_id:p1,provider_id:d1,service_id:s1,performer_mode:'nurse_alone',nurse_admin_id:N1}),/inner got extra keys/);
  console.log('PASS reception booking nurse performer');
 }catch(e){console.error('FAIL',e);process.exit(1);}})();
