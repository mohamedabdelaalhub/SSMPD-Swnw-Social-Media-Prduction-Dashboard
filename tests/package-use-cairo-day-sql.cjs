// 20261125060000 (owner 2026-11-25 «اظبط استخدام الباكج كمان بتاريخ القاهرة»): executing a package session checks the expiry
// against the CAIRO date, not the server date. The session time zone is set so that the server date differs from Cairo's
// (UTC+14 after Cairo noon, UTC−10 before), then the same package is executed before and after the patch. Sample data only.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs'),{randomUUID}=require('crypto');
(async()=>{const {db,as,rpc,id}=await boot(['reception_services_packages','reception_contracts_controls']);
 const w=await rpc('clinic_reception_bootstrap'),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const ago=n=>new Date(Date.parse(date)-n*86400000).toISOString().slice(0,10);
 const cmd=(a,p,t=randomUUID())=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:t}),snap=()=>rpc('clinic_reception_snapshot',{p_workspace:w,p_from:date,p_to:date});
 const q=async(sql,a,who=3)=>{await db.exec('reset role');const r=(await db.query(sql,a)).rows;await as(who);return r;};
 let s=await snap();const patient=s.patients[0].id,provider=s.providers[0].id,dept=s.providers[0].department;
 await cmd('member',{admin_id:id(2),capabilities:['view','manage','review','warehouse','execute','collect','book']});
 await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
 const svc=(await cmd('service',{code:'LZ1',name:'جلسة ليزر تجربة',department:dept,price:1200,minutes:20,bom:[]})).id;
 const ag=(await cmd('agreement',{provider_id:provider,service_code:'LZ1',rate:20,deduct_material_cost:false,from:ago(1),to:'2030-01-01',reference:'AG1'})).id;await as(2);await cmd('agreement_review',{id:ag,approve:true});await as(1);
 await cmd('availability',{provider_id:provider,starts_at:date+'T04:00:00Z',ends_at:date+'T21:00:00Z'});
 const tpl=(await cmd('template',{code:'PK',name:'باكج ليزر تجربة',price:'4000',visits:4,validity_days:120,terms:'تجربة',lines:[1,2,3,4].map(n=>({visit_no:n,service_id:svc,quantity:'1'}))})).id;
 await as(3);
 // one package session on an arrived visit (two orders: one executed before the patch, one after)
 const P=(await cmd('package_sell',{patient_id:patient,template_id:tpl})).id;
 await cmd('collect',{patient_id:patient,package_id:P,method:'wallet',reference:'W-1',amount:'4000'});
 const ents=(await q('select id from clinic_reception.entitlements where package_id=$1 order by visit_no',[P])).map(r=>r.id);
 const order=async(n,at)=>{await as(1);const ap=(await cmd('book',{patient_id:patient,provider_id:provider,service_id:svc,starts_at:date+'T'+at+':00Z',same_day_ok:true})).id;await as(3);
  await cmd('arrive',{id:ap});const s2=await snap();const v=s2.visits.find(x=>x.appointment_id===ap);const o=s2.orders.find(x=>x.visit_id===v.id&&x.status==='ordered');
  await q('update clinic_reception.orders set entitlement_id=$2, price=1000 where id=$1',[o.id,ents[n]]);return o.id;};
 const o1=await order(0,'08:00'),o2=await order(1,'09:00');
 // server date ≠ Cairo date
 const cairoHour=+new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',hour:'2-digit',hour12:false}).format(new Date());
 const ahead=cairoHour>=12,tz=ahead?'Pacific/Kiritimati':'Pacific/Honolulu';
 await db.exec(`set timezone='${tz}'`);
 const d=(await q("select current_date::text srv, (now() at time zone 'Africa/Cairo')::date::text cairo"))[0];assert.notEqual(d.srv,d.cairo,'test needs server date ≠ Cairo date');
 // ahead (server = Cairo + 1): a package expiring TODAY in Cairo must be usable; behind (server = Cairo − 1): one that expired YESTERDAY must not
 const exp=ahead?d.cairo:new Date(Date.parse(d.cairo)-864e5).toISOString().slice(0,10);
 await q('update clinic_reception.packages set expires_on=$2 where id=$1',[P,exp]);
 const run=o=>cmd('execute',{id:o}).then(()=>'ok',e=>e.message);
 const before=await run(o1);
 assert.equal(before,ahead?'رصيد الباكج غير متاح':'ok','old behaviour (server date) reproduced in '+tz);
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/migrations/20261125060000_package_use_cairo_day.sql','utf8'));
 await assert.rejects(()=>db.exec(fs.readFileSync('supabase/migrations/20261125060000_package_use_cairo_day.sql','utf8')),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
 await as(3);
 const after=await run(ahead?o1:o2);
 assert.equal(after,ahead?'ok':'رصيد الباكج غير متاح','Cairo date: '+(ahead?'expires today in Cairo → usable':'expired yesterday in Cairo → refused'));
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261125060000_package_use_cairo_day.rollback.sql','utf8'));
 assert.equal((await db.query("select to_regclass('clinic_reception.package_use_cairo_saved') t")).rows[0].t,null,'rollback cleans up');
 console.log('PASS package use Cairo day ('+tz+', server '+d.srv+' / Cairo '+d.cairo+'): old server-date check reproduced; after the patch a package session follows the Cairo date; idempotent; rollback restores.');
})().catch(e=>{console.error(e);process.exit(1);});
