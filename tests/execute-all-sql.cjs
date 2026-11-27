// «تنفيذ الكل» + clear execute messages (mig 20261127270000, owner 2026-11-27 «موافق على تنفيذ الكل»). As a RECEPTION member (execute
// capability), real server functions (PGlite): two laser services in one visit on a device with a counter →
//   * single «تنفيذ» with an empty counter → «اكتب قراءة العداد قبل وبعد» (not «راجع القيمة والوحدة والدقة»); after < before → clear;
//     no minutes → clear; materials without a store → «اختار مخزن الصرف»;
//   * execute_many: one refusal → NOTHING executed and the message names the service; then both executed in one call with their own
//     device rows (chained counter), replay = no double execution; services of another visit refused; one service refused (use «تنفيذ»).
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs'),{randomUUID}=require('crypto');
(async()=>{const {db,as,rpc,id}=await boot(['reception_services_packages','reception_contracts_controls']);
 const w=await rpc('clinic_reception_bootstrap'),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const yday=new Date(Date.parse(date)-86400000).toISOString().slice(0,10);
 const snap=()=>rpc('clinic_reception_snapshot',{p_workspace:w,p_from:date,p_to:date}),cmd=(a,p,t=randomUUID())=>rpc('clinic_reception_command',{p_workspace:w,p_action:a,p_payload:p,p_token:t});
 const q=async(sql,a)=>{await db.exec('reset role');const r=(await db.query(sql,a)).rows;await as(3);return r;};
 let s=await snap();const provider=s.providers[0].id,dept=s.providers[0].department,pat=s.patients[0].id,loc=(s.locations[0]||{}).id;
 await cmd('member',{admin_id:id(2),capabilities:['view','manage','review','warehouse','execute','collect','book','finance_review']});
 await cmd('member',{admin_id:id(3),capabilities:['view','book','execute','collect']});
 const dev=(await cmd('device',{code:'CAND',name:'كانديلا (إزالة الشعر)',meter_kind:'shots'})).id;
 for(const [code,name,price,mins] of [['LZ-BK','ليزر كانديلا — بيكيني',190,15],['LZ-SH','ليزر كانديلا — شارب',50,5],['LZ-AX','ليزر كانديلا — تحت الإبط',140,5]]){
  await cmd('service',{code,name,department:dept,price,minutes:mins,requires_device:true,bom:[]});
  const ag=(await cmd('agreement',{provider_id:provider,service_code:code,rate:20,from:yday,to:'2030-01-01',reference:'AG-'+code})).id;await as(2);await cmd('agreement_review',{id:ag,approve:true});await as(1);}
 await cmd('availability',{provider_id:provider,starts_at:date+'T04:00:00Z',ends_at:date+'T21:00:00Z'});
 s=await snap();const sv=c=>s.services.find(x=>x.code===c).id;
 const app=(await cmd('book',{patient_id:pat,provider_id:provider,service_id:sv('LZ-BK'),starts_at:date+'T08:00Z',device_id:dev})).id;const visit=(await cmd('arrive',{id:app})).id;
 await cmd('order_add',{visit_id:visit,service_id:sv('LZ-SH'),provider_id:provider,quantity:1});await cmd('order_add',{visit_id:visit,service_id:sv('LZ-AX'),provider_id:provider,quantity:1});
 s=await snap();const ords=s.orders.filter(o=>o.visit_id===visit&&o.status==='ordered');assert.equal(ords.length,3,'three waiting services');
 const oBK=ords.find(o=>o.snapshot.code==='LZ-BK'),oSH=ords.find(o=>o.snapshot.code==='LZ-SH'),oAX=ords.find(o=>o.snapshot.code==='LZ-AX');
 // a second visit for the cross-visit check
 const app2=(await cmd('book',{patient_id:pat,provider_id:provider,service_id:sv('LZ-SH'),starts_at:date+'T12:00Z',device_id:dev})).id;const visit2=(await cmd('arrive',{id:app2})).id;
 s=await snap();const other=s.orders.find(o=>o.visit_id===visit2&&o.status==='ordered');
 const M=fs.readFileSync('supabase/migrations/20261127270000_execute_all.sql','utf8');await db.exec('reset role');await db.exec(M);await assert.rejects(()=>db.exec(M),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
 await as(3);
 // ---- single «تنفيذ»: clear messages
 const base={id:oBK.id,device_id:dev,minutes:15,materials:[]};
 await assert.rejects(()=>cmd('execute',{...base}),/اكتب قراءة العداد قبل وبعد/,'empty counter');
 await assert.rejects(()=>cmd('execute',{...base,meter_before:'',meter_after:'100'}),/اكتب قراءة العداد قبل وبعد/);
 await assert.rejects(()=>cmd('execute',{...base,meter_before:'500',meter_after:'400'}),/قراءة بعد لازم تبقى أكبر من قراءة قبل/);
 await assert.rejects(()=>cmd('execute',{...base,meter_before:'abc',meter_after:'400'}),/لازم تبقى رقم/);
 await assert.rejects(()=>cmd('execute',{...base,minutes:'',meter_before:'1',meter_after:'2'}),/اكتب دقايق تشغيل الجهاز/);
 await assert.rejects(()=>cmd('execute',{...base,meter_before:'1',meter_after:'2',materials:[{item_id:randomUUID(),quantity:1}]}),/اختار مخزن الصرف/);
 assert.equal((await q("select count(*)::int n from clinic_reception.orders where visit_id=$1 and status='completed'",[visit]))[0].n,0,'nothing executed by the refusals');
 // ---- execute_many
 const many=(orders,extra,t)=>cmd('execute_many',{visit_id:visit,device_id:dev,location_id:loc,orders,...(extra||{})},t);
 await assert.rejects(()=>many([{id:oBK.id,minutes:15,meter_before:1000,meter_after:1400,materials:[]}]),/خدمتين على الأقل/);
 await assert.rejects(()=>many([{id:oBK.id},{id:oBK.id}]),/متكررة/);
 await assert.rejects(()=>many([{id:oBK.id,minutes:15,meter_before:1000,meter_after:1400,materials:[]},{id:other.id,minutes:5,meter_before:1400,meter_after:1500,materials:[]}]),/نفس الزيارة/);
 // the second service has an empty counter → the whole call is refused, the message names it, nothing executed
 await assert.rejects(()=>many([{id:oBK.id,minutes:15,meter_before:1000,meter_after:1400,materials:[]},{id:oSH.id,minutes:5,materials:[]}]),e=>/ليزر كانديلا — شارب: اكتب قراءة العداد قبل وبعد/.test(e.message));
 assert.equal((await q("select count(*)::int n from clinic_reception.orders where visit_id=$1 and status='completed'",[visit]))[0].n,0,'all or nothing');
 assert.equal((await q("select count(*)::int n from clinic_reception.device_uses where order_id = any($1)",[[oBK.id,oSH.id,oAX.id]]))[0].n,0);
 // all three in one call, chained counter
 const t=randomUUID(),orders=[{id:oBK.id,minutes:15,meter_before:1000,meter_after:1240,materials:[]},{id:oSH.id,minutes:5,meter_before:1240,meter_after:1320,materials:[]},{id:oAX.id,minutes:5,meter_before:1320,meter_after:1400,materials:[]}];
 const r=await many(orders,{additional_confirmed:false},t);assert.equal(r.executed,3);assert.equal(r.items.length,3);
 assert.equal((await q("select count(*)::int n from clinic_reception.orders where visit_id=$1 and status='completed'",[visit]))[0].n,3,'all executed');
 const uses=await q("select o.snapshot->>'code' c,u.minutes,u.meter_before,u.meter_after from clinic_reception.device_uses u join clinic_reception.orders o on o.id=u.order_id where u.order_id = any($1) order by u.meter_before",[[oBK.id,oSH.id,oAX.id]]);
 assert.deepEqual(uses.map(u=>[u.c,+u.minutes,+u.meter_before,+u.meter_after]),[['LZ-BK',15,1000,1240],['LZ-SH',5,1240,1320],['LZ-AX',5,1320,1400]],'one device row per service, counter chained');
 // last reading on this device, by anyone: the chain end
 let lr=await rpc('clinic_reception_device_last_reading',{p_workspace:w,p_device:dev});assert.equal(+lr.meter_after,1400,'last «قراءة بعد» on the device');assert(lr.by&&lr.at,'who / when');
 // replay of the same token → same answer, no second execution / device row
 const r2=await many(orders,{additional_confirmed:false},t);assert.equal(r2.executed,3);
 assert.equal((await q("select count(*)::int n from clinic_reception.device_uses where order_id = any($1)",[[oBK.id,oSH.id,oAX.id]]))[0].n,3,'replay = no double');
 // already executed → refused with the service name
 await assert.rejects(()=>many(orders,{},randomUUID()),/ليزر كانديلا — بيكيني: /);
 // a member without the execute capability is refused
 await q("update clinic_reception.members set capabilities=$2 where workspace_id=$1 and admin_id=$3",[w,['view','book'],id(3)]);await as(3);
 await assert.rejects(()=>cmd('execute_many',{visit_id:visit2,device_id:dev,orders:[{id:other.id},{id:randomUUID()}]}));
 // info: can_execute for the reception member, false for someone without it; pulse codes listed (when the table exists)
 await q("update clinic_reception.members set capabilities=$2 where workspace_id=$1 and admin_id=$3",[w,['view','book','execute','collect'],id(3)]);await as(3);
 let info=await rpc('clinic_reception_execute_all_info',{p_workspace:w});assert.equal(info.can_execute,true);assert(Array.isArray(info.pulse_codes));
 await q("update clinic_reception.members set capabilities=$2 where workspace_id=$1 and admin_id=$3",[w,['view','book'],id(3)]);await as(3);
 info=await rpc('clinic_reception_execute_all_info',{p_workspace:w});assert.equal(info.can_execute,false,'no execute capability → no button');
 // a service priced per pulse must bring its own counter
 await db.exec('reset role');await db.exec("create table if not exists clinic_reception.laser_pulse_services(service_code text primary key); insert into clinic_reception.laser_pulse_services values('LZ-PL') on conflict do nothing");
 await q("update clinic_reception.members set capabilities=$2 where workspace_id=$1 and admin_id=$3",[w,['view','book','execute','collect'],id(3)]);await as(1);
 await cmd('service',{code:'LZ-PL',name:'ليزر بالنبضة — ظهر',department:dept,price:2,minutes:10,requires_device:true,bom:[]});
 {const ag=(await cmd('agreement',{provider_id:provider,service_code:'LZ-PL',rate:20,from:yday,to:'2030-01-01',reference:'AG-PL'})).id;await as(2);await cmd('agreement_review',{id:ag,approve:true});await as(1);}
 s=await snap();await cmd('order_add',{visit_id:visit2,service_id:s.services.find(x=>x.code==='LZ-PL').id,provider_id:provider,quantity:1});s=await snap();
 const pl=s.orders.find(o=>o.visit_id===visit2&&o.snapshot.code==='LZ-PL');await as(3);
 assert.deepEqual((await rpc('clinic_reception_execute_all_info',{p_workspace:w})).pulse_codes,['LZ-PL']);
 await assert.rejects(()=>cmd('execute_many',{visit_id:visit2,device_id:dev,orders:[{id:other.id,minutes:5,meter_before:2000,meter_after:2100,materials:[]},{id:pl.id,minutes:10,meter_before:2100,meter_after:2550,materials:[]}]}),/ليزر بالنبضة — ظهر: البند ده بيتحسب بالنبضة/);
 // «عدد النبضات»: after = before + pulses; must be > 0
 {const x=s.orders.find(o=>o.visit_id===visit2&&o.snapshot.code==='LZ-SH');await as(3);
  await assert.rejects(()=>cmd('execute',{id:x.id,device_id:dev,minutes:5,meter_before:1400,pulses:0,materials:[]}),/أكبر من صفر/);
  await assert.rejects(()=>cmd('execute',{id:x.id,device_id:dev,minutes:5,meter_before:1400,pulses:'abc',materials:[]}),/لازم يبقى رقم/);
  await assert.rejects(()=>cmd('execute',{id:x.id,device_id:dev,minutes:5,pulses:80,materials:[]}),/اكتب قراءة العداد قبل/);
  await cmd('execute',{id:x.id,device_id:dev,minutes:5,meter_before:1400,pulses:80,materials:[]});
  const u=await q("select meter_before,meter_after from clinic_reception.device_uses where order_id=$1",[x.id]);assert.deepEqual([+u[0].meter_before,+u[0].meter_after],[1400,1480],'stored as before / after');
  assert.equal(+(await rpc('clinic_reception_device_last_reading',{p_workspace:w,p_device:dev})).meter_after,1480,'next window starts here');}
 // other actions untouched
 await as(1);assert((await snap()).orders.length>=4);
 // rollback restores the previous command
 await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261127270000_execute_all.rollback.sql','utf8'));
 assert.equal((await db.query("select to_regprocedure('clinic_reception.command_before_execute_all(uuid,text,jsonb,uuid)') f")).rows[0].f,null);
 assert((await db.query("select to_regprocedure('public.clinic_reception_command(uuid,text,jsonb,uuid)') f")).rows[0].f);
 await db.close();console.log('PASS execute all SQL (reception member, real functions): clear messages for empty / reversed / non-numeric counter, missing minutes, missing store; execute_many all-or-nothing with the service name, same visit only, ≥2, no duplicates, chained device rows, replay no double, execute capability; rollback.');
})().catch(e=>{console.error(e);process.exit(1);});
