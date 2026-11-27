// 20261126050000 «طبيب مقيّد بخدمات محددة» (owner 2026-11-25, Dr Dalia EMP-000036: «الاسنان تقويم فقط … الجلدية ليزر فقط»)
// (EXPLICIT opt-in per provider + department) on the real reception functions (reception-bridge boot + the live chain up to booking_service_later / provider_scope_from_contracts,
// serves_service + auto_time_service v4 from their migrations). Proves: an unrestricted doctor is unchanged; a department listed for the
// provider in provider_restricted_departments_set is restricted (book / walk-in / reschedule / order_add / execution / arrival / auto-book / snapshot
// / readiness) to the scoped codes with a clear Arabic refusal; a member department without such rows keeps all its services; an
// provider with scope rows but NOT in clinic_reception.provider_restricted_departments_set (the home-nurse case) is unchanged; basic services stay open; second run refused; rollback restores.
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
const MIG=require('fs').readFileSync(${JSON.stringify(M+'20261126050000_restricted_doctor_scope.sql')},'utf8');
assert(MIG.indexOf("raise exception 'تم تطبيق هذا الملف من قبل'")<MIG.indexOf('\\nbegin;'),'already-applied guard sits before begin');
// live pieces the migration needs: is_home, auto_book_services, serves_service + auto_time_service v4
await db.exec('reset role');
await db.exec("alter table clinic_reception.services add column if not exists is_home boolean not null default false;create table clinic_reception.auto_book_services(provider_id uuid primary key,service_code text not null,set_by uuid,set_at timestamptz not null default now());");
for(const t of ${JSON.stringify(autoChain)})await db.exec(t.endsWith(';')?t:t+';');
await db.exec(${JSON.stringify(v4)});
await as(1);
// fixture: dermatology (home) + dental (extra department) for Dalia; an unrestricted doctor; a home-nurse-like provider (scope row, not listed)
const mk=async(code,name,dept,min=15)=>{await cmd(live,'service',{code,name,department:dept,price:200,minutes:min,bom:[]});return (await snap(live)).services.find(x=>x.code===code).id;};
const lz=await mk('LZ1','ليزر دايود 1000 نبضة','جلدية'),lz2=await mk('LZ2','كانديلا 1000 نبضة','جلدية'),peel=await mk('PEEL','تقشير بارد','جلدية'),
 peelF=await mk('PEELF','جلسة متابعة تقشير','جلدية'),kj=await mk('KJ','كشف جلدية','جلدية'),
 ortho=await mk('ORT1','تركيب تقويم ثابت','الاسنان'),fill=await mk('FIL1','حشو عصب','الاسنان'),orthoK=await mk('ORTK','كشف تقويم','الاسنان');
const dalia=(await cmd(live,'provider',{name:'د. داليا تجريبية',department:'جلدية',branch:'حدائق الأهرام'})).id,otherProvider=(await cmd(live,'provider',{name:'د. عقد تلقائي',department:'جلدية',branch:'حدائق الأهرام'})).id;
await cmd(live,'availability',{provider_id:otherProvider,starts_at:date+'T06:00Z',ends_at:date+'T22:00Z'});
await q("insert into clinic_reception.provider_departments(provider_id,department) values($1,'الاسنان')",[dalia]);
await cmd(live,'availability',{provider_id:dalia,starts_at:date+'T06:00Z',ends_at:date+'T22:00Z'});
// the live dry-run looks for a free slot from 1 hour ahead: give her tomorrow too, so the test does not fail late at night (UTC ≥ 21:00)
{const t2=new Date(Date.parse(date+'T12:00:00Z')+86400000).toISOString().slice(0,10);await cmd(live,'availability',{provider_id:dalia,starts_at:t2+'T06:00Z',ends_at:t2+'T22:00Z'});}
let slot=6*60;const at=()=>{slot+=20;return date+'T'+String(Math.floor(slot/60)).padStart(2,'0')+':'+String(slot%60).padStart(2,'0')+':00Z';};
const book=(p,s,o={})=>cmd(live,'book',{patient_id:pat,provider_id:p,service_id:s,starts_at:at(),same_day_ok:true,...o}).then(r=>r.id);
const serves=async(p,code,dept=null)=>(await q('select clinic_reception.provider_serves_code($1,$2,$3,null) v',[p,dept,code]))[0].v;
const servesSvc=async(p,dept,code)=>(await q('select clinic_reception.serves_service($1,$2,$3) v',[p,dept,code]))[0].v;
const pick=async(p,needed)=>(await q('select clinic_reception.auto_time_service($1,$2,$3) v',[live,p,needed]))[0].v;
// before: membership opens every service (today's behaviour) — scope rows for Dalia: the laser codes (deliberate)
await q("insert into clinic_reception.provider_service_scopes(provider_id,service_code) values($1,'LZ1'),($1,'LZ2')",[dalia]);
const fillEarly=await book(dalia,fill);const peelEarly=await book(dalia,peel);
assert.equal(await servesSvc(dalia,'جلدية','PEEL'),true,'before: membership serves PEEL');
assert.equal(await pick(dalia,'جلسة متابعة تقشير'),peelF,'before: auto-book picks a non-laser derm service for her');
// the home-nurse case: a scope row set on purpose in his own department, but he is NOT listed → never restricted
await q("insert into clinic_reception.provider_service_scopes(provider_id,service_code) values($1,'LZ1')",[otherProvider]);
// the live rolled-back dry-run: its pasted body is the migration (minus begin / commit) and the whole file runs (syntax + flow) here
const LIVE=require('fs').readFileSync(${JSON.stringify(path.join(__dirname,'restricted-doctor-scope-live-rollback.sql'))},'utf8');
{const i=LIVE.indexOf('<<<\\n')+4,j=LIVE.indexOf('\\n-- >>> END migration body <<<');assert(i>3&&j>i,'live markers');
 assert.equal(LIVE.slice(i,j),MIG.split('\\n').filter(l=>l!=='begin;'&&l!=='commit;').join('\\n').replace(/\\n+$/,''),'live body = migration');}
await db.exec('reset role');await db.query("update clinic_reception.providers set doctor_key='EMP-000036' where id=$1",[dalia]);
{const res=await db.exec(LIVE),sum=res[res.length-2].rows;if(process.env.SHOW_LIVE)console.log(sum);
 assert(sum.length>=10,'live summary rows');const bad=sum.filter(r=>!r.ok);assert.deepEqual(bad,[],'every live step ok');
 assert(sum.some(r=>/after ops: dental non-basic/.test(r.step)&&/\\(1 of 2 matches/.test(r.expected)),'live: the basic STRONG match is not counted');
 assert(sum.some(r=>/non-laser derm/.test(r.step)),'live: book step ran');}
await db.query("update clinic_reception.providers set doctor_key=null where id=$1",[dalia]);
assert.equal((await db.query("select count(*)::int n from pg_proc where proname='provider_serves_code'")).rows[0].n,0,'live script rolled back');
// apply
await db.exec('reset role');await db.exec(MIG);await as(1);
// nobody is restricted on apply (the list is empty): Dalia still serves PEEL with her laser scope rows
assert.equal((await q('select count(*)::int n from clinic_reception.provider_restricted_departments_set'))[0].n,0);
assert.equal(await serves(dalia,'PEEL'),true,'scope rows alone never restrict');
await q("insert into clinic_reception.provider_restricted_departments_set(provider_id,department,note) values($1,'جلدية','اختبار: ليزر فقط')",[dalia]);
// unrestricted doctors unchanged
assert(await book(provider,peel),'unrestricted doctor books any service of his department');
assert(await book(otherProvider,peel),'scope row without a listed department does not restrict (home-nurse case)');
assert.equal(await serves(otherProvider,'PEEL'),true);assert.equal(await serves(provider,'FIL1'),false,'other department still refused');
// Dalia in dermatology: only the laser codes (+ basics)
await assert.rejects(()=>book(dalia,peel),/الطبيب خارج تخصص الخدمة — د\\. داليا تجريبية في قسم «جلدية» بيعمل خدمات محددة بس \\(2 خدمة\\)/,'non-laser derm refused with a clear message');
await assert.rejects(()=>cmd(live,'walk_in',{patient_id:pat,provider_id:dalia,service_id:peel}),/خدمات محددة بس/,'walk-in refused too');
assert(await book(dalia,lz),'laser booked');assert(await book(dalia,kj),'basic service stays open');
assert.equal(await serves(dalia,'PEEL'),false);assert.equal(await serves(dalia,'LZ2'),true);assert.equal(await serves(dalia,'KJ'),true);
assert.equal(await servesSvc(dalia,'جلدية','PEEL'),false,'serves_service (auto-book) follows the rule');
assert.notEqual(await pick(dalia,'جلسة متابعة تقشير'),peelF,'auto-book no longer picks it');
assert.equal(await pick(provider,'جلسة متابعة تقشير'),peelF,'unrestricted doctor: auto-book unchanged');
// Dalia in dental, not listed yet: every dental service (today's behaviour) — even with an ortho scope row
await q("insert into clinic_reception.provider_service_scopes(provider_id,service_code) values($1,'ORT1')",[dalia]);
assert.equal(await serves(dalia,'FIL1'),true);assert(await book(dalia,fill),'dental: all services until the department is listed');
// reschedule onto a refused service
await assert.rejects(()=>cmd(live,'reschedule',{id:fillEarly,service_id:peel,starts_at:at(),same_day_ok:true}),/خدمات محددة بس/,'reschedule refused');
// dental listed → restricted to her ortho scope rows
await q("insert into clinic_reception.provider_restricted_departments_set(provider_id,department,note) values($1,'الاسنان','اختبار: تقويم فقط')",[dalia]);
assert(await book(dalia,orthoK),'basic «كشف تقويم» stays open');
await assert.rejects(()=>book(dalia,fill),/في قسم «الاسنان» بيعمل خدمات محددة بس \\(1 خدمة\\)/,'non-ortho dental refused');
assert(await book(dalia,ortho),'ortho booked');
// order_add on her visit + execution gate on an order made before the restriction
const visit=(await cmd(live,'arrive',{id:fillEarly})).id;
await assert.rejects(()=>cmd(live,'order_add',{visit_id:visit,service_id:peel,provider_id:dalia,quantity:'1'}),/راجع الخدمة وطبيبها — .*خدمات محددة بس/,'order_add refused');
await cmd(live,'order_add',{visit_id:visit,service_id:lz,provider_id:dalia,quantity:'1'});
const s1=await snap(live),old=s1.orders.find(o=>o.visit_id===visit&&o.service_id===fill);assert(old,'the earlier dental order');
await assert.rejects(()=>cmd(live,'execute',{id:old.id,location_id:loc,materials:[],additional_confirmed:true}),/حدد الطبيب المنفذ من تخصص الخدمة — .*«الاسنان»/,'execution of a non-ortho dental order refused');
// arrival of a «الخدمة تتحدد عند الحضور» booking: placeholder booking still allowed, the chosen service must be hers
const later=(await cmd(live,'book',{patient_id:pat,provider_id:dalia,service_later:true,starts_at:at(),same_day_ok:true})).id;slot+=20;
await assert.rejects(()=>cmd(live,'arrive',{id:later,service_id:peel}),/مش من خدمات الدكتور ده — .*خدمات محددة بس/,'arrival with a non-laser service refused');
assert((await cmd(live,'arrive',{id:later,service_id:lz2})).id,'arrival with a laser service');
// snapshot + readiness
const s2=await snap(live);
assert.deepEqual(JSON.parse(JSON.stringify(s2.provider_restricted[dalia])),{'الاسنان':['ORT1'],'جلدية':['LZ1','LZ2']},'snapshot restriction map');
const sc=s2.provider_service_scopes[dalia];assert(sc.includes('ORT1')&&sc.includes('LZ1')&&!sc.includes('FIL1'),'extra-department codes cleaned: '+JSON.stringify(sc));
assert.equal(s2.provider_restricted[provider],undefined);assert.equal(s2.provider_restricted[otherProvider],undefined);
const rd=await call('clinic_reception_booking_readiness',[live]),rdD=rd.doctors.find(x=>x.id===dalia),rdP=rd.doctors.find(x=>x.id===provider);
assert.deepEqual(rdD.restricted,['الاسنان','جلدية']);assert.equal(+rdD.own_services,2,'own services = the 2 laser codes');
assert.equal(rdP.restricted,undefined);assert(+rdP.own_services>=5,'unrestricted own_services unchanged');
// ops script (supabase/ops/20261126050000_dalia_ortho_scopes.sql) on a stand-in EMP-000036: laser row was an automatic copy
const d2=(await cmd(live,'provider',{name:'د. داليا ops',department:'جلدية',branch:'حدائق الأهرام'})).id;
await db.exec('reset role');
await db.query("update clinic_reception.providers set doctor_key='EMP-000036' where id=$1",[d2]);
await db.query("insert into clinic_reception.provider_departments(provider_id,department) values($1,'الاسنان')",[d2]);
await db.query("insert into clinic_reception.provider_service_scopes(provider_id,service_code) values($1,'LZ1')",[d2]);
await db.query('delete from clinic_reception.provider_restricted_departments_set');  // the ops expects to be the only restriction
assert.equal((await db.query("select clinic_reception.provider_serves_code($1,null,'PEEL',null) v",[d2])).rows[0].v,true,'scope row alone: not restricted');
const OPS=require('fs').readFileSync(${JSON.stringify(path.join(__dirname,'..','supabase','ops','20261126050000_dalia_ortho_scopes.sql'))},'utf8');
await db.exec(OPS);
const sv2=async c=>(await db.query("select clinic_reception.provider_serves_code($1,null,$2,null) v",[d2,c])).rows[0].v;
assert.equal(await sv2('ORT1'),true);assert.equal(await sv2('FIL1'),false,'ops: dental = ortho only');
assert.equal(await sv2('PEEL'),false,'ops: claimed laser row restricts derm');assert.equal(await sv2('LZ1'),true);assert.equal(await sv2('KJ'),true,'basic open');
assert.deepEqual((await db.query("select department,note from clinic_reception.provider_restricted_departments_set where provider_id=$1 order by department",[d2])).rows,[{department:'الاسنان',note:'المالك 2026-11-25: تقويم فقط / ليزر فقط'},{department:'جلدية',note:'المالك 2026-11-25: تقويم فقط / ليزر فقط'}],'ops: her 2 restriction rows');
await db.exec(OPS);assert.equal((await db.query("select count(*)::int n from clinic_reception.provider_service_scopes where provider_id=$1",[d2])).rows[0].n,3,'ops re-run idempotent (LZ1 + ORT1 + basic ORTK)');
assert.equal((await db.query("select count(*)::int n from clinic_reception.provider_restricted_departments_set")).rows[0].n,2);
await db.exec(OPS.slice(0,OPS.lastIndexOf('commit;'))+'rollback;');
await as(1);
// second run refused
await db.exec('reset role');await assert.rejects(()=>db.exec(MIG),/تم تطبيق هذا الملف من قبل/);
// rollback restores today's behaviour
await db.exec(require('fs').readFileSync(${JSON.stringify(R+'20261126050000_restricted_doctor_scope.rollback.sql')},'utf8'));
assert.equal((await db.query("select count(*)::int n from pg_proc where proname in ('provider_serves_code','scope_refusal','provider_restricted_departments','snapshot_before_restricted_scope','booking_readiness_before_restricted','has_provider_service_scope_before_restricted')")).rows[0].n,0,'rollback dropped the helper');
assert.equal((await db.query("select count(*)::int n from pg_proc where proname='has_provider_service_scope'")).rows[0].n,1);
assert.equal((await db.query("select to_regclass('clinic_reception.provider_restricted_departments_set') t")).rows[0].t,null,'rollback dropped the restriction table');
assert.equal((await db.query("select clinic_reception.serves_service($1,'جلدية','PEEL') v",[dalia])).rows[0].v,true,'serves_service back');
await as(1);assert(await book(dalia,peel),'after rollback: membership opens PEEL again');assert(await book(dalia,fill));
assert.equal((await snap(live)).provider_restricted,undefined);
await db.close();console.log('PASS restricted doctor scope: nobody restricted on apply; unrestricted + scope-row-but-not-listed (home-nurse case) providers unchanged; a department listed in provider_restricted_departments_set restricts book / walk-in / reschedule / order_add / execution / arrival / auto-book / snapshot / readiness to the scoped codes with a clear Arabic refusal; dental open until listed, then ortho only; basics open (incl. a basic ortho match); ops script (ortho rows + 2 restriction rows, idempotent, dry-run) ok; second run refused; rollback restores.');}})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(__dirname,'.restricted-scope-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
