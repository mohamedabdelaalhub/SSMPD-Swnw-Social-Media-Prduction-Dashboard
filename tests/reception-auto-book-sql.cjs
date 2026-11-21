// Owner 2026-11-19: automatic bookings phase 1 (Masa / WhatsApp / portal -> reception appointments).
// Self-contained PGlite schema: a minimal reception command chain stands in for the live one (book, reschedule, cancel,
// patient_attach), with the same identity source (auth.uid() from request.jwt claims) so the system account path is tested.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite'),{randomUUID}=require('crypto');
(async()=>{const db=new PGlite(),id=()=>randomUUID();
 const sysU=id(),sysA=id(),staffU=id(),staffA=id(),ws=id(),prov=id(),prov2=id(),svc=id(),svc2=id(),old=id();
 const q=(s,p)=>db.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0];
 const as=async u=>{await db.exec(`select set_config('request.jwt.claims','${JSON.stringify({sub:u,role:'authenticated'})}',false),set_config('request.jwt.claim.sub','${u}',false)`);};
 try{await db.exec(`create role authenticated;create role anon;create role service_role;create schema auth;create schema clinic_reception;create schema psychcare;
 create function auth.uid() returns uuid language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub'))::uuid$$;
 create table admins(id uuid primary key,user_id uuid,name text,role text,active boolean default true);
 create function my_admin_id() returns uuid language sql stable security definer as $$select id from admins where user_id=auth.uid() and active limit 1$$;
 create table patients(id uuid primary key default gen_random_uuid(),patient_code text default 'P-'||floor(random()*1e6)::text,full_name text,phone text,phone_normalized text,age int,status text default 'active',created_by uuid,last_visit_date date,created_at timestamptz default now());
 create function psychcare.phone(v text) returns text language sql immutable set search_path=pg_catalog as $$select case when x ~ '^01[0125][0-9]{8}$' then '20'||substring(x from 2) when x ~ '^1[0125][0-9]{8}$' then '20'||x else regexp_replace(x,'^00','') end from(select regexp_replace(translate(coalesce(v,''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g') x)s$$;
 create function psychcare.name(v text) returns text language sql immutable set search_path=pg_catalog as $$select lower(regexp_replace(translate(trim(coalesce(v,'')),'أإآى','اااي'),'[[:space:]]+',' ','g'))$$;
 create function psychcare.check_basics(n text,p text,a integer) returns void language plpgsql set search_path=pg_catalog,public as $$begin
  if trim(coalesce(n,'')) !~ '^[[:alpha:]][[:alpha:] .-]*[[:space:]]+[[:alpha:]][[:alpha:] .-]*$' then raise exception 'اسم المريض مطلوب من كلمتين على الأقل';end if;
  if psychcare.phone(p)!~'^[0-9]{8,15}$' then raise exception 'رقم تليفون المريض مطلوب';end if;
  if a is null or a<0 or a>130 then raise exception 'سن المريض مطلوب من صفر إلى 130 سنة';end if;end $$;
 create table clinic_reception.workspaces(id uuid primary key,mode text);
 create table clinic_reception.providers(id uuid primary key,workspace_id uuid,name text,department text,active boolean default true);
 create table clinic_reception.services(id uuid primary key,workspace_id uuid,code text,name text,department text,minutes int default 20,active boolean default true);
 create table clinic_reception.patients(id uuid primary key default gen_random_uuid(),workspace_id uuid,patient_id uuid,file_no text,name text,phone text,created_by uuid,unique(workspace_id,patient_id));
 create table clinic_reception.appointments(id uuid primary key default gen_random_uuid(),workspace_id uuid,patient_id uuid,provider_id uuid,service_id uuid,starts_at timestamptz,ends_at timestamptz,status text default 'booked',source text,created_by uuid,cancel_reason text);
 create table clinic_reception.audit(id serial,workspace_id uuid,actor_id uuid,action text,entity_id uuid,detail jsonb);
 create table clinic_reception.fallback_sync_state(key text primary key,synced_at timestamptz);
 create table clinic_reception.masa_doctor_links(masa_doctor_id int primary key,workspace_id uuid,provider_id uuid,status text);
 create table clinic_reception.masa_bookings(official_booking_id text primary key,workspace_id uuid,masa_doctor_id int,provider_id uuid,starts_at timestamptz,ends_at timestamptz,status text default 'active',needed_service text,patient_name text,phone text,day_only boolean default false);
 create table clinic_reception.fallback_bookings(id uuid primary key default gen_random_uuid(),workspace_id uuid,booking_request_id text unique,source text,masa_doctor_id int,provider_id uuid,starts_at timestamptz,ends_at timestamptz,customer_name text,phone text,customer_age int,needed_service text,status text default 'pending',official_booking_id text,slot_released_at timestamptz,slot_released_by uuid);
 create table customer_bookings(id uuid primary key default gen_random_uuid(),booking_request_id text unique,official_booking_id text,channel text default 'whatsapp',customer_name text,phone text,masa_doctor_id int,appointment_date date,appointment_time text,status text default 'confirmed',updated_at timestamptz default now());
 create function clinic_reception.access(p_workspace uuid,p_action text) returns uuid language plpgsql security definer as $$begin if my_admin_id() is null then raise exception 'سجل الدخول';end if;return my_admin_id();end $$;
 -- stand-in for the live command chain: identity from auth.uid(), overlap refusal, the same actions the engine uses
 create function clinic_reception_command(p_workspace uuid,p_action text,p_payload jsonb,p_token uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
 declare me uuid:=clinic_reception.access(p_workspace,'book');v uuid;t timestamptz;e timestamptz;person patients%rowtype;begin
  if p_action='patient_attach' then select * into person from patients where id=(p_payload->>'patient_id')::uuid and status='active';if not found then raise exception 'ملف المريض غير متاح';end if;
   insert into clinic_reception.patients(workspace_id,patient_id,file_no,name,phone,created_by) values(p_workspace,person.id,person.patient_code,person.full_name,person.phone,me) on conflict(workspace_id,patient_id) do update set name=excluded.name returning id into v;
  elsif p_action in ('book','reschedule') then t:=(p_payload->>'starts_at')::timestamptz;e:=t+make_interval(mins=>coalesce((p_payload->>'minutes')::int,(select minutes from clinic_reception.services where id=(p_payload->>'service_id')::uuid)));
   if exists(select 1 from clinic_reception.appointments a where a.provider_id=(p_payload->>'provider_id')::uuid and a.status not in ('cancelled','no_show') and a.starts_at<e and a.ends_at>t and a.id is distinct from nullif(p_payload->>'id','')::uuid) then raise exception 'الميعاد محجوز';end if;
   if p_action='book' then insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at,source,created_by) values(p_workspace,(p_payload->>'patient_id')::uuid,(p_payload->>'provider_id')::uuid,(p_payload->>'service_id')::uuid,t,e,p_payload->>'source',me) returning id into v;
   else update clinic_reception.appointments set starts_at=t,ends_at=e,provider_id=(p_payload->>'provider_id')::uuid where id=(p_payload->>'id')::uuid returning id into v;end if;
  elsif p_action='cancel' then update clinic_reception.appointments set status='cancelled',cancel_reason=p_payload->>'reason' where id=(p_payload->>'id')::uuid and status='booked' returning id into v;if v is null then raise exception 'الحجز غير متاح';end if;
  else raise exception 'unknown';end if;return jsonb_build_object('id',v);end $$;
 create table clinic_reception.agent_booking_links(customer_booking_id uuid primary key references customer_bookings(id),workspace_id uuid,appointment_id uuid unique,linked_by uuid,linked_at timestamptz default now());
 create table clinic_reception.queue_entries(appointment_id uuid primary key,ticket_no int);
 create table journey_calls(action text,appointment_id uuid);
 create function clinic_reception_journey_command(p_workspace uuid,p_action text,p_payload jsonb,p_token uuid) returns jsonb language plpgsql security definer as $$begin
  insert into journey_calls values(p_action,(p_payload->>'appointment_id')::uuid);
  if p_action='arrive' then update clinic_reception.appointments set status='arrived' where id=(p_payload->>'appointment_id')::uuid;insert into clinic_reception.queue_entries values((p_payload->>'appointment_id')::uuid,7);end if;
  return jsonb_build_object('token','tok-1');end $$;
 -- stand-in for the queue RPC as left by 20261120120000 (its own register path books a walk-in)
 create function clinic_reception_queue(p_workspace uuid,p_action text,p_payload jsonb default '{}') returns jsonb language plpgsql security definer as $$begin
  return jsonb_build_object('inner',p_action);end $$;`);
 await q("insert into admins(id,user_id,name,role) values($1,$2,'الحجز التلقائي','reception'),($3,$4,'موظفة استقبال','reception')",[sysA,sysU,staffA,staffU]);
 await q("insert into clinic_reception.workspaces values($1,'live')",[ws]);
 await q("insert into clinic_reception.providers values($1,$3,'أخصائي جلدية','جلدية',true),($2,$3,'أخصائي أسنان','أسنان',true)",[prov,prov2,ws]);
 await q("insert into clinic_reception.services values($1,$3,'DERM','كشف جلدية','جلدية',20,true),($2,$3,'DENT1','حشو','أسنان',30,true)",[svc,svc2,ws]);
 await q("insert into clinic_reception.masa_doctor_links values(1130,$1,$2,'linked'),(1200,$1,$3,'linked'),(1300,$1,null,'pending')",[ws,prov,prov2]);
 await q("insert into patients(id,patient_code,full_name,phone,age) values($1,'P-2026-000188','أحمد محمود تجريبي','01012345637',40)",[old]);
 const tomorrow=(await one("select ((now() at time zone 'Africa/Cairo')::date+1)::text d")).d,at=h=>tomorrow+'T'+h+':00+02:00';
 // past booking queued before the migration (backfill must skip past days)
 await q("insert into clinic_reception.masa_bookings values('M0',$1,1130,$2,$3,$4,'active','كشف','مريض قديم جدا','01000000000',false)",[ws,prov,'2020-01-01T10:00:00+02:00','2020-01-01T10:20:00+02:00']);
 await q("insert into clinic_reception.masa_bookings values('M1',$1,1130,$2,$3,$4,'active','كشف','أحمد محمود تجريبي','01012345637',false)",[ws,prov,at('16:00'),at('16:20')]);
 const M=fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(x=>x.includes('_reception_auto_book.sql')),'utf8');
 await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
 assert.equal((await one("select count(*)::int n from clinic_reception.external_bookings")).n,1,'backfill: today and later only');
 // disabled: nothing is booked
 assert.equal((await one("select clinic_reception.auto_book_run() r")).r.enabled,false);
 await q("update clinic_reception.auto_book_settings set enabled=true,workspace_id=$1,system_admin_id=$2,portal_auto_confirm=true",[ws,sysA]);
 // 1) Masa booking, existing patient by phone+name -> booked as the system account, linked to the file
 let r=(await one("select clinic_reception.auto_book_run() r")).r;assert.equal(r.booked,1,JSON.stringify(r));
 let e=await one("select * from clinic_reception.external_bookings where external_id='M1'");
 assert.equal(e.state,'booked');assert.equal(e.public_patient_id,old);assert.equal(e.patient_created,false);
 let a=await one("select * from clinic_reception.appointments where id=$1",[e.appointment_id]);assert.equal(a.created_by,sysA);assert.equal(a.service_id,svc);
 assert.equal(new Date(a.ends_at)-new Date(a.starts_at),20*60000);
 assert.equal((await one("select current_setting('request.jwt.claim.sub',true) s")).s||'','', 'system identity does not leak');
 // run again: idempotent
 r=(await one("select clinic_reception.auto_book_run() r")).r;assert.equal((await one("select count(*)::int n from clinic_reception.appointments")).n,1);
 // 2) same phone, different name -> review with the candidate; staff picks «new file» with an age
 await q("insert into clinic_reception.masa_bookings values('M2',$1,1130,$2,$3,$4,'active','كشف','يوسف أحمد تجريبي','01012345637',false)",[ws,prov,at('17:20'),at('17:40')]);
 await one("select clinic_reception.auto_book_run()");e=await one("select * from clinic_reception.external_bookings where external_id='M2'");
 assert.equal(e.state,'review');assert.equal(e.review_kind,'patient');assert.equal(e.candidate_patient_id,old);
 await as(staffU);
 const lst=(await one("select clinic_reception_auto_book($1,'list','{}') r",[ws])).r;
 assert.ok(!('needed_service' in lst.rows[0]),'before the migration list has no needed_service');
 assert.ok(lst.rows.some(x=>x.id===e.id&&x.candidate&&x.candidate.patient_code==='P-2026-000188'),'list shows the candidate');
 await assert.rejects(()=>q("select clinic_reception_auto_book($1,'resolve_patient',$2)",[ws,{id:e.id,choice:'new'}]),/سن المريض مطلوب/);
 r=(await one("select clinic_reception_auto_book($1,'resolve_patient',$2) r",[ws,{id:e.id,choice:'new',age:9}])).r;assert.equal(r.state,'booked');
 e=await one("select * from clinic_reception.external_bookings where external_id='M2'");assert.equal(e.patient_created,true);assert.notEqual(e.public_patient_id,old);
 a=await one("select * from clinic_reception.appointments where id=$1",[e.appointment_id]);assert.equal(a.created_by,staffA,'resolution books as the staff member');
 await as('');
 // 3) brand-new phone without age -> review age; WhatsApp fallback with age -> new file + hold released + booked
 await q("insert into clinic_reception.masa_bookings values('M3',$1,1130,$2,$3,$4,'active','كشف','مريضة جديدة تجريبية','01198765432',false)",[ws,prov,at('18:00'),at('18:20')]);
 await q("insert into clinic_reception.fallback_bookings(booking_request_id,source,masa_doctor_id,provider_id,starts_at,ends_at,customer_name,phone,customer_age) values('BR1','whatsapp',1130,$1,$2,$3,'سارة علي تجريبية','01222222222',31)",[prov,at('19:00'),at('19:20')]);
 await one("select clinic_reception.auto_book_run()");
 assert.equal((await one("select review_kind from clinic_reception.external_bookings where external_id='M3'")).review_kind,'age');
 // owner (queue 4b): live patient files are never created from agent data -> staff review even with an age
 e=await one("select * from clinic_reception.external_bookings where external_id='BR1'");assert.equal(e.review_kind,'age');assert.match(e.reason,/الواتساب/);
 assert.equal((await one("select slot_released_at from clinic_reception.fallback_bookings where booking_request_id='BR1'")).slot_released_at,null,'hold kept until booked');
 // the agent mirror of the same booking (same BookingRequestId) is the same row, not a second appointment
 await q("insert into customer_bookings(booking_request_id,official_booking_id,customer_name,phone,masa_doctor_id,appointment_date,appointment_time) values('BR1','9001','سارة علي تجريبية','01222222222',1130,$1,'19:00')",[tomorrow]);
 await one("select clinic_reception.auto_book_run()");
 assert.equal((await one("select count(*)::int n from clinic_reception.external_bookings where external_id='BR1'")).n,1);
 await as(staffU);r=(await one("select clinic_reception_auto_book($1,'resolve_patient',$2) r",[ws,{id:e.id,choice:'new',age:31}])).r;assert.equal(r.state,'booked');await as('');
 e=await one("select * from clinic_reception.external_bookings where external_id='BR1'");assert.equal(e.patient_created,true);
 assert.ok((await one("select slot_released_at from clinic_reception.fallback_bookings where booking_request_id='BR1'")).slot_released_at);
 assert.equal((await one("select source from clinic_reception.appointments where id=$1",[e.appointment_id])).source,'whatsapp');
 const cbBR1=(await one("select id from customer_bookings where booking_request_id='BR1'")).id;
 assert.equal((await one("select appointment_id from clinic_reception.agent_booking_links where customer_booking_id=$1",[cbBR1])).appointment_id,e.appointment_id,'linked for the queue');
 // queue «تسجيل الوصول» on that booking arrives the booked appointment (no second walk-in); other actions pass through
 await as(staffU);
 r=(await one("select clinic_reception_queue($1,'agent_booking_register',$2) r",[ws,{booking_id:cbBR1,patient_id:e.public_patient_id,service_id:svc}])).r;
 assert.equal(r.appointment_id,e.appointment_id);assert.equal(r.token,'tok-1');assert.equal(r.ticket_no,7);
 assert.equal((await one("select status from clinic_reception.appointments where id=$1",[e.appointment_id])).status,'arrived');
 await assert.rejects(()=>q("select clinic_reception_queue($1,'agent_booking_register',$2)",[ws,{booking_id:cbBR1,patient_id:old}]).then(()=>{throw new Error('x');}),/x/,'already arrived -> passes through');
 assert.equal((await one("select clinic_reception_queue($1,'list',$2) r",[ws,{}])).r.inner,'list');
 await as('');
 assert.equal((await one("select count(*)::int n from clinic_reception.appointments where status in ('booked','arrived')")).n,3);
 // a Masa import of that official id is not queued twice
 await q("insert into clinic_reception.masa_bookings values('9001',$1,1130,$2,$3,$4,'active','كشف','سارة علي تجريبية','01222222222',false)",[ws,prov,at('19:00'),at('19:20')]);
 assert.equal((await one("select count(*)::int n from clinic_reception.external_bookings where official_booking_id='9001'")).n,1);
 // 4) staff already booked the patient that day -> merged, not booked twice
 const rp=(await one("select id from clinic_reception.patients where patient_id=$1",[old])).id;
 await q("insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at,created_by) values($1,$2,$3,$4,$5,$6,$7)",[ws,rp,prov2,svc2,at('12:00'),at('12:30'),staffA]);
 await q("insert into clinic_reception.masa_bookings values('M4',$1,1200,$2,$3,$4,'active','حشو','أحمد محمود تجريبي','01012345637',false)",[ws,prov2,at('12:00'),at('12:30')]);
 await one("select clinic_reception.auto_book_run()");assert.equal((await one("select state from clinic_reception.external_bookings where external_id='M4'")).state,'merged');
 // 5) day-only -> needs_time; staff sets the time -> booked
 await q("insert into patients(full_name,phone,age) values('منى سمير تجريبية','01555555555',25)");
 await q("insert into clinic_reception.masa_bookings values('M5',$1,1130,$2,$3,$4,'active','كشف','منى سمير تجريبية','01555555555',true)",[ws,prov,tomorrow+'T00:00:00+02:00',tomorrow+'T00:20:00+02:00']);
 await one("select clinic_reception.auto_book_run()");e=await one("select * from clinic_reception.external_bookings where external_id='M5'");assert.equal(e.state,'needs_time');
 await as(staffU);await assert.rejects(()=>q("select clinic_reception_auto_book($1,'set_time',$2)",[ws,{id:e.id,starts_at:'2020-01-01T10:00:00+02:00'}]),/نفس يوم/);
 r=(await one("select clinic_reception_auto_book($1,'set_time',$2) r",[ws,{id:e.id,starts_at:at('20:00')}])).r;assert.equal(r.state,'booked');await as('');
 // 6) no default service for the doctor -> review service; staff picks once, it is remembered
 await q("update clinic_reception.services set name='جلسة' where id=$1",[svc]);
 await q("insert into patients(full_name,phone,age) values('كريم عادل تجريبي','01566666666',33),('هالة فؤاد تجريبية','01577777777',41)");
 await q("insert into clinic_reception.masa_bookings values('M6',$1,1130,$2,$3,$4,'active','كشف','كريم عادل تجريبي','01566666666',false)",[ws,prov,at('21:00'),at('21:20')]);
 await one("select clinic_reception.auto_book_run()");e=await one("select * from clinic_reception.external_bookings where external_id='M6'");assert.equal(e.review_kind,'service');
 await as(staffU);r=(await one("select clinic_reception_auto_book($1,'set_service',$2) r",[ws,{id:e.id,service_id:svc}])).r;assert.equal(r.state,'booked');await as('');
 assert.equal((await one("select service_code from clinic_reception.auto_book_services where provider_id=$1",[prov])).service_code,'DERM');
 // 7) slot taken -> review slot with the reason; doctor not linked -> review doctor
 await q("insert into clinic_reception.masa_bookings values('M7',$1,1130,$2,$3,$4,'active','كشف','هالة فؤاد تجريبية','01577777777',false)",[ws,prov,at('16:10'),at('16:30')]);
 await q("insert into clinic_reception.masa_bookings values('M8',$1,1300,null,$2,$3,'active','كشف','أحمد محمود تجريبي','01012345637',false)",[ws,at('15:00'),at('15:20')]);
 await one("select clinic_reception.auto_book_run()");
 e=await one("select * from clinic_reception.external_bookings where external_id='M7'");assert.equal(e.review_kind,'slot');assert.match(e.reason,/الميعاد محجوز/);
 assert.equal((await one("select review_kind from clinic_reception.external_bookings where external_id='M8'")).review_kind,'doctor');
 // 8) Masa moves a booking -> rescheduled; Masa cancels -> cancelled here too
 await q("update clinic_reception.masa_bookings set starts_at=$1,ends_at=$2 where official_booking_id='M1'",[at('22:00'),at('22:20')]);
 await one("select clinic_reception.auto_book_run()");e=await one("select * from clinic_reception.external_bookings where external_id='M1'");
 assert.equal(e.state,'booked');assert.equal(new Date((await one("select starts_at from clinic_reception.appointments where id=$1",[e.appointment_id])).starts_at).toISOString(),new Date(at('22:00')).toISOString());
 await q("update clinic_reception.masa_bookings set status='cancelled' where official_booking_id='M1'");
 await one("select clinic_reception.auto_book_run()");
 assert.equal((await one("select status from clinic_reception.appointments where id=$1",[e.appointment_id])).status,'cancelled');
 assert.equal((await one("select state from clinic_reception.external_bookings where external_id='M1'")).state,'cancelled');
 // 9) a broken source row never blocks the source write
 await q("insert into customer_bookings(booking_request_id,customer_name,phone,masa_doctor_id,appointment_date,appointment_time) values('BAD','x','1',1130,$1,'99:99')",[tomorrow]);
 // 10) portal: service role only; verified patient; same official id from Masa is merged onto one row
 await assert.rejects(()=>q("select clinic_reception_auto_book_service_api('config')"),/service role only/);
 await db.exec(`select set_config('request.jwt.claims','{"role":"service_role"}',false)`);
 assert.equal((await one("select clinic_reception_auto_book_service_api('config') r")).r.portal_auto_confirm,true);
 const pr=id();r=(await one("select clinic_reception_auto_book_service_api('portal_confirmed',$1) r",[{request_id:pr,official_booking_id:'7777',masa_doctor_id:1130,date:tomorrow,time:'23:00',patient_id:old}])).r;assert.ok(r.id);
 await as('');await one("select clinic_reception.auto_book_run()");
 e=await one("select * from clinic_reception.external_bookings where external_id=$1",[pr]);assert.equal(e.state,'booked');assert.equal(e.public_patient_id,old);
 await q("insert into clinic_reception.masa_bookings values('7777',$1,1130,$2,$3,$4,'active','كشف','اسم مختلف','01000000001',false)",[ws,prov,at('23:00'),at('23:20')]);
 assert.equal((await one("select count(*)::int n from clinic_reception.external_bookings where official_booking_id='7777'")).n,1);
 // 11) dismiss needs a reason; client roles cannot touch the tables directly
 await as(staffU);e=await one("select id from clinic_reception.external_bookings where external_id='M3'");
 await assert.rejects(()=>q("select clinic_reception_auto_book($1,'dismiss',$2)",[ws,{id:e.id}]),/اكتب السبب/);
 assert.equal((await one("select clinic_reception_auto_book($1,'dismiss',$2) r",[ws,{id:e.id,reason:'المريض لغى بالتليفون'}])).r.state,'skipped');
 await as('');assert.equal((await one("select has_table_privilege('authenticated','clinic_reception.external_bookings','select') x")).x,false);
 // owner «٢ أ» (20261120150000): one file on the phone + same first two names -> linked; different first name -> review
 const NM=fs.readdirSync('supabase/migrations').find(x=>x.includes('_auto_book_name_match.sql'));
 if(NM){const M2=fs.readFileSync('supabase/migrations/'+NM,'utf8');await db.exec(M2);await assert.rejects(()=>db.exec(M2),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  await q("insert into clinic_reception.auto_book_services(provider_id,service_code) values($1,'DENT1')",[prov2]);
  const mona=(await one("select id from patients where phone='01555555555'")).id;
  await q("insert into clinic_reception.masa_bookings values('N1',$1,1200,$2,$3,$4,'active','حشو','منى سمير','01555555555',false)",[ws,prov2,at('11:00'),at('11:30')]);
  await q("insert into clinic_reception.masa_bookings values('N2',$1,1200,$2,$3,$4,'active','حشو','سلمى سمير تجريبية','01555555555',false)",[ws,prov2,at('13:00'),at('13:30')]);
  await one("select clinic_reception.auto_book_run()");
  let n=await one("select * from clinic_reception.external_bookings where external_id='N1'");assert.equal(n.state,'booked',n.reason);assert.equal(n.public_patient_id,mona);
  n=await one("select * from clinic_reception.external_bookings where external_id='N2'");assert.equal(n.review_kind,'patient');
  assert.equal((await one("select clinic_reception.name_first_two('أحمد  محمد علي') v")).v,'احمد محمد');assert.equal((await one("select clinic_reception.name_first_two('أحمد') v")).v,null);
  await db.exec(fs.readFileSync('supabase/rollbacks/'+NM.replace('.sql','.rollback.sql'),'utf8'));
  assert.equal((await one("select position('name_first_two' in pg_get_functiondef('clinic_reception.auto_book_one(uuid)'::regprocedure)) p")).p,0,'branch removed');}
  // 20261122000000: list rows also carry needed_service (new/old split on the no-time list)
  await as(staffU);
 await db.exec(fs.readFileSync('supabase/migrations/20261122000000_auto_book_list_needed_service.sql','utf8'));
 const lst2=(await one("select clinic_reception_auto_book($1,'list',$2) r",[ws,{from:'2020-01-01',to:'2020-01-30'}])).r;
 assert.ok(lst2.rows.every(x=>'needed_service' in x),'list rows carry needed_service after the migration');
 

 // rollback
 await db.exec(fs.readFileSync('supabase/rollbacks/'+fs.readdirSync('supabase/rollbacks').find(x=>x.includes('_reception_auto_book.')),'utf8'));
 await q("insert into clinic_reception.masa_bookings values('M9',$1,1130,$2,$3,$4,'active','كشف','أحمد محمود تجريبي','01012345637',false)",[ws,prov,at('10:00'),at('10:20')]);
 assert.equal((await one("select to_regclass('clinic_reception.external_bookings') r")).r,null);
 await as(staffU);assert.equal((await one("select clinic_reception_queue($1,'agent_booking_register',$2) r",[ws,{booking_id:id()}])).r.inner,'agent_booking_register','queue RPC restored');await as('');
 console.log('reception auto-book: ok');
 }catch(e){console.error(e);process.exitCode=1;}finally{await db.close();}})();
