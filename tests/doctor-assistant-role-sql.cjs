// 20261120290000: role «مساعد طبيب» (doctor_assistant): accepted by both role checks (live list kept), gets nursing parity
// in reception functions only (archive/nurse-list untouched), my_departments helper, rollback restores everything.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
(async()=>{const db=new PGlite(),q=(s,p)=>db.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0];
 try{await db.exec(`create role authenticated;create role anon;create schema clinic_reception;create schema clinic_people;
  create table public.admins(id uuid primary key,role text not null,active boolean default true,constraint admins_role_check check(role in ('reception','nursing','head_nursing','super_admin','some_live_only_role')));
  create table public.admin_extra_roles(admin_id uuid,role text,constraint admin_extra_roles_role_check check(role in ('reception','nursing','head_nursing')));
  create table cur(id uuid);insert into cur values(null);
  create function public.my_admin_id() returns uuid language sql as $$select id from cur$$;
  create function public.has_role(r text) returns boolean language sql as $$select exists(select 1 from public.admins a where a.id=public.my_admin_id() and a.role=r) or exists(select 1 from public.admin_extra_roles x where x.admin_id=public.my_admin_id() and x.role=r)$$;
  create function clinic_reception.access_x(p text) returns boolean language plpgsql as $$begin return case when p='view' then public.has_role('nursing') or public.has_role('head_nursing') else public.has_role('reception') end;end$$;
  create function public.clinic_reception_journey_x() returns boolean language sql as $$select public.has_role('nursing')$$;
  create function public.clinic_reception_nursing_mgr() returns boolean language sql as $$select public.has_role('super_admin') or public.has_role('head_nursing')$$;
  create function public.has_archive_review_access() returns boolean language sql as $$select public.has_role('head_nursing')$$;
  create function public.clinic_reception_nurses() returns setof uuid language sql as $$select id from public.admins where role in ('nursing','head_nursing')$$;
  create table clinic_people.people(id uuid default gen_random_uuid(),admin_id uuid,code text);
  create table clinic_reception.providers(id uuid primary key,workspace_id uuid,doctor_key text,department text,active boolean default true);
  create table clinic_reception.provider_service_scopes(provider_id uuid,service_code text);
  create table clinic_reception.services(workspace_id uuid,code text,department text,active boolean default true);`);
  const A='00000000-0000-0000-0000-0000000000a1',W='00000000-0000-0000-0000-0000000000f1',P='00000000-0000-0000-0000-0000000000b1';
  await assert.rejects(()=>q("insert into public.admins values($1,'doctor_assistant')",[A]),/admins_role_check/);
  const M=fs.readFileSync('supabase/migrations/20261120290000_doctor_assistant_role.sql','utf8');
  await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  await q("insert into public.admins values($1,'doctor_assistant')",[A]);await q("insert into public.admins values(gen_random_uuid(),'some_live_only_role')");
  await q("insert into public.admin_extra_roles values($1,'doctor_assistant')",[A]);
  await q("update cur set id=$1",[A]);
  assert.equal((await one("select clinic_reception.access_x('view') x")).x,true,'today-ops view like nursing');
  assert.equal((await one("select clinic_reception.access_x('book') x")).x,false,'no booking');
  assert.equal((await one("select public.clinic_reception_journey_x() x")).x,true);
  assert.equal((await one("select public.has_archive_review_access() x")).x,false,'archive review untouched');
  assert.equal((await one("select public.clinic_reception_nursing_mgr() x")).x,false,'no head-nursing manager powers');
  assert.equal((await one("select count(*)::int n from public.clinic_reception_nurses() x where x=$1",[A])).n,0,'not a nurse');
  // departments
  await q("insert into clinic_people.people(admin_id,code) values($1,'EMP-000005')",[A]);
  await q("insert into clinic_reception.providers values($1,$2,'EMP-000005','التمريض المنزلي',true)",[P,W]);
  await q("insert into clinic_reception.services values($1,'0000698','الطوارئ',true),($1,'0000011','الاشعة',true),($1,'P1','العلاج الطبيعي',false)",[W]);
  await q("insert into clinic_reception.provider_service_scopes values($1,'0000698'),($1,'0000011'),($1,'P1')",[P]);
  assert.deepEqual((await one("select public.clinic_reception_my_departments($1) d",[W])).d,['الاشعة','التمريض المنزلي','الطوارئ']);
  assert.deepEqual((await one("select public.clinic_reception_my_departments(gen_random_uuid()) d")).d,[]);
  // rollback (after the role is switched back)
  await q("delete from public.admin_extra_roles where role='doctor_assistant'");await q("update public.admins set role='nursing' where role='doctor_assistant'");
  await db.exec(fs.readFileSync('supabase/rollbacks/20261120290000_doctor_assistant_role.rollback.sql','utf8'));
  await assert.rejects(()=>q("insert into public.admins values(gen_random_uuid(),'doctor_assistant')"),/admins_role_check/);
  await q("insert into public.admins values(gen_random_uuid(),'some_live_only_role')");
  await q("insert into public.admin_extra_roles values($1,'doctor_assistant')",[A]).then(()=>assert.fail('extra check restored'),e=>assert.match(e.message,/admin_extra_roles_role_check/));
  assert.ok(!(await one("select prosrc from pg_proc where proname='access_x'")).prosrc.includes('doctor_assistant'));
  console.log('doctor assistant role: ok');
 }catch(e){console.error(e);process.exitCode=1;}finally{await db.close();}})();
