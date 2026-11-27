// masa-auto-service-guard (main chat 7, 2026-11-27, after «كشف ماسا بيتحول لكشف أخصائي الدم والمناعة»): a STANDING CI guard.
// The auto picker (clinic_reception.auto_time_service) must NEVER return a service of a department the doctor is not in
// (home department / provider_departments / an explicit scope row), whatever text Masa sends and whatever saved default exists.
//  1) Builds the CURRENT picker chain: the base functions + 20261126050000 + EVERY later migration that touches the picker
//     (serves_service / auto_time_service / provider_serves_code / auto_book_service / consult_*). A future migration that touches
//     them is picked up automatically, so a regression turns CI red.
//  2) Fixture: 6 departments, each with several basic (كشف / استشارة / متابعة) services incl. «أخصائي» ones; doctors of every
//     department, one with an extra department, one with a cross-department scope row, one restricted; saved defaults pointing to
//     another department. Every doctor × every Masa text → pick is NULL or inside his departments.
//  3) tests/masa-auto-service-live-check.sql (the live rolled-back check) runs here on the same fixture: every row ok.
//  4) Every migration from 20261127310000 on that touches the picker must be covered by a tests/*-live-rollback.sql that pastes
//     the masa-auto-service-check block VERBATIM (so the hub's dry-run re-checks the real Masa bookings of the last 7 days).
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const prefix=src.slice(0,cut).replace('await boot()',"await boot(['reception_consultation_eligibility','reception_provider_service_scopes','reception_booking_confirm_duration','reception_weekly_schedule_walk_in','reception_basic_services_readiness','reception_masa_links_fallback_booking','reception_booking_gap','reception_manual_overbook','reception_lab_units','reception_booking_qty_continuation_no_answer','reception_arrival_sessions','booking_service_later','provider_scope_from_contracts'])").replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const M=path.join(__dirname,'..','supabase','migrations')+'/';
const fnSrc=(file,name)=>{const s=fs.readFileSync(M+file,'utf8'),i=s.indexOf('create function clinic_reception.'+name+'(');assert(i>=0,name);const j=s.indexOf('$$;',s.indexOf('$$',s.indexOf(' as $$',i)+6))+3;return s.slice(i,j);};
const autoChain=[fnSrc('20261121100000_auto_book_masa_service_name.sql','service_name_key'),fnSrc('20261120130000_reception_auto_book.sql','auto_book_service'),
 ...['is_consult_name','consult_kind','consult_pickable','consult_rank','serves_service'].map(n=>fnSrc('20261124210000_auto_book_consult_only.sql',n))];
const v4=(()=>{const s=fs.readFileSync(M+'20261126040000_auto_book_consult_guard.sql','utf8'),i=s.indexOf('create or replace function clinic_reception.auto_time_service');return s.slice(i,s.indexOf('end $$;',i)+7);})();
const TOUCH=/clinic_reception\.(serves_service|auto_time_service|provider_serves_code|auto_book_service|auto_book_service_for|consult_kind|consult_pickable|consult_rank)\s*\(/;
const DEF=/create (or replace )?function clinic_reception\.(serves_service|auto_time_service|provider_serves_code|auto_book_service|auto_book_service_for|consult_kind|consult_pickable|consult_rank)\(|alter function clinic_reception\.(serves_service|auto_time_service|provider_serves_code)\b/;
const later=fs.readdirSync(M).filter(f=>f.endsWith('.sql')&&f>'20261126050000_restricted_doctor_scope.sql').sort().filter(f=>DEF.test(fs.readFileSync(M+f,'utf8')));
assert(later.includes('20261127310000_auto_pick_own_department.sql'),'the own-department fix is part of the chain');
// (4) coverage of the live check: every picker migration from the fix on has a live rollback with the check block verbatim
const LC=fs.readFileSync(path.join(__dirname,'masa-auto-service-live-check.sql'),'utf8');
const blk=(t)=>{const i=t.indexOf('-- >>> BEGIN masa-auto-service-check'),j=t.indexOf('-- >>> END masa-auto-service-check <<<');return i>=0&&j>i?t.slice(i,j):null;};
const CHECK=blk(LC);assert(CHECK,'live check block markers');
const lives=fs.readdirSync(__dirname).filter(f=>f.endsWith('-live-rollback.sql')).map(f=>[f,fs.readFileSync(path.join(__dirname,f),'utf8')]);
for(const f of later.filter(f=>f>='20261127310000')){
  const cov=lives.filter(([n,t])=>t.includes('supabase/migrations/'+f));
  assert(cov.length,'no tests/*-live-rollback.sql pastes '+f+' — add one with the masa-auto-service-check block');
  assert(cov.some(([n,t])=>blk(t)===CHECK),f+': its live rollback must paste the masa-auto-service-check block from tests/masa-auto-service-live-check.sql verbatim (after the body)');
}
const body=`
{const q=async(sql,a)=>{const r=await owner(sql,a);await as(1);return r;};await as(1);
await db.exec('reset role');
await db.exec("alter table clinic_reception.services add column if not exists is_home boolean not null default false;create table clinic_reception.auto_book_services(provider_id uuid primary key,service_code text not null,set_by uuid,set_at timestamptz not null default now());");
for(const t of ${JSON.stringify(autoChain)})await db.exec(t.endsWith(';')?t:t+';');
await db.exec(${JSON.stringify(v4)});
await db.exec(require('fs').readFileSync(${JSON.stringify(M+'20261126050000_restricted_doctor_scope.sql')},'utf8'));
// live auto-book entry points are not in this harness: stubs with the EXACT live anchors (picker migrations patch them)
await db.exec(\`create table if not exists clinic_reception.external_bookings(id uuid primary key default gen_random_uuid(),source text not null,provider_id uuid,needed_service text,appointment_id uuid,public_patient_id uuid,created_at timestamptz not null default now(),day date not null default current_date,state text not null default 'pending',review_kind text,reason text,attempts int not null default 0,updated_at timestamptz not null default now());
create or replace function clinic_reception.cairo_day(t timestamptz) returns date language sql stable as $f$ select (t at time zone 'Africa/Cairo')::date $f$;
create function clinic_reception.auto_book_one(p_id uuid) returns uuid language plpgsql as $f$ declare ws uuid; b record; begin
  select e.* into b from clinic_reception.external_bookings e where e.id = p_id; select workspace_id into ws from clinic_reception.providers where id = b.provider_id;
  return clinic_reception.auto_time_service(ws, b.provider_id, b.needed_service); end $f$;
create function clinic_reception.auto_book_place_day_only(p_id uuid, p_workspace uuid) returns uuid language plpgsql as $f$ declare b record; begin
  select e.* into b from clinic_reception.external_bookings e where e.id = p_id;
  return clinic_reception.auto_time_service(p_workspace, b.provider_id, b.needed_service); end $f$;\`);
for(const f of ${JSON.stringify(later)})await db.exec(require('fs').readFileSync(${JSON.stringify(M)}+f,'utf8'));
await as(1);
const D=['باطنة','جلدية','امراض الدم','اطفال','علاج طبيعي','الاسنان'];
const svc={};let n=0;
const mk=async(name,dept,min)=>{const code='G'+(++n);await cmd(live,'service',{code,name,department:dept,price:200,minutes:min,bom:[]});const id=(await snap(live)).services.find(x=>x.code===code).id;svc[id]={code,dept,name};return id;};
// every department gets basics; the SHORTEST, best-ranked «كشف أخصائي…» lives in «امراض الدم» (the live bug's winner)
await mk('كشف أخصائي أمراض الدم والمناعة','امراض الدم',5);await mk('متابعة أمراض الدم','امراض الدم',5);
await mk('كشف استشاري باطنة','باطنة',20);await mk('كشف استشاري قلب','باطنة',25);await mk('استشارة باطنة','باطنة',15);await mk('رسم قلب','باطنة',5);
await mk('كشف جلدية','جلدية',15);await mk('كشف جلدية تجميل','جلدية',20);await mk('ليزر دايود 1000 نبضة','جلدية',10);
await mk('كشف أخصائي أطفال','اطفال',10);await mk('متابعة أطفال','اطفال',10);
await mk('جلسة علاج طبيعي','علاج طبيعي',30);
await mk('كشف أسنان','الاسنان',15);await mk('حشو عصب','الاسنان',30);
const prov=async(name,dept)=>(await cmd(live,'provider',{name,department:dept,branch:'حدائق الأهرام'})).id;
const P={};for(const d of D)P[d]=await prov('د. '+d,d);
const extra=await prov('د. باطنة + أطفال','باطنة');await q("insert into clinic_reception.provider_departments(provider_id,department) values($1,'اطفال')",[extra]);
const scoped=await prov('د. علاج طبيعي + كشف دم','علاج طبيعي');
const bloodCode=Object.values(svc).find(s=>s.name.includes('الدم والمناعة')).code;
await q("insert into clinic_reception.provider_service_scopes(provider_id,service_code) values($1,$2)",[scoped,bloodCode]);
const restricted=await prov('د. جلدية ليزر بس','جلدية');
await q("insert into clinic_reception.provider_service_scopes(provider_id,service_code) values($1,$2)",[restricted,Object.values(svc).find(s=>s.name.startsWith('ليزر')).code]);
await db.exec('reset role');await db.query("insert into clinic_reception.provider_restricted_departments_set(provider_id,department,note) values($1,'جلدية','ليزر بس')",[restricted]);await as(1);
const all=[...Object.values(P),extra,scoped,restricted];
const member=async(p,id)=>(await q('select (exists(select 1 from clinic_reception.providers x where x.id=$1 and x.department=$2) or exists(select 1 from clinic_reception.provider_departments d where d.provider_id=$1 and d.department=$2) or exists(select 1 from clinic_reception.provider_service_scopes sc where sc.provider_id=$1 and sc.service_code=$3)) v',[p,svc[id].dept,svc[id].code]))[0].v;
const TEXTS=['كشف جديد','كشف','استشارة','متابعة','كشف أخصائي أمراض الدم والمناعة','كشف أخصائي أطفال','كشف استشاري باطنة','متابعة أمراض الدم','',null,'رسم قلب'];
const check=async(tag)=>{let picks=0;for(const p of all)for(const t of TEXTS){
  const v=(await q('select clinic_reception.auto_time_service($1,$2,$3) v',[live,p,t]))[0].v;if(!v)continue;picks++;
  assert(svc[v],'picked a fixture service');assert(await member(p,v),tag+': doctor '+p+' text «'+t+'» → «'+svc[v].name+'» ['+svc[v].dept+'] is OUTSIDE his departments');}
 assert(picks>0,tag+': the picker still picks clear matches (not all NULL)');};
await check('plain');
// owner 2026-11-27: no clear match → NULL (staff choose); auto_book_pick then gives ONLY the doctor's department placeholder
if(${JSON.stringify(later)}.length){await db.exec('reset role');for(const d of D)await db.query('select clinic_reception.service_later_id($1,$2)',[live,d]);await as(1);
 for(const p of all)for(const t of TEXTS){const v=(await q('select clinic_reception.auto_book_pick($1,$2,$3) v',[live,p,t]))[0].v;if(!v)continue;
  const r=(await q('select s.placeholder,s.department,(select department from clinic_reception.providers where id=$2) home from clinic_reception.services s where s.id=$1',[v,p]))[0];
  if(r.placeholder)assert.equal(r.department,r.home,'auto_book_pick placeholder is the doctor\\'s own department');else assert(await member(p,v),'auto_book_pick outside the doctor\\'s departments');}
 assert.equal((await q("select clinic_reception.auto_time_service($1,$2,'كشف جديد') v",[live,P['باطنة']]))[0].v,null,'two consults of his own → NULL (no guessing)');}
// saved defaults pointing to another department must be ignored
await db.exec('reset role');
for(const p of Object.values(P))await db.query("insert into clinic_reception.auto_book_services(provider_id,service_code) values($1,$2) on conflict (provider_id) do update set service_code=excluded.service_code",[p,bloodCode]);
await as(1);await check('saved default = another department');
// most-used: past bookings of the wrong (cross-department) consult must not be repeated
const date=new Date(Date.now()+86400000).toISOString().slice(0,10);let slot=6*60;const at=()=>{slot+=20;return date+'T'+String(Math.floor(slot/60)).padStart(2,'0')+':'+String(slot%60).padStart(2,'0')+':00Z';};
const bloodId=Object.keys(svc).find(id=>svc[id].code===bloodCode);
for(const p of [P['باطنة'],P['جلدية']]){await cmd(live,'availability',{provider_id:p,starts_at:date+'T06:00Z',ends_at:date+'T22:00Z'});for(let i=0;i<3;i++)await cmd(live,'book',{patient_id:pat,provider_id:p,service_id:bloodId,starts_at:at(),same_day_ok:true});}
await check('most used = another department');
// the explicit scope row IS honoured, and the extra department is used
assert.equal((await q("select clinic_reception.auto_time_service($1,$2,'كشف جديد') v",[live,scoped]))[0].v,bloodId,'explicit scope row honoured');
assert.equal(svc[(await q("select clinic_reception.auto_time_service($1,$2,'كشف أخصائي أطفال') v",[live,extra]))[0].v].dept,'اطفال','extra department used');
// (3) the live check SQL on this fixture: Masa rows for every doctor
await db.exec('reset role');
for(const p of all)for(const t of TEXTS)await db.query("insert into clinic_reception.external_bookings(source,provider_id,needed_service) values('masa',$1,$2)",[p,t]);
{const res=await db.exec(${JSON.stringify(LC)}),sum=res[res.length-2].rows;if(process.env.SHOW_LIVE)console.log(sum);
 assert.equal(sum.length,3,'live check rows');assert.deepEqual(sum.filter(r=>!r.ok),[],'live check: every row ok');
 assert(Number(sum[0].actual.split(' ')[0])===all.length*TEXTS.length,'live check re-picked every Masa row');}
assert.equal((await db.query("select to_regclass('pg_temp.masa_chk') t")).rows[0].t,null,'live check rolled back');
await db.close();console.log('PASS masa-auto-service-guard: '+all.length+' doctors × '+TEXTS.length+' Masa texts (plain / saved default / most used of another department) — the auto picker never leaves the doctor\\'s departments; live check ok; chain = 20261126050000 + '+${JSON.stringify(later)}.join(', '));}})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(__dirname,'.masa-guard-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
