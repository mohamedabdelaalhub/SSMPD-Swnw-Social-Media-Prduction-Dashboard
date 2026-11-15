// A shift with no exit punch is closed automatically at its end, 10 hours after the shift end (owner request 2026-11-15).
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception-bridge.cjs');
(async()=>{const {db,as,call,owner,id,fin,key}=await boot(['reception_canonical_catalog','reception_catalog_readiness','reception_catalog_lock_order']);try{
await db.exec("alter table admins add column if not exists email text;alter table contracting_entities add column category text default 'cash';alter table pricing_services add column created_by uuid;create or replace function public.is_super() returns boolean language sql stable as $$select has_role('super_admin')$$;");
for(const suffix of ['human_resources_workspace','price_lists_workspace','price_lists_booking_integration'])await db.exec(fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(n=>n.endsWith('_'+suffix+'.sql')),'utf8'));
await db.exec(fs.readFileSync('supabase/migrations/20261024183344_contract_price_imports_and_service_identity.sql','utf8'));await db.exec(fs.readFileSync('supabase/migrations/20261024183400_hr_attendance_import_and_calculated_payroll.sql','utf8'));
for(const f of ['20261115100000_hr_pay_guaranteed_minimum','20261112100000_live_presence','20261113100000_shift_schedules','20261115130000_hr_attendance_from_punches','20261116100000_hr_leave_rules','20261116130000_hr_exit_autoclose'])await db.exec(fs.readFileSync('supabase/migrations/'+f+'.sql','utf8'));
await as(1);await owner('update admins set has_hr_access=true where id=$1',[id(3)]);
const today=(await owner("select ((now() at time zone 'Africa/Cairo')::date)::text d"))[0].d;
const ago=n=>{const d=new Date(today+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-n);return d.toISOString().slice(0,10);};
const d2=ago(2),d3=ago(3),ytd=ago(1);
const p=await call('hr_command',['person',{full_name:'موظف بصمة انصراف'}]);
const t=(await owner("insert into clinic_people.shift_templates(name,start_time,end_time,grace_minutes,created_by) values('صباحي','08:00','16:00',15,$1) returning id",[id(1)]))[0].id;
const night=(await owner("insert into clinic_people.shift_templates(name,start_time,end_time,grace_minutes,created_by) values('طويلة','23:59','23:58',15,$1) returning id",[id(1)]))[0].id;
for(const [day,tpl] of [[d3,t],[d2,t],[ytd,night]])await owner("insert into clinic_people.person_shifts(person_id,dow,template_id,valid_from,valid_to,created_by) values($1,extract(dow from $2::date)::int,$3,$2::date,$2::date,$4)",[p,day,tpl,id(1)]);
await owner("insert into clinic_people.device_user_map(device_id,device_user_id,person_id) values('DEV1',21,$1)",[p]);
const punch=(ts,k)=>owner("insert into clinic_people.device_punches(device_id,device_user_id,ts,punch) values('DEV1',21,$1::timestamptz,$2)",[ts,k]);
await punch(d3+'T08:00+02:00',0);await punch(d3+'T23:30+02:00',1);   // exit 7.5 h after the end: counted now (window 10 h)
await punch(d2+'T08:00+02:00',0);                                     // no exit punch, ended long ago → closed at 16:00
await punch(ytd+'T23:59+02:00',0);                                    // no exit punch, shift ends later today → waits
const run=async m=>call('hr_attendance_from_punches',[m]);
for(const m of new Set([d3.slice(0,8)+'01',d2.slice(0,8)+'01',ytd.slice(0,8)+'01']))await run(m);
const rows=await owner("select day::text d,to_char(actual_end at time zone 'Africa/Cairo','HH24:MI') e,note from clinic_people.attendance where person_id=$1 order by day",[p]);
const by=Object.fromEntries(rows.map(r=>[r.d,r]));
assert.equal(by[d3].e,'23:30','a late exit within 10 hours is the real leaving time');
assert.equal(by[d2].e,'16:00');assert.match(by[d2].note,/مفيش بصمة انصراف خلال 10 ساعات/);
assert.ok(!by[ytd],'the open shift waits until 10 hours after its end');
console.log('PASS exit auto-close: exit punch counted up to 10 h after the shift, no-exit shift closed at its end only after 10 h, open shift waits.');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exit(1)});
