// Owner 2026-11-23 «طبق حل الحجوزات»: Masa day-only bookings are placed at the doctor's first free time at sync, a full day
// becomes review 'full_day', capacity / extras / told / set_time modes, resync behaviour, the one-pass re-placement, rollback.
// Runs the whole self-contained chain of tests/reception-auto-book-sql.cjs (stub reception command) up to its own rollback,
// then applies 20261122330000 with an availability table and an extended stub (overbook / manual time).
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-auto-book-sql.cjs'),'utf8');
const cut=src.indexOf(' // rollback\n');
assert(cut>0&&src.includes("console.log('reception auto-book: ok');"),'reception-auto-book-sql.cjs markers moved; update this test');
const body=`
 // ---- 20261122330000 ----
 await db.exec(\`create table clinic_reception.availability(id uuid primary key default gen_random_uuid(),workspace_id uuid,provider_id uuid,starts_at timestamptz,ends_at timestamptz,source text);
  alter table clinic_reception.appointments add column if not exists overbook boolean not null default false,add column if not exists manual_time boolean not null default false;
  alter function clinic_reception_command(uuid,text,jsonb,uuid) rename to stub_command;
  create function clinic_reception_command(p_workspace uuid,p_action text,p_payload jsonb,p_token uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $f$
  declare me uuid:=clinic_reception.access(p_workspace,'book');v uuid;t timestamptz;r jsonb;begin
   if p_action='overbook' then t:=(p_payload->>'starts_at')::timestamptz;
    if length(coalesce(p_payload->>'reason_kind','')||coalesce(p_payload->>'reason',''))<3 then raise exception 'اكتب سبب الحجز الإضافي';end if;
    insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at,source,created_by,overbook) values(p_workspace,(p_payload->>'patient_id')::uuid,(p_payload->>'provider_id')::uuid,(p_payload->>'service_id')::uuid,t,t+interval '5 minutes','overbook',me,true) returning id into v;
    return jsonb_build_object('id',v);end if;
   if p_action in ('book','reschedule') and not coalesce((p_payload->>'manual_time')::boolean,false) then
    t:=(p_payload->>'starts_at')::timestamptz;
    if not exists(select 1 from clinic_reception.availability a where a.provider_id=(p_payload->>'provider_id')::uuid and a.starts_at<=t and a.ends_at>t) then raise exception 'الموعد خارج فترة تواجد الطبيب';end if;end if;
   r:=stub_command(p_workspace,p_action,p_payload-'manual_time'-'manual_reason_kind'-'manual_reason',p_token);
   if coalesce((p_payload->>'manual_time')::boolean,false) then update clinic_reception.appointments set manual_time=true where id=(r->>'id')::uuid;end if;
   return r;end $f$;\`);
 const day2=(await one("select ((now() at time zone 'Africa/Cairo')::date+2)::text d")).d,day3=(await one("select ((now() at time zone 'Africa/Cairo')::date+3)::text d")).d;
 const z=(d,h)=>d+'T'+h+':00+02:00';
 // doctor prov: 22:00-23:00 on day2 (3 × 20 min) and day3; day-only rows already waiting (needs_time) from before
 await q("insert into clinic_reception.availability(workspace_id,provider_id,starts_at,ends_at) values($1,$2,$3,$4),($1,$2,$5,$6)",[ws,prov,z(day2,'22:00'),z(day2,'23:00'),z(day3,'22:00'),z(day3,'23:00')]);
 await q("insert into patients(full_name,phone,age) values('سارة علي حسن','01000000001',30),('هالة مصطفى أحمد','01000000002',30),('كريم عادل محمود','01000000003',30),('منى سامي فؤاد','01000000004',30)");
 const mk=async(id,name,phone,d)=>q("insert into clinic_reception.masa_bookings values($1,$2,1130,$3,$4,$5,'active','كشف',$6,$7,true)",[id,ws,prov,z(d,'00:00'),z(d,'00:20'),name,phone]);
 await q("update clinic_reception.auto_book_settings set enabled=false");
 await mk('D1','سارة علي حسن','01000000001',day2);await mk('D2','هالة مصطفى أحمد','01000000002',day2);
 const rowOf=async ext=>one("select *, day::text as dayt from clinic_reception.external_bookings where external_id=$1",[ext]);
 // before the migration they wait without a time
 await q("update clinic_reception.auto_book_settings set enabled=true");await one("select clinic_reception.auto_book_run()");
 let D1=await rowOf('D1');assert.equal(D1.state,'needs_time');
 await as('');
 const MIG=fs.readFileSync('supabase/migrations/20261122330000_masa_day_only_auto_time.sql','utf8');
 await db.exec(MIG);await assert.rejects(()=>db.exec(MIG),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
 // one-pass re-placement: both placed at 22:00 and 22:20 (20-min service), auto_timed, not told yet
 D1=await rowOf('D1');let D2=await rowOf('D2');
 assert.equal(D1.state,'booked',D1.reason);assert.equal(D2.state,'booked',D2.reason);assert.equal(D1.auto_timed,true);assert.equal(D1.time_told_at,null);
 const hm=async id=>(await one("select to_char(starts_at at time zone 'Africa/Cairo','HH24:MI') h from clinic_reception.appointments where id=$1",[id])).h;
 assert.deepEqual([await hm(D1.appointment_id),await hm(D2.appointment_id)].sort(),['22:00','22:20']);
 // sync time: a third fills the day, a fourth finds it full → review full_day with a plain reason
 await mk('D3','كريم عادل محمود','01000000003',day2);await mk('D4','منى سامي فؤاد','01000000004',day2);
 await one("select clinic_reception.auto_book_run()");
 let D3=await rowOf('D3'),D4=await rowOf('D4');assert.equal(D3.state,'booked');assert.equal(await hm(D3.appointment_id),'22:40');
 assert.equal(D4.state,'review');assert.equal(D4.review_kind,'full_day');assert.match(D4.reason,/يوم الدكتور مليان/);
 // same patient + doctor + day → merged, not booked twice
 await q("insert into clinic_reception.masa_bookings values('D5',$1,1130,$2,$3,$4,'active','كشف','سارة علي حسن','01000000001',true)",[ws,prov,z(day2,'00:00'),z(day2,'00:20')]);
 await one("select clinic_reception.auto_book_run()");let D5=await rowOf('D5');assert.equal(D5.state,'merged');assert.equal(D5.appointment_id,D1.appointment_id);
 // resync of an unchanged day-only row does not flip it back to pending
 await q("update clinic_reception.masa_bookings set phone='01000000001' where official_booking_id='D1'");
 assert.equal((await rowOf('D1')).state,'booked','resync keeps it');
 // Masa moves the day → the appointment moves to the first free time of the new day
 await q("update clinic_reception.masa_bookings set starts_at=$1,ends_at=$2 where official_booking_id='D2'",[z(day3,'00:00'),z(day3,'00:20')]);
 await one("select clinic_reception.auto_book_run()");D2=await rowOf('D2');assert.equal(D2.state,'booked',D2.reason);assert.equal(D2.dayt,day3);
 assert.equal((await one("select (starts_at at time zone 'Africa/Cairo')::date::text d from clinic_reception.appointments where id=$1",[D2.appointment_id])).d,day3);
 // a window ending at midnight (22:00-00:00 Cairo, like Dr. Ahmed Samir): placed at 22:00, 22:20, …
 const day4=(await one("select ((now() at time zone 'Africa/Cairo')::date+4)::text d")).d,day5=(await one("select ((now() at time zone 'Africa/Cairo')::date+5)::text d")).d;
 await q("insert into clinic_reception.availability(workspace_id,provider_id,starts_at,ends_at) values($1,$2,$3,$4)",[ws,prov,z(day4,'22:00'),z(day5,'00:00')]);
 await q("insert into patients(full_name,phone,age) values('رنا فتحي علي','01000000005',30),('سلمى نبيل حسن','01000000006',30)");
 // the doctor's saved service belongs to another department (live: «الطبيب خارج تخصص الخدمة») → his own department's service is used
 await q("insert into clinic_reception.auto_book_services(provider_id,service_code) values($1,'DENT1') on conflict (provider_id) do update set service_code='DENT1'",[prov]);
 await mk('Z1','رنا فتحي علي','01000000005',day4);await mk('Z2','سلمى نبيل حسن','01000000006',day4);
 await one("select clinic_reception.auto_book_run()");
 const M1=await rowOf('Z1'),M2=await rowOf('Z2');assert.equal(M1.state,'booked',M1.reason);assert.equal(M2.state,'booked',M2.reason);
 assert.deepEqual([await hm(M1.appointment_id),await hm(M2.appointment_id)].sort(),['22:00','22:20']);
 assert.equal((await one("select s.department from clinic_reception.appointments x join clinic_reception.services s on s.id=x.service_id where x.id=$1",[M1.appointment_id])).department,'جلدية','service of his own department');
 // free times exist but the booking rules refuse them all → review 'slot' with the reason (not «مليان»)
 await q("insert into patients(full_name,phone,age) values('ياسر عمرو سعد','01000000007',30)");
 await db.exec("create function clinic_reception.refuse_all() returns trigger language plpgsql as $t$begin if new.patient_id in (select rp.id from clinic_reception.patients rp where rp.phone='01000000007') then raise exception 'قاعدة حجز رفضت'; end if; return new; end $t$; create trigger refuse_all before insert on clinic_reception.appointments for each row execute function clinic_reception.refuse_all();");
 await mk('Z3','ياسر عمرو سعد','01000000007',day4);await one("select clinic_reception.auto_book_run()");
 const M3=await rowOf('Z3');assert.equal(M3.review_kind,'slot');assert.match(M3.reason,/مقدرتش أسجّل أول ميعاد فاضي: قاعدة حجز رفضت/);
 await db.exec("drop trigger refuse_all on clinic_reception.appointments");
 // 20261122340000: a TIMED Masa row with the doctor's saved service of another department → his own department's service
 const M34=fs.readFileSync('supabase/migrations/20261122340000_masa_timed_service_department.sql','utf8');
 await db.exec(M34);await assert.rejects(()=>db.exec(M34),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
 await q("insert into patients(full_name,phone,age) values('عمر حسام فؤاد','01000000008',30)");
 await q("insert into clinic_reception.masa_bookings values('T1',$1,1130,$2,$3,$4,'active','كشف','عمر حسام فؤاد','01000000008',false)",[ws,prov,z(day4,'23:00'),z(day4,'23:20')]);
 await one("select clinic_reception.auto_book_run()");const T1=await rowOf('T1');assert.equal(T1.state,'booked',T1.reason);
 assert.equal((await one("select s.department from clinic_reception.appointments x join clinic_reception.services s on s.id=x.service_id where x.id=$1",[T1.appointment_id])).department,'جلدية');
 await db.exec(fs.readFileSync('supabase/rollbacks/20261122340000_masa_timed_service_department.rollback.sql','utf8'));
 assert.equal((await one("select position('auto_time_service' in pg_get_functiondef('clinic_reception.auto_book_one(uuid)'::regprocedure)) p")).p,0,'timed path restored');
 await db.exec(M34);
 // reception RPC: capacity, extras, told, set_time modes
 await as(staffU);
 const rpc=async(a,p)=>(await one("select clinic_reception_auto_book($1,$2,$3) r",[ws,a,p])).r;
 const cap=await rpc('capacity',{provider_id:prov,from:day2,to:day3});
 assert.deepEqual(cap.days.map(x=>[x.day,x.booked,x.capacity]),[[day2,2,3],[day3,1,3]]);
 const capM=await rpc('capacity',{provider_id:prov,from:day4,to:day4});assert.deepEqual([capM.days[0].booked,capM.days[0].capacity],[3,6],'midnight window counts 120 minutes');
 const ex=(await rpc('extras',{ids:[D4.id]})).rows[0];assert.equal(ex.capacity.capacity,3);assert(ex.free.length>=1,'day2 has a free time again after D2 moved');
 assert(ex.suggest.length>=1&&ex.suggest.every(t=>!t.startsWith(day2)),'suggestions on other days');
 const lst9=await rpc('list',{from:day2,to:day3});const lr=lst9.rows.find(x=>x.id===D1.id);assert.equal(lr.auto_timed,true);assert('time_told_at' in lr&&'pinned' in lr);
 assert.equal((await rpc('told',{id:D1.id})).told,true);assert((await rowOf('D1')).time_told_at);
 await assert.rejects(()=>rpc('set_time',{id:D4.id,starts_at:z(day2,'22:45'),mode:'later'}),/اختيار غير معروف/);
 const ob=await rpc('set_time',{id:D4.id,starts_at:z(day2,'22:45'),mode:'overbook',reason_kind:'حجز ماسا واليوم مليان',reason:'الدكتور وافق'});
 assert.equal(ob.state,'booked');D4=await rowOf('D4');assert.equal(D4.pinned,true);assert.equal((await one("select overbook from clinic_reception.appointments where id=$1",[D4.appointment_id])).overbook,true);
 // normal mode on another day (chip) for an auto-placed row → rescheduled there, pinned; manual mode outside hours
 const n1=await rpc('set_time',{id:D3.id,starts_at:z(day3,'22:20')});D3=await rowOf('D3');assert.equal(D3.pinned,true);assert.equal(D3.dayt,day3);assert.equal(await hm(D3.appointment_id),'22:20');
 const mm=await rpc('set_time',{id:D1.id,starts_at:z(day2,'23:30'),mode:'manual',reason_kind:'doctor_agreement'});assert.equal(mm.state,'booked');
 assert.equal((await one("select manual_time from clinic_reception.appointments where id=$1",[(await rowOf('D1')).appointment_id])).manual_time,true);
 await assert.rejects(()=>rpc('set_time',{id:D1.id,starts_at:'2020-01-01T10:00:00Z'}),/فات/);
 // pinned rows keep their day/time on resync
 await q("update clinic_reception.masa_bookings set phone='01000000003' where official_booking_id='D3'");assert.equal((await rowOf('D3')).dayt,day3);
 // clients cannot call the helpers directly
 for(const f of ['clinic_reception.free_starts(uuid,date,integer,integer)','clinic_reception.day_capacity(uuid,uuid,date)','clinic_reception.auto_book_place_day_only(uuid,uuid)'])
  assert.equal((await one("select has_function_privilege('authenticated',$1,'execute') x",[f])).x,false,f);
 assert.equal((await one("select has_table_privilege('authenticated','clinic_reception.auto_time_saved_defs','select') x")).x,false);await as('');
 // 20261122360000: free_starts keeps the doctor's 5-minute gap on both sides
 await db.exec("create function clinic_reception.provider_gap(p uuid) returns interval language sql stable as $g$ select interval '5 minutes' $g$");
 const M36=fs.readFileSync('supabase/migrations/20261122360000_free_starts_gap.sql','utf8');
 await db.exec(M36);await assert.rejects(()=>db.exec(M36),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
 const day6=(await one("select ((now() at time zone 'Africa/Cairo')::date+6)::text d")).d;
 await q("insert into clinic_reception.availability(workspace_id,provider_id,starts_at,ends_at) values($1,$2,$3,$4)",[ws,prov,z(day6,'22:00'),z(day6,'23:30')]);
 const other=(await one("select id from clinic_reception.patients where workspace_id=$1 limit 1",[ws])).id;
 await q("insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at,source) values($1,$2,$3,$4,$5,$6,'manual')",[ws,other,prov,svc,z(day6,'22:20'),z(day6,'22:40')]);
 const fs6=(await one("select array_agg(to_char(t at time zone 'Africa/Cairo','HH24:MI') order by t) a from clinic_reception.free_starts($1,$2::date,20,3) t",[prov,day6])).a;
 assert.deepEqual(fs6,['22:45','22:50','22:55'],'22:00 would end at 22:20 with no gap before the 22:20 booking');
 await q("insert into patients(full_name,phone,age) values('دينا ماهر سعيد','01000000009',30)");
 await mk('G1','دينا ماهر سعيد','01000000009',day6);await one("select clinic_reception.auto_book_run()");
 const G1=await rowOf('G1');assert.equal(G1.state,'booked',G1.reason);assert.equal(await hm(G1.appointment_id),'22:45');
 await db.exec(fs.readFileSync('supabase/rollbacks/20261122360000_free_starts_gap.rollback.sql','utf8'));
 assert.equal((await one("select array_agg(to_char(t at time zone 'Africa/Cairo','HH24:MI') order by t) a from clinic_reception.free_starts($1,$2::date,20,1) t",[prov,day6])).a[0],'22:00','rollback: no gap again');
 // rollback (newest first; 330000 refuses while 340000 is applied)
 await assert.rejects(()=>db.exec(fs.readFileSync('supabase/rollbacks/20261122330000_masa_day_only_auto_time.rollback.sql','utf8')),/رجّع 20261122340000 الأول/);await db.exec('rollback');
 await db.exec(fs.readFileSync('supabase/rollbacks/20261122340000_masa_timed_service_department.rollback.sql','utf8'));
 await db.exec(fs.readFileSync('supabase/rollbacks/20261122330000_masa_day_only_auto_time.rollback.sql','utf8'));
 assert.equal((await one("select to_regprocedure('clinic_reception.free_starts(uuid,date,int,int)') r")).r,null);
 assert.ok((await one("select position('needs_time' in pg_get_functiondef('clinic_reception.auto_book_one(uuid)'::regprocedure)) p")).p>0,'old day-only branch back');
 await q("insert into clinic_reception.masa_bookings values('D9',$1,1130,$2,$3,$4,'active','كشف','منى سامي فؤاد','01000000004',true)",[ws,prov,z(day3,'00:00'),z(day3,'00:20')]);
 await one("select clinic_reception.auto_book_run()");assert.equal((await rowOf('D9')).state,'needs_time','after rollback day-only waits again');
 console.log('PASS masa day-only auto time: one-pass re-placement, first free time at sync, full_day review, same-patient merge, quiet resync, day move, capacity, extras, told, overbook/normal/manual set_time, pinned resync, gates, rollback.');
 }catch(e){console.error(e);process.exitCode=1;}finally{await db.close();}})();`;
const file=path.join(require('os').tmpdir(),'masa-auto-time-'+process.pid+'.cjs');
fs.writeFileSync(file,src.slice(0,cut).replace(/require\('@electric-sql\/pglite'\)/,'require('+JSON.stringify(require.resolve('@electric-sql/pglite'))+')').replace(/fs\.readFileSync\('supabase/g,"fs.readFileSync("+JSON.stringify(process.cwd()+'/')+"+'supabase").replace(/fs\.readdirSync\('supabase\/(migrations|rollbacks)'\)/g,(m,d)=>"fs.readdirSync("+JSON.stringify(process.cwd()+'/supabase/'+d)+")")+body.replace(/fs\.readFileSync\('supabase/g,"fs.readFileSync("+JSON.stringify(process.cwd()+'/')+"+'supabase"));
try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
