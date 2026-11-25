// 20261126040000 (owner bug 2026-11-25: Masa «كشف…» for Dr Sherif auto-booked as «غرز…», his saved default): the auto
// picker never uses a non-consult saved default, step 1 is a pure name match (non-consult only when exact and the Masa text
// is not a consultation), home services are never auto-picked, set_service refuses procedures / home services and its list
// only offers consultations, bad saved defaults are cleared with audit (idempotent), sync_catalog keeps is_home on a
// re-version, a second run is refused, rollback restores the saved bodies.
const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),assert=require('node:assert/strict');
const M='supabase/migrations/';
const fn=(file,name)=>{const s=fs.readFileSync(M+file,'utf8'),i=s.indexOf('create function clinic_reception.'+name+'(');assert(i>=0,name);const j=s.indexOf('$$;',s.indexOf('$$',s.indexOf(' as $$',i)+6))+3;return s.slice(i,j);};
(async()=>{const db=new PGlite();const q=(t,p)=>db.query(t,p),one=async(t,p)=>(await q(t,p)).rows[0];
 const ws='00000000-0000-4000-8000-000000000001',staffU='00000000-0000-4000-8000-0000000000aa',staffA='00000000-0000-4000-8000-0000000000ab',sysA='00000000-0000-4000-8000-0000000000ac';
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema clinic_reception;create schema psychcare;
  create table public.admins(id uuid primary key,user_id uuid,name text,active boolean default true);
  create function public.my_admin_id() returns uuid language sql stable as $$select id from public.admins where user_id=nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create table public.patients(id uuid primary key default gen_random_uuid(),patient_code text,full_name text,last_visit_date date,status text default 'active');
  create table clinic_reception.workspaces(id uuid primary key,mode text default 'live');
  create table clinic_reception.providers(id uuid primary key,workspace_id uuid,name text,department text,active boolean default true);
  create table clinic_reception.services(id uuid primary key default gen_random_uuid(),workspace_id uuid,code text,name text,version int not null default 1,department text,minutes int default 15,
    requires_device boolean default false,price numeric default 100,bom jsonb default '[]',pricing_service_id uuid,source_fingerprint text,pricing_evidence jsonb,
    active boolean default true,placeholder boolean not null default false,is_home boolean not null default false);
  create table clinic_reception.provider_departments(provider_id uuid,department text);
  create table clinic_reception.provider_service_scopes(provider_id uuid,service_code text);
  create table clinic_reception.appointments(id uuid primary key default gen_random_uuid(),provider_id uuid,service_id uuid,status text default 'booked');
  create table clinic_reception.auto_book_services(provider_id uuid primary key,service_code text not null,set_by uuid,set_at timestamptz not null default now());
  create table clinic_reception.auto_book_settings(id boolean primary key default true,enabled boolean default false,workspace_id uuid,system_admin_id uuid);
  create table clinic_reception.audit(id bigint generated always as identity primary key,workspace_id uuid not null,actor_id uuid not null,action text not null,entity_id uuid,created_at timestamptz default now(),detail jsonb not null default '{}');
  create table clinic_reception.fallback_sync_state(key text,synced_at timestamptz);
  create table clinic_reception.external_bookings(id uuid primary key default gen_random_uuid(),source text default 'masa',state text,review_kind text,reason text,attempts int default 0,
    updated_at timestamptz,day date default current_date,starts_at timestamptz,day_only boolean default false,customer_name text,phone text,age int,needed_service text,provider_id uuid,
    appointment_id uuid,patient_created boolean default false,public_patient_id uuid,candidate_patient_id uuid,reception_patient_id uuid,resolved_by uuid,created_at timestamptz default now(),
    auto_timed boolean default false,time_told_at timestamptz,time_told_by uuid,pinned boolean default false);
  create table clinic_reception.auto_time_saved_defs(name text primary key,def text not null);
  create function clinic_reception.cairo_day(t timestamptz) returns date language sql as $$select (t at time zone 'Africa/Cairo')::date$$;
  create function clinic_reception.access(p_workspace uuid,p_action text) returns uuid language plpgsql as $$declare me uuid:=public.my_admin_id();begin if me is null then raise exception 'سجل الدخول';end if;return me;end$$;
  create table public.pricing_services(id uuid primary key,name text,booking_code text,booking_department text,booking_minutes int,booking_requires_device boolean default false);`);
 // live chain: service_name_key + auto_book_service + auto_book_service_for (20261121100000) → auto_time_service (20261122330000) → v3 (20261124210000)
 await db.exec(fn('20261121100000_auto_book_masa_service_name.sql','service_name_key')+';');
 await db.exec(fn('20261120130000_reception_auto_book.sql','auto_book_service'));
 await db.exec(fn('20261121100000_auto_book_masa_service_name.sql','auto_book_service_for'));
 await db.exec(fn('20261122330000_masa_day_only_auto_time.sql','auto_time_service'));
 await db.exec(fs.readFileSync(M+'20261124210000_auto_book_consult_only.sql','utf8'));
 // public.clinic_reception_auto_book as live: 20261122000000 body + the 20261122330000 in-place patch
 {const s=fs.readFileSync(M+'20261122000000_auto_book_list_needed_service.sql','utf8');const i=s.indexOf('CREATE OR REPLACE FUNCTION public.clinic_reception_auto_book');await db.exec(s.slice(i,s.indexOf('$function$;',i)+11));
  const t=fs.readFileSync(M+'20261122330000_masa_day_only_auto_time.sql','utf8');const a=t.indexOf('-- the reception RPC');const b=t.indexOf('end $$;',t.indexOf("not found once', (i + 1) / 2",a))+7;await db.exec(t.slice(a,b));}
 // sync_catalog stand-in carrying the live versioning lines verbatim (20261028215551:553-555)
 {const s=fs.readFileSync(M+'20261028215551_shared_price_references_and_list_permissions.sql','utf8').split('\n');const L=s.slice(552,555).join('\n');assert.match(L,/insert into clinic_reception\.services\(workspace_id,code,name,version/);
  await db.exec(`create function clinic_reception.sync_catalog(p_workspace uuid) returns void language plpgsql security definer set search_path to 'pg_catalog','public' as $function$
declare x record;version_no integer;finger text;price numeric:=100;bom jsonb:='[]';price_evidence jsonb:='{}';
begin
 for x in select * from public.pricing_services order by id loop
  finger:=md5(x.name);
  if exists(select 1 from clinic_reception.services where workspace_id=p_workspace and pricing_service_id=x.id and source_fingerprint=finger and active) then continue;end if;
${L}
 end loop;
end $function$;`);}
 // fixture
 const sher='00000000-0000-4000-8000-0000000000d1',phys='00000000-0000-4000-8000-0000000000d2',der='00000000-0000-4000-8000-0000000000d3',home='00000000-0000-4000-8000-0000000000d4';
 await q("insert into public.admins values($1,$2,'منار',true),($3,null,'الحجز التلقائي',true)",[staffA,staffU,sysA]);
 await q("insert into clinic_reception.workspaces values($1,'live')",[ws]);
 await q("insert into clinic_reception.auto_book_settings values(true,false,$1,$2)",[ws,sysA]);
 await q("insert into clinic_reception.providers(id,workspace_id,name,department) values($1,$5,'د.شريف إبراهيم','الجراحة'),($2,$5,'د.يحي زكريا','العلاج الطبيعي'),($3,$5,'د. جلدية','الجلدية'),($4,$5,'د. باطنة منزلي','الباطنة')",[sher,phys,der,home,ws]);
 const svc=async(code,name,dep,o={})=>(await one("insert into clinic_reception.services(workspace_id,code,name,department,minutes,is_home,pricing_service_id) values($1,$2,$3,$4,$5,$6,$7) returning id",[ws,code,name,dep,o.min||15,!!o.home,o.ps||null])).id;
 const ghorz=await svc('0000147','غرز جراحية عادية (حتى ٥ غرز)','الجراحة',{min:10}),sherK=await svc('0000100','كشف جراحة عامة','الجراحة'),sherS=await svc('0000101','استشارة جراحة','الجراحة');
 const session=await svc('0000200','جلسة علاج طبيعي','العلاج الطبيعي',{min:30}),physK=await svc('0000201','كشف علاج طبيعي','العلاج الطبيعي');
 const derK=await svc('0000300','كشف جلدية','الجلدية'),derP=await svc('0000301','كشف جلدية بالجهاز','الجلدية',{min:5});
 const homeK=await svc('0000400','كشف منزلي','الباطنة',{min:5,home:true}),intK=await svc('0000401','كشف باطنة','الباطنة',{min:20});
 await q("insert into clinic_reception.auto_book_services(provider_id,service_code,set_by) values($1,'0000147',$3),($2,'0000200',$3),($4,'0000300',$3)",[sher,phys,staffA,der]);
 const pick=async(p,needed=null)=>(await one('select clinic_reception.auto_time_service($1,$2,$3) v',[ws,p,needed])).v;
 // before: the bug
 assert.equal(await pick(sher,'كشف جديد'),ghorz,'v3 reproduced: Masa «كشف جديد» + saved default «غرز» → غرز');
 assert.equal(await pick(home),homeK,'v3 reproduced: «كشف منزلي» (shortest كشف) auto-picked');
 // an open review row for set_service
 const bk=(await one("insert into clinic_reception.external_bookings(state,review_kind,provider_id,needed_service) values('review','service',$1,'كشف جديد') returning id",[sher])).id;
 // sync_catalog fixture: a home service linked to pricing, re-versioned later
 const ps='00000000-0000-4000-8000-0000000000f1';await q("insert into public.pricing_services values($1,'كشف منزلي باطنة','0000500','الباطنة',30)",[ps]);
 await q("select clinic_reception.sync_catalog($1)",[ws]);await q("update clinic_reception.services set is_home=true where code='0000500'");
 // apply
 const MIG=fs.readFileSync(M+'20261126040000_auto_book_consult_guard.sql','utf8');
 assert(MIG.indexOf('raise exception \'تم تطبيق هذا الملف من قبل\'')<MIG.indexOf('\nbegin;'),'already-applied guard sits before begin');
 await db.exec(MIG);
 // ops clear: غرز + جلسة deleted with audit; the consult default (كشف جلدية) kept
 assert.deepEqual((await q("select service_code from clinic_reception.auto_book_services order by 1")).rows.map(r=>r.service_code),['0000300'],'non-consult defaults cleared, consult default kept');
 const au=(await q("select actor_id,action,entity_id,detail from clinic_reception.audit order by id")).rows;
 assert.equal(au.length,2);assert(au.every(a=>a.action==='auto_book_default_cleared'&&a.actor_id===sysA));
 const ga=au.find(a=>a.entity_id===sher);assert.equal(ga.detail.service_code,'0000147');assert.match(ga.detail.service_name,/غرز/);assert.equal(ga.detail.set_by,staffA);assert.equal(ga.detail.provider,'د.شريف إبراهيم');
 assert.equal((await one("select clinic_reception.auto_book_clear_bad_defaults() n")).n,0,'ops clear idempotent');
 assert.equal((await one("select count(*)::int n from clinic_reception.audit")).n,2,'no extra audit on the second run');
 // a bad default saved again later (e.g. before the UI refresh) is ignored by the picker
 await q("insert into clinic_reception.auto_book_services(provider_id,service_code,set_by) values($1,'0000147',$2)",[sher,staffA]);
 assert.equal(await pick(sher,'كشف جديد'),sherK,'Masa «كشف جديد» + saved «غرز» → the doctor\'s كشف');
 assert.equal(await pick(sher,'كشف'),sherK);assert.equal(await pick(sher,null),sherK,'no text → كشف, not the saved غرز');
 assert.equal(await pick(sher,'استشارة'),sherS,'«استشارة» → استشارة');
 await q("delete from clinic_reception.auto_book_services where provider_id=$1",[sher]);
 // a consult saved default still works (and beats the department ranking)
 assert.equal(await pick(der,'كشف جديد'),derK);
 await q("update clinic_reception.auto_book_services set service_code='0000301' where provider_id=$1",[der]);
 assert.equal(await pick(der,'كشف جديد'),derP,'saved consult default «كشف جلدية بالجهاز» used');
 // exact non-consult match: only when the Masa text is not a consultation
 assert.equal(await pick(phys,'جلسة علاج طبيعي'),session,'exact non-consult name + non-consult text → used');
 assert.equal(await pick(phys,'جلسه علاج  طبيعى'),session,'normalised exact match');
 assert.equal(await pick(phys,'جلسة'),physK,'non-consult PREFIX match ignored → consult');
 assert.equal(await pick(sher,'كشف غرز جراحية عادية (حتى ٥ غرز)'),sherK,'no exact match; consult text → consult');
 assert.equal(await pick(sher,'غرز جراحية عادية (حتى ٥ غرز)'),ghorz,'exact procedure named by Masa → used');
 assert.equal(await pick(phys,'كشف'),physK,'consult text → consult, never the session');
 // is_home never auto-picked (name match, saved, most used, department)
 assert.equal(await pick(home),intK,'«كشف منزلي» never auto-picked');
 assert.equal(await pick(home,'كشف منزلي'),intK,'even when Masa names it exactly');
 for(let i=0;i<4;i++)await q("insert into clinic_reception.appointments(provider_id,service_id) values($1,$2)",[home,homeK]);
 assert.equal(await pick(home),intK,'most used home service skipped');
 await q("insert into clinic_reception.auto_book_services(provider_id,service_code,set_by) values($1,'0000400',$2)",[home,staffA]);
 assert.equal(await pick(home),intK,'saved home default skipped');
 await q("update clinic_reception.services set active=false where id=$1",[intK]);
 assert.equal(await pick(home),null,'only a home كشف left → NULL (staff review), not the home service');
 await q("update clinic_reception.services set active=true where id=$1",[intK]);
 // set_service as the reception staff member
 await db.exec(`select set_config('request.jwt.claim.sub','${staffU}',false)`);
 const rpc=async(a,p)=>(await one("select public.clinic_reception_auto_book($1,$2,$3) r",[ws,a,p])).r;
 await assert.rejects(()=>rpc('set_service',{id:bk,service_id:ghorz}),/اختار خدمة كشف أو استشارة أو متابعة/,'set_service refuses غرز');
 await assert.rejects(()=>rpc('set_service',{id:bk,service_id:homeK}),/اختار خدمة كشف أو استشارة أو متابعة/,'set_service refuses a home service');
 assert.equal((await one("select count(*)::int n from clinic_reception.auto_book_services where provider_id=$1",[sher])).n,0,'nothing saved on refusal');
 const ok=await rpc('set_service',{id:bk,service_id:sherK});assert.equal(ok.state,'pending');
 assert.equal((await one("select service_code from clinic_reception.auto_book_services where provider_id=$1",[sher])).service_code,'0000100','consult saved');
 const L=await rpc('list',{});const names=L.services.map(s=>s.name);
 assert(names.includes('كشف جراحة عامة')&&names.includes('استشارة جراحة'),'consults listed');
 for(const bad of ['غرز جراحية عادية (حتى ٥ غرز)','جلسة علاج طبيعي','كشف منزلي','كشف منزلي باطنة'])assert(!names.includes(bad),'not listed: '+bad);
 await db.exec(`select set_config('request.jwt.claim.sub','',false)`);
 // sync_catalog: re-version keeps is_home
 await q("update public.pricing_services set name='كشف منزلي باطنة (معدل)' where id=$1",[ps]);await q("select clinic_reception.sync_catalog($1)",[ws]);
 const v2=await one("select version,is_home,active from clinic_reception.services where code='0000500' order by version desc limit 1");
 assert.deepEqual(v2,{version:2,is_home:true,active:true},'is_home carried to the new version');
 const ps2='00000000-0000-4000-8000-0000000000f2';await q("insert into public.pricing_services values($1,'كشف باطنة جديد','0000501','الباطنة',15)",[ps2]);await q("select clinic_reception.sync_catalog($1)",[ws]);
 assert.equal((await one("select is_home from clinic_reception.services where code='0000501'")).is_home,false,'a new non-home service stays non-home');
 // second run refused
 await assert.rejects(()=>db.exec(MIG),/تم تطبيق هذا الملف من قبل/);
 // rollback
 await db.exec(fs.readFileSync('supabase/rollbacks/20261126040000_auto_book_consult_guard.rollback.sql','utf8'));
 await q("insert into clinic_reception.auto_book_services(provider_id,service_code,set_by) values($1,'0000200',$2) on conflict (provider_id) do update set service_code=excluded.service_code",[phys,staffA]);
 assert.equal(await pick(phys,null),session,'rollback restores v3 (saved default of any kind)');
 assert.equal(await pick(home),homeK,'rollback: v3 uses the saved home default again');
 assert.equal((await one("select count(*)::int n from clinic_reception.auto_time_saved_defs where name like '%consult_guard'")).n,0);
 assert.equal((await one("select to_regprocedure('clinic_reception.auto_book_clear_bad_defaults()') r")).r,null);
 await db.exec(`select set_config('request.jwt.claim.sub','${staffU}',false)`);
 await q("insert into clinic_reception.auto_book_services(provider_id,service_code,set_by) values($1,'0000100',$2) on conflict (provider_id) do nothing",[sher,staffA]);
 const bk2=(await one("insert into clinic_reception.external_bookings(state,review_kind,provider_id) values('review','service',$1) returning id",[sher])).id;
 assert.equal((await rpc('set_service',{id:bk2,service_id:ghorz})).state,'pending','rollback: set_service accepts any service again');
 assert(( await rpc('list',{})).services.some(s=>s.name==='جلسة علاج طبيعي'),'rollback: full list');
 await q("update public.pricing_services set name='كشف منزلي باطنة 3' where id=$1",[ps]);await q("select clinic_reception.sync_catalog($1)",[ws]);
 assert.equal((await one("select is_home from clinic_reception.services where code='0000500' order by version desc limit 1")).is_home,false,'rollback: old sync_catalog (drops is_home)');
 console.log('PASS auto-book consult guard: Masa «كشف» + saved «غرز» → the doctor\'s كشف; consult saved default kept; exact non-consult match only for non-consult text; home services never auto-picked; set_service refuses غرز / home and lists consults only; bad defaults cleared with audit, idempotent; is_home survives a re-version; second run refused; rollback restores.');
})().catch(e=>{console.error(e);process.exit(1);});
