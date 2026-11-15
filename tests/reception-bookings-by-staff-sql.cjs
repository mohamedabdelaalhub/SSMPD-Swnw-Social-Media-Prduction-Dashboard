// Managers' report: bookings each employee CREATED in a day / another day / a period (Cairo dates).
const assert=require('node:assert/strict'),boot=require('./helpers/reception.cjs');
(async()=>{
 const {db,id,as,rpc}=await boot(['reception_bookings_by_staff']);
 await db.exec('reset role');
 await db.exec("alter table admins add column name text;update admins set name='سارة' where id='"+id(1)+"';update admins set name='منى' where id='"+id(3)+"';");
 await db.query("insert into admins(id,role,active,name) values($1,'general_manager',true,'المدير')",[id(4)]);
 const ws='62000000-0000-4000-8000-000000000001';
 await db.query("insert into clinic_reception.workspaces(id,name,mode,owner_id) values($1,'w','trial',$2)",[ws,id(1)]);
 await db.query("insert into clinic_reception.members(workspace_id,admin_id,capabilities) values($1,$2,'{view,book}'),($1,$3,'{view}')",[ws,id(3),id(4)]);
 const pt=(await db.query("insert into clinic_reception.patients(workspace_id,file_no,name,phone,created_by) values($1,'F1','مريض واحد','01000000000',$2) returning id",[ws,id(1)])).rows[0].id;
 const pr=(await db.query("insert into clinic_reception.providers(workspace_id,name,department,branch) values($1,'د. يحيى','تغذية','حدائق الأهرام') returning id",[ws])).rows[0].id;
 const sv=(await db.query("insert into clinic_reception.services(workspace_id,code,name,department,price,minutes) values($1,'C1','كشف','تغذية',500,30) returning id",[ws])).rows[0].id;
 // created_at values in UTC; Cairo is UTC+2 in November.
 const add=(by,created,status)=>db.query("insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at,status,created_by,created_at) values($1,$2,$3,$4,'2026-11-20T08:00Z','2026-11-20T08:30Z',$5,$6,$7)",[ws,pt,pr,sv,status||'booked',by,created]);
 await add(id(3),'2026-11-15T08:00Z');await add(id(3),'2026-11-15T21:30Z'); // 2nd = 23:30 Cairo, still the 15th
 await add(id(3),'2026-11-15T22:30Z','cancelled'); // 00:30 Cairo on the 16th
 await add(id(1),'2026-11-15T10:00Z');await add(id(1),'2026-11-10T10:00Z');
 await as(1);
 let r=await rpc('clinic_reception_bookings_by_staff',{p_workspace:ws,p_from:'2026-11-15',p_to:'2026-11-15'});
 assert.equal(r.rows.length,3,'Cairo day boundary');assert.deepEqual(r.staff.map(s=>[s.name,s.count]),[['منى',2],['سارة',1]]);
 assert.equal(r.rows[0].patient_name,'مريض واحد');assert.equal(r.rows[0].provider_name,'د. يحيى');assert.equal(r.rows[0].service_name,'كشف');
 assert(!JSON.stringify(r).includes('01000000000'),'no phone');assert(!('email' in r.rows[0]));
 r=await rpc('clinic_reception_bookings_by_staff',{p_workspace:ws,p_from:'2026-11-15',p_to:'2026-11-15',p_staff:id(3)});
 assert.equal(r.rows.length,2);assert(r.rows.every(x=>x.created_by_name==='منى'));assert.equal(r.staff.length,2,'staff summary ignores the employee filter');
 r=await rpc('clinic_reception_bookings_by_staff',{p_workspace:ws,p_from:'2026-11-16',p_to:'2026-11-16'});
 assert.equal(r.rows.length,1);assert.equal(r.rows[0].status,'cancelled');
 r=await rpc('clinic_reception_bookings_by_staff',{p_workspace:ws,p_from:'2026-11-01',p_to:'2026-11-30'});assert.equal(r.rows.length,5);
 await assert.rejects(rpc('clinic_reception_bookings_by_staff',{p_workspace:ws,p_from:'2026-11-16',p_to:'2026-11-15'}),/فترة صحيحة/);
 await assert.rejects(rpc('clinic_reception_bookings_by_staff',{p_workspace:ws,p_from:'2026-01-01',p_to:'2026-12-31'}),/٩٣ يوم/);
 await as(3);await assert.rejects(rpc('clinic_reception_bookings_by_staff',{p_workspace:ws,p_from:'2026-11-15',p_to:'2026-11-15'}),e=>/والسوبر أدمن فقط/.test(e.message),'reception refused');
 await as(4);r=await rpc('clinic_reception_bookings_by_staff',{p_workspace:ws,p_from:'2026-11-15',p_to:'2026-11-15'});assert.equal(r.rows.length,3,'general manager member allowed');
 await assert.rejects(db.query('select * from clinic_reception.appointments'),e=>/permission denied/.test(e.message),'no direct table access');
 await db.close();
 console.log('PASS bookings by staff: Cairo creation dates, per-employee filter and summary, names only (no phone/email), period limits, managers only.');
})().catch(e=>{console.error(e);process.exit(1);});
