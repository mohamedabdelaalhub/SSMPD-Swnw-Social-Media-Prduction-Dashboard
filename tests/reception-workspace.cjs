const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite(),id=n=>'60000000-0000-4000-8000-'+String(n).padStart(12,'0');let seq=10;
await db.exec(`create role anon;create role authenticated;create table admins(id uuid primary key,role text,active boolean default true);create table patients(id uuid primary key);create function my_admin_id() returns uuid language sql stable as $$select nullif(current_setting('test.admin',true),'')::uuid$$;create function has_role(r text) returns boolean language sql stable as $$select exists(select 1 from admins where id=my_admin_id() and role=r and active)$$;grant usage on schema public to authenticated;`);
for(const n of [1,2,3])await db.query('insert into admins values($1,$2,true)',[id(n),n===3?'reception':'super_admin']);
await db.exec(fs.readFileSync('supabase/migrations/20261017041224_reception_workspace.sql','utf8'));
async function as(n){await db.exec('reset role');await db.query("select set_config('test.admin',$1,false)",[id(n)]);await db.exec('set role authenticated');}
async function rpc(n,args=[]){return (await db.query('select public.'+n+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') v',args)).rows[0].v;}
const key=()=>id(++seq),command=(a,p,k=key())=>rpc('clinic_reception_command',[w,a,p,k]);
await as(1);const w=await rpc('clinic_reception_bootstrap');assert.equal(await rpc('clinic_reception_bootstrap'),w);const from='2026-10-17',to='2026-10-18';let snap=await rpc('clinic_reception_snapshot',[w,from,to]);assert.equal(snap.patients.length,2);
let provider=snap.providers[0].id,service=snap.services.find(s=>s.code==='CONSULT').id,patient=snap.patients[0].id;
await command('availability',{provider_id:provider,starts_at:'2026-10-17T08:00:00Z',ends_at:'2026-10-17T12:00:00Z'});
const payload={patient_id:patient,provider_id:provider,service_id:service,starts_at:'2026-10-17T08:00:00Z'},k=key(),a=(await command('book',payload,k)).id;
assert.equal((await command('book',payload,k)).id,a);await assert.rejects(()=>command('book',{...payload,starts_at:'2026-10-17T08:10:00Z'}),/يتداخل/);await assert.rejects(()=>command('book',{...payload,starts_at:'2026-10-17T13:00:00Z'}),/تواجد/);
const visit=(await command('arrive',{id:a})).id;assert.equal((await command('arrive',{id:a})).id,visit);await assert.rejects(()=>command('cancel',{id:a,reason:'إلغاء بعد حضور'}),/غير متاح/);
await db.exec('reset role');let rows=(await db.query('select count(*) n from clinic_reception.orders')).rows;await as(1);assert.equal(Number(rows[0].n),1);
await command('service',{code:'CONSULT',name:'كشف بسعر جديد',department:'عيادة تجربة',price:600,minutes:20});await db.exec('reset role');assert.equal(Number((await db.query('select price from clinic_reception.orders')).rows[0].price),500);await as(1);
await assert.rejects(()=>command('book',{...payload,starts_at:'2026-10-17T09:00:00Z'}),/الخدمة غير متاحة/);
await as(2);const other=await rpc('clinic_reception_bootstrap');await assert.rejects(()=>rpc('clinic_reception_snapshot',[w,from,to]),/صلاحية/);await assert.rejects(()=>rpc('clinic_reception_command',[other,'book',payload,key()]),/الخدمة غير متاحة|المريض خارج/);
await as(3);await assert.rejects(()=>rpc('clinic_reception_bootstrap'),/دارة/);await assert.rejects(()=>rpc('clinic_reception_snapshot',[w,from,to]),/صلاحية/);await assert.rejects(()=>db.query('select * from clinic_reception.patients'),/permission/);
await db.exec('reset role');await db.query("update admins set active=false where id=$1",[id(1)]);await as(1);await assert.rejects(()=>rpc('clinic_reception_snapshot',[w,from,to]),/الدخول/);
await db.close();console.log('PASS reception workspace: isolated trials, immutable service versions, availability/overlap guards, idempotent booking/arrival, one order per arrival, invalid transitions, cross-workspace and inactive-user denial.');})().catch(e=>{console.error(e.message,e.where,e.position,e.stack);process.exitCode=1;});
