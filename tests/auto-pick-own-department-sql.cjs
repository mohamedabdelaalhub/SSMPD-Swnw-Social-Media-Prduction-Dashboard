// 20261127310000 «كشف ماسا بيتحول لكشف أخصائي الدم والمناعة» (owner bug 2026-11-27, via main chat 7 from Mazen). On the real
// reception functions (reception-bridge boot + the live chain + 20261126050000 applied): reproduces the bug (a doctor of «باطنة»
// gets «كشف أخصائي أمراض الدم والمناعة» of another department for a Masa «كشف جديد»), then proves the fix: the auto picker only
// takes services of the doctor's own departments (home / extra / scope row), a restricted department still offers only its scoped
// codes, a doctor with no consult of his own goes to staff review (NULL), manual booking of another department's basic service is
// still allowed; the live dry-run runs; second run refused; rollback restores 20261126050000's serves_service.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const prefix=src.slice(0,cut).replace('await boot()',"await boot(['reception_consultation_eligibility','reception_provider_service_scopes','reception_booking_confirm_duration','reception_weekly_schedule_walk_in','reception_basic_services_readiness','reception_masa_links_fallback_booking','reception_booking_gap','reception_manual_overbook','reception_lab_units','reception_booking_qty_continuation_no_answer','reception_arrival_sessions','booking_service_later','provider_scope_from_contracts'])").replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const M=path.join(__dirname,'..','supabase','migrations')+'/',R=path.join(__dirname,'..','supabase','rollbacks')+'/';
const fnSrc=(file,name)=>{const s=fs.readFileSync(M+file,'utf8'),i=s.indexOf('create function clinic_reception.'+name+'(');assert(i>=0,name);const j=s.indexOf('$$;',s.indexOf('$$',s.indexOf(' as $$',i)+6))+3;return s.slice(i,j);};
const autoChain=[fnSrc('20261121100000_auto_book_masa_service_name.sql','service_name_key'),fnSrc('20261120130000_reception_auto_book.sql','auto_book_service'),
 ...['is_consult_name','consult_kind','consult_pickable','consult_rank','serves_service'].map(n=>fnSrc('20261124210000_auto_book_consult_only.sql',n))];
const v4=(()=>{const s=fs.readFileSync(M+'20261126040000_auto_book_consult_guard.sql','utf8'),i=s.indexOf('create or replace function clinic_reception.auto_time_service');return s.slice(i,s.indexOf('end $$;',i)+7);})();
const body=`
{const q=async(sql,a)=>{const r=await owner(sql,a);await as(1);return r;};await as(1);
const RDS=require('fs').readFileSync(${JSON.stringify(M+'20261126050000_restricted_doctor_scope.sql')},'utf8');
const MIG=require('fs').readFileSync(${JSON.stringify(M+'20261127310000_auto_pick_own_department.sql')},'utf8');
assert(MIG.indexOf("raise exception 'تم تطبيق هذا الملف من قبل'")<MIG.indexOf('\\nbegin;'),'already-applied guard sits before begin');
await db.exec('reset role');
await db.exec("alter table clinic_reception.services add column if not exists is_home boolean not null default false;create table clinic_reception.auto_book_services(provider_id uuid primary key,service_code text not null,set_by uuid,set_at timestamptz not null default now());");
for(const t of ${JSON.stringify(autoChain)})await db.exec(t.endsWith(';')?t:t+';');
await db.exec(${JSON.stringify(v4)});
// before 20261126050000 is applied: a refusal guard ('طبّق 20261126050000 أولاً')
await assert.rejects(()=>db.exec(MIG),/طبّق 20261126050000 أولاً|serves_service مش النسخة المتوقعة/);
await db.exec(RDS);
// live auto-book functions are not in this harness: stubs that carry the EXACT live anchors (the migration patches them to auto_book_pick)
await db.exec(\`create table if not exists clinic_reception.external_bookings(id uuid primary key default gen_random_uuid(),source text not null,provider_id uuid,needed_service text,appointment_id uuid,public_patient_id uuid,created_at timestamptz not null default now(),day date not null default current_date,state text not null default 'pending',review_kind text,reason text,attempts int not null default 0,updated_at timestamptz not null default now());
create or replace function clinic_reception.cairo_day(t timestamptz) returns date language sql stable as $f$ select (t at time zone 'Africa/Cairo')::date $f$;
create function clinic_reception.auto_book_one(p_id uuid) returns uuid language plpgsql as $f$ declare ws uuid; b record; begin
  select e.* into b from clinic_reception.external_bookings e where e.id = p_id; select workspace_id into ws from clinic_reception.providers where id = b.provider_id;
  return clinic_reception.auto_time_service(ws, b.provider_id, b.needed_service); end $f$;
create function clinic_reception.auto_book_place_day_only(p_id uuid, p_workspace uuid) returns uuid language plpgsql as $f$ declare b record; begin
  select e.* into b from clinic_reception.external_bookings e where e.id = p_id;
  return clinic_reception.auto_time_service(p_workspace, b.provider_id, b.needed_service); end $f$;\`);
await as(1);
const mk=async(code,name,dept,min=15)=>{await cmd(live,'service',{code,name,department:dept,price:200,minutes:min,bom:[]});return (await snap(live)).services.find(x=>x.code===code).id;};
const blood=await mk('BLD','كشف أخصائي أمراض الدم والمناعة','امراض الدم',10),
 kInt=await mk('KIN','كشف استشاري باطنة','باطنة',20),kInt2=await mk('KIN2','كشف استشاري قلب','باطنة',25),proc=await mk('ECH','رسم قلب','باطنة',10),
 kDerm=await mk('KDM','كشف جلدية','جلدية',15),kDerm2=await mk('KDM2','كشف جلدية تجميل','جلدية',20),lz=await mk('LZ1','ليزر دايود 1000 نبضة','جلدية'),
 nOwn=await mk('PHY','جلسة علاج طبيعي','علاج طبيعي',30);
const prov=async(name,dept)=>(await cmd(live,'provider',{name,department:dept,branch:'حدائق الأهرام'})).id;
const ahmed=await prov('د. أحمد تجريبي','باطنة'),derm=await prov('د. جلدية تجريبية','جلدية'),phys=await prov('أخصائي علاج طبيعي','علاج طبيعي');
const pick=async(p,n)=>(await q('select clinic_reception.auto_time_service($1,$2,$3) v',[live,p,n]))[0].v;
const servesCode=async(p,dept,code)=>(await q('select clinic_reception.provider_serves_code($1,$2,$3,null) v',[p,dept,code]))[0].v;
// the BUG (20261126050000 + v4): a doctor whose department has no single «كشف…» (so no implicit default) and no «أخصائي» consult
// gets the best-ranked «كشف أخصائي…» of the WHOLE clinic (consult_rank is ordered before «own department»)
assert.equal(await pick(ahmed,'كشف جديد'),blood,'bug reproduced: باطنة doctor → «كشف أخصائي أمراض الدم والمناعة»');
assert.equal(await pick(derm,'كشف جديد'),blood,'bug reproduced: جلدية doctor → blood consult');
assert.equal(await pick(phys,'كشف جديد'),blood,'bug reproduced: a department without a consult → blood consult');
// the live rolled-back dry-run: its body is the migration (minus begin / commit) and the whole file runs here, rolled back
const LIVE=require('fs').readFileSync(${JSON.stringify(path.join(__dirname,'auto-pick-own-department-live-rollback.sql'))},'utf8');
{const mk0=LIVE.indexOf('-- >>> BEGIN migration body'),i=LIVE.indexOf('<<<\\n',mk0)+4,j=LIVE.indexOf('\\n-- >>> END migration body <<<');assert(i>3&&j>i,'live markers');
 assert.equal(LIVE.slice(i,j),MIG.split('\\n').filter(l=>l!=='begin;'&&l!=='commit;').join('\\n').replace(/\\n+$/,''),'live body = migration');}
await db.exec('reset role');
// live-only pieces the dry-run READS (absent from the harness): a minimal external_bookings + one Masa row on a wrong booking
await db.exec("alter table public.patients add column if not exists patient_code text;alter table clinic_reception.workspaces add column if not exists mode text default 'live'");
{const d=new Date(Date.now()+2*86400000).toISOString().slice(0,10);await as(1);await cmd(live,'availability',{provider_id:ahmed,starts_at:d+'T06:00Z',ends_at:d+'T22:00Z'});
 const ap=(await cmd(live,'book',{patient_id:pat,provider_id:ahmed,service_id:blood,starts_at:d+'T10:00:00Z',same_day_ok:true})).id;await db.exec('reset role');
 await db.query("insert into clinic_reception.external_bookings(source,provider_id,needed_service,appointment_id) values('masa',$2,'كشف جديد',$1),('masa',$3,'كشف',null),('masa',$4,'استشارة',null)",[ap,ahmed,derm,phys]);}
await db.exec("alter table clinic_reception.appointments add column if not exists overbook boolean not null default false");
await db.exec(${JSON.stringify(fnSrc('20261122330000_masa_day_only_auto_time.sql','free_starts'))});
await db.query("select clinic_reception.service_later_id($1,'باطنة')",[live]);
await db.query("update clinic_reception.providers set name='د. أحمد مصطفى تجريبي' where id=$1",[ahmed]);
await db.query("insert into public.admins(id,email,name,role,active) values('f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb','mazen@test.local','مازن تجريبي','reception',true) on conflict (id) do nothing").catch(()=>{});
{const res=await db.exec(LIVE),sum=res[res.length-2].rows;if(process.env.SHOW_LIVE)console.log(sum);
 assert(sum.length>=6,'live summary rows');assert.deepEqual(sum.filter(r=>!r.ok),[],'every live step ok');
 assert(sum.some(r=>/^\\(c\\) after: picks outside/.test(r.step)&&r.actual==='0'));}
assert.equal((await db.query("select to_regclass('clinic_reception.auto_pick_saved_defs') t")).rows[0].t,null,'live script rolled back');
assert.equal((await db.query("select clinic_reception.auto_time_service($1,$2,'كشف جديد') v",[live,ahmed])).rows[0].v,blood,'still the bug after the dry-run');
// apply
await db.exec('reset role');await db.exec(MIG);await as(1);
// owner 2026-11-27 «لو مفيش خدمة مطابقة ينتظر لما الموظف يقوم باختيار خدمة»: 2 consults in his department → no guess
assert.equal(await pick(ahmed,'كشف جديد'),null,'fix: two consults of his own → NULL (staff choose), never another department');
assert.equal(await pick(derm,'كشف جديد'),null,'fix: two derm consults → NULL');
assert.equal(await pick(phys,'كشف جديد'),null,'fix: no consult in his own department → NULL');
assert.equal(await pick(phys,'جلسة علاج طبيعي'),nOwn,'fix: an exact non-consult name of his own department still used');
assert.equal(await pick(ahmed,'كشف استشاري قلب'),kInt2,'fix: the Masa text NAMES one of his services → that one');
assert.equal(await pick(ahmed,'رسم قلب'),proc,'an EXACT non-consult name (the text is not a consult) is still used, as before');
assert.notEqual(await pick(ahmed,'كشف'),proc,'never a procedure for a consult text');
// auto_book_pick: no clear service → the department placeholder «الخدمة تتحدد عند الحضور» (booked, staff choose at «وصل»)
await db.exec('reset role');const ph=(await db.query("select clinic_reception.service_later_id($1,'باطنة') v",[live])).rows[0].v;await as(1);
const bpick=async(p,n)=>(await q('select clinic_reception.auto_book_pick($1,$2,$3) v',[live,p,n]))[0].v;
assert.equal(await bpick(ahmed,'كشف جديد'),ph,'auto_book_pick: NULL → «الخدمة تتحدد عند الحضور» of his department');
assert.equal(await bpick(ahmed,'كشف استشاري باطنة'),kInt,'auto_book_pick: a clear match is used as is');
assert.equal(await bpick(phys,'كشف جديد'),null,'auto_book_pick: no placeholder in his department → NULL (old «اختار الخدمة» review)');
{await db.exec('reset role');const r=await db.query("insert into clinic_reception.external_bookings(source,provider_id,needed_service) values('masa',$1,'كشف جديد') returning id",[ahmed]);
 assert.equal((await db.query('select clinic_reception.auto_book_one($1) v',[r.rows[0].id])).rows[0].v,ph,'auto_book_one patched → placeholder');
 assert.equal((await db.query('select clinic_reception.auto_book_place_day_only($1,$2) v',[r.rows[0].id,live])).rows[0].v,ph,'day-only path patched → placeholder');
 await db.query('delete from clinic_reception.external_bookings where id=$1',[r.rows[0].id]);await as(1);}
// a saved STAFF choice of his own department is used; one of another department is ignored
await q("insert into clinic_reception.auto_book_services(provider_id,service_code) values($1,'BLD')",[ahmed]);
assert.equal(await pick(ahmed,'كشف جديد'),null,'saved default of another department is ignored');
await q("update clinic_reception.auto_book_services set service_code='KIN' where provider_id=$1",[ahmed]);
assert.equal(await pick(ahmed,'كشف جديد'),kInt,'saved staff choice of his own department is used');
await q("delete from clinic_reception.auto_book_services where provider_id=$1",[ahmed]);
// the ONLY consultation he serves is used (explicit scope row on the blood consult)
await q("insert into clinic_reception.provider_service_scopes(provider_id,service_code) values($1,'BLD')",[phys]);
assert.equal(await pick(phys,'كشف جديد'),blood,'explicit scope row: his only consultation');
// restricted department: scoped code by name still picked; two basics → NULL
await q("insert into clinic_reception.provider_service_scopes(provider_id,service_code) values($1,'LZ1')",[derm]);
await db.exec('reset role');await db.query("insert into clinic_reception.provider_restricted_departments_set(provider_id,department,note) values($1,'جلدية','ليزر بس')",[derm]);await as(1);
assert.equal(await pick(derm,'ليزر دايود 1000 نبضة'),lz,'restricted: scoped code still picked by name');
assert.equal(await pick(derm,'كشف جديد'),null,'restricted: two basics → NULL (staff choose)');
// manual booking rule unchanged: basics of any department stay open
assert.equal(await servesCode(ahmed,'امراض الدم','BLD'),true,'manual: blood consult still bookable for the باطنة doctor');
const date=new Date(Date.now()+86400000).toISOString().slice(0,10);
await cmd(live,'availability',{provider_id:ahmed,starts_at:date+'T06:00Z',ends_at:date+'T22:00Z'});
assert(await cmd(live,'book',{patient_id:pat,provider_id:ahmed,service_id:blood,starts_at:date+'T09:00:00Z',same_day_ok:true}).then(r=>r.id),'manual book of the blood consult still works');
// second run refused
await db.exec('reset role');await assert.rejects(()=>db.exec(MIG),/تم تطبيق هذا الملف من قبل/);
// rollback restores 20261126050000's serves_service (the bug comes back — proof the rollback is exact)
await db.exec(require('fs').readFileSync(${JSON.stringify(R+'20261127310000_auto_pick_own_department.rollback.sql')},'utf8'));
assert.equal((await db.query("select to_regclass('clinic_reception.auto_pick_saved_defs') t")).rows[0].t,null,'rollback dropped the table');
assert.match((await db.query("select pg_get_functiondef('clinic_reception.serves_service(uuid,text,text)'::regprocedure) d")).rows[0].d,/provider_serves_code\\(p_provider, p_department, p_code, null\\)\\s*\\$/);
await db.exec('delete from clinic_reception.auto_book_services');await as(1);
assert.equal(await pick(ahmed,'كشف جديد'),blood,'after rollback: the old behaviour is back');
await db.exec('reset role');assert.equal((await db.query("select count(*)::int n from pg_proc where proname='auto_book_pick'")).rows[0].n,0,'rollback dropped auto_book_pick');
assert.doesNotMatch((await db.query("select pg_get_functiondef('clinic_reception.auto_book_one(uuid)'::regprocedure) d")).rows[0].d,/auto_book_pick/,'auto_book_one restored');
await db.close();console.log('PASS auto pick own department: bug reproduced (cross-department «كشف أخصائي…»), fix keeps the doctor\\'s own departments / scope rows, restricted rule kept, NULL → staff review, manual basics open, live dry-run ok, second run refused, rollback exact');}})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(__dirname,'.auto-pick-own-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
