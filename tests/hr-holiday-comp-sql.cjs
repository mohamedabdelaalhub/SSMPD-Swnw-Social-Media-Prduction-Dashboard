// «يوم بديل» (Labor Law 14/2025 art. 129, owner decision 2026-11-15): work on an approved official holiday → written request →
// a different HR reviewer approves → +1 day in the annual balance.
const fs=require('fs'),assert=require('node:assert/strict'),boot=require('./helpers/reception-bridge.cjs');
const iso=d=>d.toISOString().slice(0,10),add=(s,n)=>{const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return iso(d);};
(async()=>{const {db,as,call,owner,id,fin,key}=await boot(['reception_canonical_catalog','reception_catalog_readiness','reception_catalog_lock_order']);try{
await db.exec("alter table admins add column if not exists email text;alter table contracting_entities add column category text default 'cash';alter table pricing_services add column created_by uuid;create or replace function public.is_super() returns boolean language sql stable as $$select has_role('super_admin')$$;");
for(const suffix of ['human_resources_workspace','price_lists_workspace','price_lists_booking_integration'])await db.exec(fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(n=>n.endsWith('_'+suffix+'.sql')),'utf8'));
await db.exec(fs.readFileSync('supabase/migrations/20261024183344_contract_price_imports_and_service_identity.sql','utf8'));await db.exec(fs.readFileSync('supabase/migrations/20261024183400_hr_attendance_import_and_calculated_payroll.sql','utf8'));
for(const f of ['20261115100000_hr_pay_guaranteed_minimum','20261112100000_live_presence','20261113100000_shift_schedules','20261115130000_hr_attendance_from_punches','20261116100000_hr_leave_rules','20261115230000_center_closures','20261116110000_hr_holiday_comp_day'])await db.exec(fs.readFileSync('supabase/migrations/'+f+'.sql','utf8'));
await as(1);await owner('update admins set has_hr_access=true where id=$1',[id(3)]);
await owner('insert into admins(id,name,role) values($1,$2,$3)',[id(5),'Test 5','general_manager']);

await as(1);const p=await call('hr_command',['person',{full_name:'موظف إجازة رسمية',admin_id:id(4)}]);
await owner("insert into clinic_people.device_user_map(device_id,device_user_id,person_id) values('DEV1',11,$1)",[p]);
// An approved official holiday (HR adds, GM approves) on 2026-10-06; he punched in that day.
await as(3);const h=(await call('center_closure_command',['add',{name:'عيد اختبار',from_date:'2026-10-06',to_date:'2026-10-07'}])).id;
await as(5);await call('center_closure_command',['review',{id:h,approve:true}]);
await owner("insert into clinic_people.device_punches(device_id,device_user_id,ts,punch) values('DEV1',11,'2026-10-06T08:02+03:00',0)");
const req=(day)=>as(4).then(()=>call('hr_command',['request',{person_id:p,kind:'holiday_comp',from_date:day,to_date:day,units:1,note:'أطلب يوم بديل عن شغلي يوم الإجازة الرسمية'}]));
await assert.rejects(()=>req('2026-10-05'),/مش إجازة رسمية/);
await assert.rejects(()=>req('2026-10-07'),/مفيش بصمة/,'no punch that holiday → refused');
const r1=await req('2026-10-06');await assert.rejects(()=>req('2026-10-06'),/duplicate|unique|موجود/i,'once per day');
// The requester cannot approve; another HR reviewer does → +1 credit, linked and audited.
await as(4);await assert.rejects(()=>call('hr_command',['request_review',{id:r1,decision:'approved',review_note:'تمام'}]),/مراجع|الموارد البشرية/);
await as(3);await call('hr_command',['request_review',{id:r1,decision:'approved',review_note:'اشتغل يوم العيد بالبصمة'}]);
const cr=await owner("select kind,status,units::int u,from_date::text d,reviewed_by from clinic_people.requests where source_request_id=$1",[r1]);
assert.equal(cr.length,1);assert.equal(cr[0].kind,'leave_credit');assert.equal(cr[0].status,'approved');assert.equal(cr[0].u,1);assert.equal(cr[0].reviewed_by,id(3));
await as(4);const ws=await call('hr_workspace',['2026-10-01']);assert.equal(Number(ws.people.find(x=>x.id===p).leave_balance),1,'one extra day in the balance');
assert.equal((await owner("select count(*)::int n from clinic_people.audit where action='holiday_comp_credit' and record_id=$1",[r1]))[0].n,1);
await db.exec('reset role');await db.exec(fs.readFileSync('supabase/rollbacks/20261116110000_hr_holiday_comp_day.rollback.sql','utf8')).then(()=>assert.fail('rollback must refuse while requests exist'),e=>assert.match(e.message,/يوم بديل/));
console.log('PASS holiday compensatory day: only an approved official holiday actually worked, written request once per day, four-eyes approval, +1 balance day, audited; rollback guarded.');
}finally{await db.close();}})().catch(e=>{console.error(e);process.exit(1)});
