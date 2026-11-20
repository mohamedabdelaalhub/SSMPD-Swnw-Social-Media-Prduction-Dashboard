// «تسجيل موعد يدوي» (owner 2026-11-20): overbook on a full schedule — limits, availability, reason, gap/fallback skip, rollback.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite'),{randomUUID}=require('crypto');
const between=(f,a,b)=>{const s=fs.readFileSync(f,'utf8');return s.slice(s.indexOf(a),s.indexOf(b));};
(async()=>{const db=new PGlite(),id=()=>randomUUID(),q=(s,p)=>db.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0];
 const U=id(),A=id(),UM=id(),AM=id(),ws=id(),d1=id(),s1=id(),p1=id(),p2=id(),p3=id();
 const M='supabase/migrations/'+fs.readdirSync('supabase/migrations').find(x=>x.includes('_reception_manual_overbook.sql'));
 const R='supabase/rollbacks/'+fs.readdirSync('supabase/rollbacks').find(x=>x.includes('_reception_manual_overbook.'));
 try{await db.exec(`create role authenticated;create role anon;create schema auth;create schema clinic_reception;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create table admins(id uuid primary key,user_id uuid,name text,manager boolean default false);
  create function my_admin_id() returns uuid language sql stable security definer as $$select id from admins where user_id=auth.uid()$$;
  create table clinic_reception.patients(id uuid primary key,workspace_id uuid);create table clinic_reception.providers(id uuid primary key,workspace_id uuid);
  create table clinic_reception.services(id uuid primary key,workspace_id uuid,active boolean default true);
  create table clinic_reception.availability(provider_id uuid,starts_at timestamptz,ends_at timestamptz);
  create table clinic_reception.appointments(id uuid primary key default gen_random_uuid(),workspace_id uuid,patient_id uuid,provider_id uuid,service_id uuid,starts_at timestamptz,ends_at timestamptz,status text default 'booked',source text default 'unknown',source_evidence text default 'unknown',created_by uuid);
  create table clinic_reception.fallback_bookings(provider_id uuid,starts_at timestamptz,ends_at timestamptz);
  create function clinic_reception.fallback_holds(b clinic_reception.fallback_bookings) returns boolean language sql as $$select true$$;
  create function clinic_reception.slot_lock(uuid) returns void language sql as $$select$$;
  create table clinic_reception.workspaces(id uuid primary key,booking_gap_minutes int default 5);
  create function clinic_reception.provider_gap(p uuid) returns interval language sql as $$select interval '5 minutes'$$;
  create function clinic_reception.can_manage(uuid) returns boolean language sql as $$select false$$; -- exists on live (name clash once)
  create table clinic_reception.audit(id serial,workspace_id uuid,actor_id uuid,action text,entity_id uuid,detail jsonb);
  create table clinic_reception.commands(workspace_id uuid,actor_id uuid,token uuid,action text,payload jsonb,response jsonb,primary key(workspace_id,actor_id,token));
  create function clinic_reception.access(w uuid,a text) returns uuid language plpgsql security definer as $$begin if my_admin_id() is null then raise exception 'سجل الدخول';end if;
   if a='manage' and not (select manager from admins where id=my_admin_id()) then raise exception 'مدير الاستقبال بس';end if;return my_admin_id();end $$;
  create function clinic_reception_command(p_workspace uuid,p_action text,p_payload jsonb,p_token uuid) returns jsonb language plpgsql security definer as $$
  declare v uuid;t timestamptz;begin t:=(p_payload->>'starts_at')::timestamptz;
   if exists(select 1 from clinic_reception.appointments where provider_id=(p_payload->>'provider_id')::uuid and status not in ('cancelled','no_show') and starts_at<t+interval '20 minutes' and ends_at>t) then raise exception 'الموعد غير متاح';end if;
   insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at) values(p_workspace,(p_payload->>'patient_id')::uuid,(p_payload->>'provider_id')::uuid,(p_payload->>'service_id')::uuid,t,t+interval '20 minutes') returning id into v;
   return jsonb_build_object('id',v);end $$;`);
  await db.exec(between('supabase/migrations/20261117200000_reception_booking_gap.sql','create or replace function clinic_reception.appointments_respect_gap()','revoke all on function clinic_reception.appointments_respect_gap()')+';'+between('supabase/migrations/20261117140000_reception_masa_links_fallback_booking.sql','create or replace function clinic_reception.appointments_respect_fallback()','drop trigger if exists appointments_respect_fallback')+`;
   create trigger appointments_respect_gap before insert or update of provider_id, starts_at, ends_at, status on clinic_reception.appointments for each row execute function clinic_reception.appointments_respect_gap();
   create trigger appointments_respect_fallback before insert or update of provider_id, starts_at, ends_at, status on clinic_reception.appointments for each row execute function clinic_reception.appointments_respect_fallback();`);
  await q("insert into admins values($1,$2,'دينا',false),($3,$4,'مدير',true)",[A,U,AM,UM]);
  await q("insert into clinic_reception.patients values($1,$4),($2,$4),($3,$4)",[p1,p2,p3,ws]);await q("insert into clinic_reception.providers values($1,$2)",[d1,ws]);await q("insert into clinic_reception.services values($1,$2)",[s1,ws]);
  const day='2030-01-01';await q("insert into clinic_reception.availability values($1,$2,$3)",[d1,day+'T15:00:00+02',day+'T21:00:00+02']);
  const as=async(u)=>db.exec(`select set_config('request.jwt.claim.sub','${u}',false)`);await as(U);
  await db.exec(fs.readFileSync(M,'utf8'));await assert.rejects(()=>db.exec(fs.readFileSync(M,'utf8')),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
  const cmd=(a,p,t)=>one("select clinic_reception_command($1,$2,$3,$4) r",[ws,a,p,t||randomUUID()]).then(x=>x.r);
  const ob=(min,extra)=>cmd('overbook',{patient_id:p2,provider_id:d1,service_id:s1,starts_at:day+'T17:'+min+':00+02',reason_kind:'طلب الدكتور',...extra});
  // 17:00 booked normally; a normal booking at 17:05 is refused, the overbook goes in
  await cmd('book',{patient_id:p1,provider_id:d1,service_id:s1,starts_at:day+'T17:00:00+02'});
  await assert.rejects(()=>cmd('book',{patient_id:p2,provider_id:d1,service_id:s1,starts_at:day+'T17:05:00+02'}),/غير متاح|لازم/);
  const tok=randomUUID();let r=await ob('05',{});r=await cmd('overbook',{patient_id:p2,provider_id:d1,service_id:s1,starts_at:day+'T17:05:00+02',reason_kind:'طلب الدكتور'},tok);
  const r2=await cmd('overbook',{patient_id:p2,provider_id:d1,service_id:s1,starts_at:day+'T17:05:00+02',reason_kind:'طلب الدكتور'},tok);assert.deepEqual(r2,r,'same token → same answer');
  let a=await one("select overbook,overbook_reason,overbook_by,source,extract(epoch from ends_at-starts_at)/60 m,status from clinic_reception.appointments where id=$1",[r.id]);
  assert.equal(a.overbook,true);assert.equal(a.overbook_reason,'طلب الدكتور');assert.equal(a.overbook_by,A);assert.equal(a.source,'overbook');assert.equal(+a.m,5);assert.equal(a.status,'booked');
  assert.equal((await one("select count(*)::int n from clinic_reception.audit where action='overbook'")).n,2);
  // the next free slot (17:25) still books normally: overbook rows don't block the gap
  await cmd('book',{patient_id:p3,provider_id:d1,service_id:s1,starts_at:day+'T17:25:00+02'});
  // limits: 2 in the same hour (17:05 twice above) → a third for reception, allowed for the manager
  await assert.rejects(()=>ob('10',{}),/وصلت لحد المواعيد الإضافية/);
  await as(UM);r=await ob('10',{});assert.ok(r.id);await as(U);
  // reason, availability, past, missing fields
  await assert.rejects(()=>cmd('overbook',{patient_id:p2,provider_id:d1,service_id:s1,starts_at:day+'T18:05:00+02',reason:'x'}),/اكتب سبب/);
  await assert.rejects(()=>cmd('overbook',{patient_id:p2,provider_id:d1,service_id:s1,starts_at:day+'T22:00:00+02',reason:'حالة طارئة'}),/مش متواجد/);
  await assert.rejects(()=>cmd('overbook',{patient_id:p2,provider_id:d1,service_id:s1,starts_at:'2020-01-01T10:00:00+02',reason:'حالة طارئة'}),/فات/);
  await assert.rejects(()=>cmd('overbook',{patient_id:p2,provider_id:d1,starts_at:day+'T18:00:00+02',reason:'حالة طارئة'}),/اختار المريض/);
  // fallback holds don't stop an overbook; still stop normal bookings
  await q("insert into clinic_reception.fallback_bookings values($1,$2,$3)",[d1,day+'T19:00:00+02',day+'T19:20:00+02']);
  await assert.rejects(()=>cmd('book',{patient_id:p1,provider_id:d1,service_id:s1,starts_at:day+'T19:00:00+02'}),/حجز احتياطي/);
  r=await cmd('overbook',{patient_id:p1,provider_id:d1,service_id:s1,starts_at:day+'T19:05:00+02',reason:'مريض جه من غير ميعاد والجدول مليان'});assert.ok(r.id);
  // day limit: 6 per doctor per day (already 4: three at 17h, one at 19h) → 2 more, then the 7th refused
  for(const h of ['15','16'])await cmd('overbook',{patient_id:p3,provider_id:d1,service_id:s1,starts_at:day+'T'+h+':30:00+02',reason:'متابعة سريعة'});
  await assert.rejects(()=>cmd('overbook',{patient_id:p3,provider_id:d1,service_id:s1,starts_at:day+'T18:40:00+02',reason:'متابعة سريعة'}),/٦ في اليوم/);
  // other actions pass through
  assert.ok((await cmd('book',{patient_id:p1,provider_id:d1,service_id:s1,starts_at:'2030-01-02T17:00:00+02'})).id);
  // rollback: triggers back to the saved bodies, command back
  await db.exec(fs.readFileSync(R,'utf8'));
  assert.ok(!(await one("select pg_get_functiondef('clinic_reception.appointments_respect_gap()'::regprocedure) d")).d.includes('overbook'));
  assert.ok(!(await one("select pg_get_functiondef('clinic_reception.appointments_respect_fallback()'::regprocedure) d")).d.includes('overbook'));
  assert.equal((await one("select to_regprocedure('clinic_reception.command_before_overbook(uuid,text,jsonb,uuid)') f")).f,null);
  await db.exec(fs.readFileSync(M,'utf8'));
  console.log('PASS reception manual overbook');
 }catch(e){console.error('FAIL',e);process.exit(1);}})();
