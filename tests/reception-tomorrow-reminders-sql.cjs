// 20261121160000 «تذكيرات بكرة»: list tomorrow's bookings (agent customer_bookings + Masa bookings, deduped by official id,
// day-only = no time, cancelled excluded), mark sent / no_answer / pending with counts + audit, bad ref + no access refused,
// rollback. Stub tables mirror the real columns (customer_bookings / masa_bookings: 20261118170000, day_only: 20261119020000,
// masa_doctor_links: 20261117140000). Sample data only.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
(async()=>{const db=new PGlite(),q=(s,p)=>db.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0];
 const W='00000000-0000-0000-0000-0000000000f1',W2='00000000-0000-0000-0000-0000000000f2',A='00000000-0000-0000-0000-0000000000a1',PR='00000000-0000-0000-0000-0000000000b1';
 const C1='00000000-0000-0000-0000-0000000000c1',C2='00000000-0000-0000-0000-0000000000c2',C3='00000000-0000-0000-0000-0000000000c3',C4='00000000-0000-0000-0000-0000000000c4';
 try{await db.exec(`create role authenticated;create role anon;create schema clinic_reception;
  create table public.admins(id uuid primary key,name text);insert into public.admins values('${A}','دينا تجريبية');
  create table perm(action text);insert into perm values('book');
  create function clinic_reception.access(w uuid,a text) returns uuid language plpgsql as $$begin if not exists(select 1 from perm where action=a) then raise exception 'لا توجد صلاحية %',a;end if;return '${A}'::uuid;end$$;
  create table clinic_reception.workspaces(id uuid primary key);insert into clinic_reception.workspaces values('${W}'),('${W2}');
  create table clinic_reception.audit(id bigint generated always as identity primary key,workspace_id uuid not null references clinic_reception.workspaces(id),actor_id uuid not null references public.admins(id),action text not null,entity_id uuid,created_at timestamptz not null default now(),detail jsonb);
  create table clinic_reception.providers(id uuid primary key,workspace_id uuid,name text,active boolean default true);insert into clinic_reception.providers values('${PR}','${W}','د. جلدية تجريبي',true);
  create table clinic_reception.masa_doctor_links(masa_doctor_id int primary key,workspace_id uuid not null,provider_id uuid,masa_name text not null,status text not null default 'pending');
  insert into clinic_reception.masa_doctor_links values(1130,'${W}','${PR}','Dr Derm','linked'),(1200,'${W}',null,'د. باطنة تجريبي','pending');
  create table public.customer_bookings(id uuid primary key default gen_random_uuid(),booking_request_id text not null unique,official_booking_id text,booking_reference text,
   channel text not null default 'whatsapp',customer_name text,phone text,specialty_name text,doctor_name text,appointment_date date,appointment_time text,status text not null default 'confirmed');
  create table clinic_reception.masa_bookings(official_booking_id text primary key,workspace_id uuid not null,masa_doctor_id int not null references clinic_reception.masa_doctor_links(masa_doctor_id),
   provider_id uuid,starts_at timestamptz not null,ends_at timestamptz not null,status text not null default 'active',needed_service text,patient_name text,phone text,day_only boolean not null default false);`);
  const M=fs.readFileSync('supabase/migrations/20261121160000_reception_tomorrow_reminders.sql','utf8');
  await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  const day=(await one("select ((now() at time zone 'Africa/Cairo')::date + 1)::text d")).d;
  const cairo=t=>`(('${day} ${t}')::timestamp at time zone 'Africa/Cairo')`;
  await q(`insert into public.customer_bookings(id,booking_request_id,official_booking_id,booking_reference,customer_name,phone,specialty_name,doctor_name,appointment_date,appointment_time,status) values
   ('${C1}','R1','M-1','BK-1','يوسف تجريبي','01000000000','كشف أطفال','د. أطفال تجريبي','${day}','12:30','confirmed'),
   ('${C2}','R2',null,null,'هالة تجريبية','01000000000','استشارة','د. أطفال تجريبي','${day}','09:00','rescheduled'),
   ('${C3}','R3',null,'BK-3','ملغي تجريبي','01000000000','كشف','د. أطفال تجريبي','${day}','11:00','cancelled'),
   ('${C4}','R4',null,'BK-4','بعده تجريبي','01000000000','كشف','د. أطفال تجريبي','${day}'::date+1,'11:00','confirmed')`);
  await q(`insert into clinic_reception.masa_bookings(official_booking_id,workspace_id,masa_doctor_id,provider_id,starts_at,ends_at,status,needed_service,patient_name,phone,day_only) values
   ('M-1','${W}',1130,null,${cairo('12:30')},${cairo('12:50')},'active','كشف','يوسف تجريبي','01000000000',false),
   ('M-2','${W}',1130,null,${cairo('10:00')},${cairo('10:20')},'active','كشف جديد','سارة تجريبية','01000000000',false),
   ('M-3','${W}',1200,null,${cairo('00:00')},${cairo('00:20')},'active','استشارة','محمود تجريبي','01000000000',true),
   ('M-4','${W}',1130,null,${cairo('13:00')},${cairo('13:20')},'cancelled','كشف','ملغي ماسا','01000000000',false),
   ('M-5','${W2}',1130,null,${cairo('13:00')},${cairo('13:20')},'active','كشف','فرع تاني','01000000000',false)`);
  const api=(a,p,w)=>one('select public.clinic_reception_reminders($1,$2,$3) r',[w||W,a,p]).then(r=>r.r);
  let l=await api('list',{});
  assert.equal(l.day,day,'defaults to tomorrow (Cairo)');
  assert.deepEqual(l.rows.map(r=>r.ref),['cb:'+C2,'masa:M-2','cb:'+C1,'masa:M-3'],'both sources, dedupe by official id, cancelled / other day / other workspace out, time order nulls last');
  const m2=l.rows[1];assert.equal(m2.time,'10:00');assert.equal(m2.doctor,'د. جلدية تجريبي','provider name via link');assert.equal(m2.source,'masa');assert.equal(m2.booking_ref,'M-2');assert.equal(m2.service,'كشف جديد');
  const m3=l.rows[3];assert.equal(m3.time,null,'day only = no time');assert.equal(m3.day_only,true);assert.equal(m3.doctor,'د. باطنة تجريبي','masa_name when not linked');
  const c1=l.rows[2];assert.equal(c1.source,'whatsapp');assert.equal(c1.booking_ref,'BK-1');assert.equal(c1.name,'يوسف تجريبي');assert.equal(c1.status,'pending');
  assert.deepEqual(l.counts,{pending:4,sent:0,no_answer:0,all:4});
  // mark
  await api('mark',{ref:'cb:'+C1,day,status:'sent'});
  await api('mark',{ref:'masa:M-3',day,status:'no_answer',note:'الرقم مقفول'});
  l=await api('list',{day});
  const s=l.rows.find(r=>r.ref==='cb:'+C1);assert.equal(s.status,'sent');assert.equal(s.marked_by_name,'دينا تجريبية');assert.match(s.marked_time,/^\d\d:\d\d$/);assert.ok(s.marked_at);
  assert.equal(l.rows.find(r=>r.ref==='masa:M-3').note,'الرقم مقفول');
  assert.deepEqual(l.counts,{pending:2,sent:1,no_answer:1,all:4});
  await api('mark',{ref:'masa:M-3',day,status:'sent'});assert.deepEqual((await api('list',{day})).counts,{pending:2,sent:2,no_answer:0,all:4},'upsert');
  await api('mark',{ref:'masa:M-3',day,status:'pending'});assert.deepEqual((await api('list',{day})).counts,{pending:3,sent:1,no_answer:0,all:4},'pending = undo');
  assert.equal((await one("select count(*)::int n from clinic_reception.booking_reminders")).n,1);
  assert.deepEqual((await q("select action,detail->>'ref' ref from clinic_reception.audit order by id")).rows.map(r=>r.action),['reminder_sent','reminder_no_answer','reminder_sent','reminder_pending']);
  // refused
  await assert.rejects(()=>api('mark',{ref:'x:1',day,status:'sent'}),/الحجز غير معروف/);
  await assert.rejects(()=>api('mark',{ref:"cb:'; drop table x",day,status:'sent'}),/مش موجود/);
  await assert.rejects(()=>api('mark',{ref:'cb:'+C1,day,status:'done'}),/حالة التذكير/);
  await assert.rejects(()=>api('mark',{ref:'masa:M-5',day,status:'sent'}),/مش موجود/,'other workspace booking');
  await assert.rejects(()=>api('nope',{}),/إجراء غير معروف/);
  await q("delete from perm");await assert.rejects(()=>api('list',{}),/لا توجد صلاحية book/);await assert.rejects(()=>api('mark',{ref:'cb:'+C2,day,status:'sent'}),/لا توجد صلاحية book/);
  assert.equal((await one("select has_function_privilege('anon','public.clinic_reception_reminders(uuid,text,jsonb)','execute') x")).x,false);
  assert.equal((await one("select has_function_privilege('authenticated','public.clinic_reception_reminders(uuid,text,jsonb)','execute') x")).x,true);
  assert.equal((await one("select has_table_privilege('authenticated','clinic_reception.booking_reminders','select') x")).x,false);
  assert.equal((await one("select relrowsecurity x from pg_class where oid='clinic_reception.booking_reminders'::regclass")).x,true);
  await db.exec(fs.readFileSync('supabase/rollbacks/20261121160000_reception_tomorrow_reminders.rollback.sql','utf8'));
  assert.equal((await one("select to_regclass('clinic_reception.booking_reminders') x")).x,null);
  assert.equal((await one("select to_regprocedure('public.clinic_reception_reminders(uuid,text,jsonb)') x")).x,null);
  console.log('reception tomorrow reminders: ok');
 }catch(e){console.error(e);process.exitCode=1;}finally{await db.close();}})();
