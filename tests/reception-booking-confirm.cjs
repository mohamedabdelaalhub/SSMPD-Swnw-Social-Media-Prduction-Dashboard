// «تأكيد الحجز»: confirm / unconfirm a booked appointment; rescheduling clears it; only booked appointments; other workspace denied.
const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite(),id=n=>'60000000-0000-4000-8000-'+String(n).padStart(12,'0');let seq=10;
await db.exec(`create role anon;create role authenticated;create table admins(id uuid primary key,role text,active boolean default true);create table patients(id uuid primary key);create function my_admin_id() returns uuid language sql stable as $$select nullif(current_setting('test.admin',true),'')::uuid$$;create function has_role(r text) returns boolean language sql stable as $$select exists(select 1 from admins where id=my_admin_id() and role=r and active)$$;grant usage on schema public to authenticated;`);
for(const n of [1,2])await db.query('insert into admins values($1,$2,true)',[id(n),'super_admin']);
await db.exec(fs.readFileSync('supabase/migrations/20261017041224_reception_workspace.sql','utf8'));
// Same duration hook production has (20261017051044 routes booking length through clinic_reception.booking_minutes).
await db.exec(`do $x$declare def text;patched text;begin def:=pg_get_functiondef('public.clinic_reception_command(uuid,text,jsonb,uuid)'::regprocedure);patched:=replace(def,'e:=t+make_interval(mins=>s.minutes);','e:=t+make_interval(mins=>clinic_reception.booking_minutes(p_workspace,p_payload));');if def=patched then raise exception 'hook';end if;execute patched;end $x$;`);
await db.exec(fs.readFileSync('supabase/migrations/20261115100000_reception_booking_confirm_duration.sql','utf8'));
async function as(n){await db.exec('reset role');await db.query("select set_config('test.admin',$1,false)",[id(n)]);await db.exec('set role authenticated');}
async function rpc(n,args=[]){return (await db.query('select public.'+n+'('+args.map((_,i)=>'$'+(i+1)).join(',')+') v',args)).rows[0].v;}
const key=()=>id(++seq);let w;const command=(a,p,k=key(),ws=w)=>rpc('clinic_reception_command',[ws,a,p,k]);
await as(1);w=await rpc('clinic_reception_bootstrap');const from='2026-10-17',to='2026-10-18';let snap=await rpc('clinic_reception_snapshot',[w,from,to]);
const provider=snap.providers[0].id,service=snap.services.find(s=>s.code==='CONSULT').id,patient=snap.patients[0].id;
await command('availability',{provider_id:provider,starts_at:'2026-10-17T08:00:00Z',ends_at:'2026-10-17T12:00:00Z'});
const a=(await command('book',{patient_id:patient,provider_id:provider,service_id:service,starts_at:'2026-10-17T08:00:00Z'})).id;
const find=async()=>(await rpc('clinic_reception_snapshot',[w,from,to])).appointments.find(x=>x.id===a);
assert.equal((await find()).confirmed_at,null,'new booking is not confirmed');
const c=await command('confirm',{id:a});assert(c.confirmed_at);const first=(await find());assert.equal(first.confirmed_by,id(1));
assert.equal((await command('confirm',{id:a})).confirmed_at,c.confirmed_at,'confirming twice keeps the first time');
await command('confirm',{id:a,confirmed:false});assert.equal((await find()).confirmed_at,null,'undo');
await command('confirm',{id:a});await command('reschedule',{id:a,service_id:service,starts_at:'2026-10-17T09:00:00Z'});
assert.equal((await find()).confirmed_at,null,'reschedule clears confirmation');
await command('confirm',{id:a});await command('arrive',{id:a});assert((await find()).confirmed_at,'confirmation kept after arrival');
await assert.rejects(()=>command('confirm',{id:a,confirmed:false}),/قبل حضور/);
await assert.rejects(()=>command('confirm',{id:id(99)}),/غير موجود/);
await assert.rejects(()=>command('confirm',{id:a},null),/غير صالح/);
await as(2);const other=await rpc('clinic_reception_bootstrap');await assert.rejects(()=>command('confirm',{id:a},key(),w),/صلاحية/);
await assert.rejects(()=>command('confirm',{id:a},key(),other),/غير موجود/);
// Session length: chosen minutes decide the slot; without them the service length is unchanged; bad values refused.
await as(1);await command('availability',{provider_id:provider,starts_at:'2026-10-18T08:00:00Z',ends_at:'2026-10-18T12:00:00Z'});
const len=async x=>{const s2=(await rpc('clinic_reception_snapshot',[w,from,to])).appointments.find(y=>y.id===x);return (Date.parse(s2.ends_at)-Date.parse(s2.starts_at))/60000;};
const p2=snap.patients[1]?snap.patients[1].id:patient,base={patient_id:p2,provider_id:provider,service_id:service};
const b1=(await command('book',{...base,starts_at:'2026-10-18T08:00:00Z',minutes:'30'})).id;assert.equal(await len(b1),30);
const b2=(await command('book',{...base,starts_at:'2026-10-18T08:30:00Z',minutes:'30'})).id;assert.equal(await len(b2),30,'next half hour is free after a 30-minute session');
await assert.rejects(()=>command('book',{...base,starts_at:'2026-10-18T08:45:00Z',minutes:'60'}),/يتداخل/);
const svcLen=snap.services.find(s=>s.id===service).minutes;const b3=(await command('book',{...base,starts_at:'2026-10-18T10:00:00Z'})).id;assert.equal(await len(b3),svcLen,'no choice = service length');
await assert.rejects(()=>command('book',{...base,starts_at:'2026-10-18T11:00:00Z',minutes:'3'}),/ثماني ساعات/);
await assert.rejects(()=>command('book',{...base,starts_at:'2026-10-18T11:00:00Z',minutes:'30.5'}),/غير صحيحة/);
await command('reschedule',{id:b3,service_id:service,starts_at:'2026-10-18T10:30:00Z',minutes:'60'});assert.equal(await len(b3),60);
await db.close();console.log('PASS reception booking confirm + session length: chosen 30/60 minutes, default unchanged, overlap by real length, bad values refused; confirm/undo, idempotent time, reschedule clears, only before arrival, missing/foreign denied.');
})().catch(e=>{console.error(e.message,e.where||'',e.stack);process.exitCode=1;});
