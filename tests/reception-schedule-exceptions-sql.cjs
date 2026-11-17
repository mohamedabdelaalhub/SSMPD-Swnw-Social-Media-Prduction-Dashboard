// Owner 2026-11-17 «الاستثناء المؤقت»: a doctor away (off) or on other hours for a period; the nightly generator respects it; cancel restores the week.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const src=fs.readFileSync(path.join(__dirname,'reception-bridge.cjs'),'utf8');const cut=src.indexOf('// A legacy inventory use');
assert(cut>0&&src.includes('await boot()'),'reception-bridge.cjs setup markers moved; update this test');
const prefix=src.slice(0,cut).replace('await boot()',"await boot(['reception_booking_confirm_duration','reception_weekly_schedule_walk_in','reception_schedule_exceptions'])").replace("require('./helpers/reception-bridge.cjs')",'require('+JSON.stringify(path.join(__dirname,'helpers','reception-bridge.cjs'))+')');
const body=`
const q=async(sql,a)=>{const r=await owner(sql,a);await as(1);return r;};await as(1);
const doc=(await cmd(live,'provider',{name:'طبيب استثناء تجربة',department:'جلدية',branch:'حدائق الأهرام'})).id;
const wk=(a,p)=>call('clinic_reception_weekly',[live,a,p||{}]),ex=(a,p)=>call('clinic_reception_schedule_exception',[live,a,p||{}]);
await wk('save',{provider_id:doc,slots:[0,1,2,3,4,5,6].map(d=>({dow:d,starts:'10:00',ends:'12:00'}))});
const cairo=(await q("select (now() at time zone 'Africa/Cairo')::date::text d"))[0].d,add=n=>new Date(Date.parse(cairo)+n*864e5).toISOString().slice(0,10);
const win=async(day)=>q("select to_char(starts_at at time zone 'Africa/Cairo','HH24:MI') s,to_char(ends_at at time zone 'Africa/Cairo','HH24:MI') e,source from clinic_reception.availability where provider_id=$1 and (starts_at at time zone 'Africa/Cairo')::date=$2::date order by starts_at",[doc,day]);
assert.equal((await win(add(3))).length,1);
// a patient booked on day 3 at 10:00
const exPat=pat;const patName=(await q('select name from clinic_reception.patients where id=$1',[pat]))[0].name;
const svc=(await cmd(live,'service',{code:'EX-S',name:'كشف جلدية استثناء',department:'جلدية',price:300,minutes:20,bom:[]})).id;
await q("insert into clinic_reception.appointments(workspace_id,patient_id,provider_id,service_id,starts_at,ends_at,status,created_by) values($1,$2,$3,$4,($5::date+time '10:00') at time zone 'Africa/Cairo',($5::date+time '10:20') at time zone 'Africa/Cairo','booked',(select id from admins order by id limit 1))",[live,exPat,doc,svc,add(3)]);
// validation
await assert.rejects(()=>ex('add',{provider_id:doc,from:add(-1),to:add(2),kind:'off',reason:'سفر'}),/النهارده/);
await assert.rejects(()=>ex('add',{provider_id:doc,from:add(2),to:add(1),kind:'off',reason:'سفر'}),/راجع تاريخ/);
await assert.rejects(()=>ex('add',{provider_id:doc,from:add(1),to:add(200),kind:'off',reason:'سفر'}),/٣ شهور/);
await assert.rejects(()=>ex('add',{provider_id:doc,from:add(1),to:add(2),kind:'hours',slots:[],reason:'سفر'}),/الساعات الجديدة/);
// off for days 2..4: windows gone, booked patient on day 3 reported
let r=await ex('add',{provider_id:doc,from:add(2),to:add(4),kind:'off',reason:'سفر مؤتمر'});
assert.equal(r.removed,3);assert.equal(r.affected.length,1);assert.equal(r.affected[0].patient,patName);
for(const n of [2,3,4])assert.equal((await win(add(n))).length,0,'off day '+n);assert.equal((await win(add(5))).length,1,'day after untouched');
// the nightly generator does not put them back
await wk('generate',{days:28});for(const n of [2,3,4])assert.equal((await win(add(n))).length,0,'generator respects exception');
await assert.rejects(()=>ex('add',{provider_id:doc,from:add(4),to:add(6),kind:'off',reason:'تداخل'}),/نفس الفترة/);
// other hours for days 8..9 (evening, over midnight)
r=await ex('add',{provider_id:doc,from:add(8),to:add(9),kind:'hours',slots:[{starts:'20:00',ends:'00:00'}],reason:'تغيير مؤقت'});
assert.equal(r.added,2);for(const n of [8,9])assert.deepEqual((await win(add(n))).map(x=>[x.s,x.e,x.source]),[['20:00','00:00','exception']]);
await wk('generate',{days:28});assert.deepEqual((await win(add(8))).map(x=>x.s),['20:00'],'no weekly window added on an hours-exception day');
const list=(await ex('list')).exceptions;assert.equal(list.length,2);assert(list.every(x=>x.provider_name==='طبيب استثناء تجربة'));
// cancel restores the weekly schedule
r=await ex('cancel',{id:list.find(x=>x.kind==='hours').id});assert.equal(r.removed,2);assert.deepEqual((await win(add(8))).map(x=>[x.s,x.source]),[['10:00','weekly']]);
r=await ex('cancel',{id:list.find(x=>x.kind==='off').id});for(const n of [2,3,4])assert.equal((await win(add(n))).length,1,'week back on day '+n);
await assert.rejects(()=>ex('cancel',{id:list[0].id}),/اتلغى/);assert.equal((await ex('list')).exceptions.length,0);
await db.close();console.log('PASS schedule exceptions: off / other hours for a period, bookings outside reported, nightly generator respects it, overlap refused, cancel restores the weekly schedule.');})().catch(e=>{console.error(e);process.exit(1);});`;
const file=path.join(__dirname,'.schedule-exceptions-run-'+process.pid+'.cjs');
fs.writeFileSync(file,prefix+body);try{require(file);}finally{setTimeout(()=>{try{fs.unlinkSync(file);}catch(_){}},0);}
