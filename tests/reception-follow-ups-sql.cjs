// 20261121120000 «متابعة مطلوبة»: create / list (late, today, within 14 days) / attempt / postpone / close; a booking for the
// same patient + doctor near the due date links itself; access via clinic_reception.access.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
(async()=>{const db=new PGlite(),q=(s,p)=>db.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0];
 const W='00000000-0000-0000-0000-0000000000f1',A='00000000-0000-0000-0000-0000000000a1',PT='00000000-0000-0000-0000-0000000000c1',PR='00000000-0000-0000-0000-0000000000b1',PR2='00000000-0000-0000-0000-0000000000b2';
 try{await db.exec(`create role authenticated;create role anon;create schema clinic_reception;
  create table public.admins(id uuid primary key);insert into public.admins values('${A}');
  create table perm(action text);insert into perm values('view'),('execute');
  create function public.my_admin_id() returns uuid language sql as $$select '${A}'::uuid$$;
  create function clinic_reception.access(w uuid,a text) returns uuid language plpgsql as $$begin if not exists(select 1 from perm where action=a) then raise exception 'لا توجد صلاحية %',a;end if;return '${A}'::uuid;end$$;
  create table clinic_reception.workspaces(id uuid primary key);insert into clinic_reception.workspaces values('${W}');
  create table clinic_reception.patients(id uuid primary key,workspace_id uuid,name text,phone text,file_no text);insert into clinic_reception.patients values('${PT}','${W}','سارة تجريبية','01000000000','F1');
  create table clinic_reception.providers(id uuid primary key,workspace_id uuid,name text,active boolean default true);insert into clinic_reception.providers values('${PR}','${W}','د. باطنة تجريبي',true),('${PR2}','${W}','د. جلدية تجريبي',true);
  create table clinic_reception.services(id uuid primary key,workspace_id uuid,name text,active boolean default true);
  create table clinic_reception.appointments(id uuid primary key default gen_random_uuid(),workspace_id uuid,patient_id uuid,provider_id uuid,starts_at timestamptz,status text default 'booked');`);
  const M=fs.readFileSync('supabase/migrations/20261121120000_reception_follow_ups.sql','utf8');
  await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  const api=(a,p)=>one('select public.clinic_reception_follow_ups($1,$2,$3) r',[W,a,p]).then(r=>r.r);
  const today=(await api('list',{})).today;
  await assert.rejects(()=>api('create',{patient_id:PT,provider_id:PR}),/بعد النهارده/,'needs a due date');
  const f1=await api('create',{patient_id:PT,provider_id:PR,months:3,note:'إعادة تحليل سكر تراكمي'});
  assert.ok(f1.due_date>today);
  const f2=await api('create',{patient_id:PT,provider_id:PR2,weeks:1});
  await q("update clinic_reception.follow_ups set due_date=current_date-5 where id=$1",[f2.id]);   // simulate late
  let l=await api('list',{});assert.deepEqual(l.rows.map(r=>r.id),[f2.id],'due list = late + within 14 days');assert.equal(l.counts.late,1);
  assert.equal((await api('list',{scope:'all'})).rows.length,2);
  await api('attempt',{id:f2.id,note:'مردتش'});l=await api('list',{scope:'late'});assert.equal(l.rows[0].attempts,1);
  await assert.rejects(()=>api('postpone',{id:f2.id,due_date:'2020-01-01'}),/بعد النهارده/);
  await api('postpone',{id:f2.id,due_date:'2099-01-10'});assert.equal((await api('list',{scope:'late'})).rows.length,0);
  await assert.rejects(()=>api('close',{id:f2.id,reason:''}),/سبب/);
  await api('close',{id:f2.id,reason:'سافر بره'});await assert.rejects(()=>api('attempt',{id:f2.id}),/اتقفلت/);
  // booking far away from the due date does not link; near it links
  await q("insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,starts_at) values($1,$2,$3,now()+interval '2 days')",[W,PT,PR]);
  assert.equal((await one("select status from clinic_reception.follow_ups where id=$1",[f1.id])).status,'open','too early: stays open');
  const ap=await one("insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,starts_at) values($1,$2,$3,($4::date + 3)::timestamptz) returning id",[W,PT,PR,f1.due_date]);
  const fr=await one("select status,booked_appointment_id from clinic_reception.follow_ups where id=$1",[f1.id]);assert.equal(fr.status,'booked');assert.equal(fr.booked_appointment_id,ap.id);
  assert.equal((await api('list',{scope:'booked'})).rows.length,1);
  assert.deepEqual((await q("select kind from clinic_reception.follow_up_events order by id")).rows.map(r=>r.kind),['created','created','attempt','postponed','closed','booked']);
  // access: view only → can list, cannot change
  await q("delete from perm where action='execute'");await api('list',{});
  await assert.rejects(()=>api('create',{patient_id:PT,provider_id:PR,months:1}),/لا توجد صلاحية book/);
  await q("insert into perm values('book')");assert.ok((await api('create',{patient_id:PT,provider_id:PR,months:1})).id,'reception «book» can create');
  assert.equal((await one("select has_function_privilege('anon','public.clinic_reception_follow_ups(uuid,text,jsonb)','execute') x")).x,false);
  await db.exec(fs.readFileSync('supabase/rollbacks/20261121120000_reception_follow_ups.rollback.sql','utf8'));
  assert.equal((await one("select to_regclass('clinic_reception.follow_ups') x")).x,null);
  console.log('reception follow-ups: ok');
 }catch(e){console.error(e);process.exitCode=1;}finally{await db.close();}})();
