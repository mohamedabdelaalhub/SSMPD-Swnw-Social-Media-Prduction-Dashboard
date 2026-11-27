// 20261122270000_inventory_supplies_flow: main stores, direct supplier invoice, «استهلاك أمس» (per patient + service).
const scenario=require('./reception-management-pilot.cjs'),assert=require('node:assert/strict'),fs=require('fs');
const mig=f=>fs.readFileSync('supabase/migrations/'+f,'utf8');
async function run(){const x=await scenario(true),{b,live,pat,day}=x,{db,as,call,owner,id,key}=b;
await owner('select 1');
for(const f of ['20261017194115_inventory_patient_supply.sql','20261017182845_inventory_invoice_expiry_pricing.sql','20261017190930_inventory_standard_markup_batch_codes.sql','20261122270000_inventory_supplies_flow.sql'])await db.exec(mig(f));
await assert.rejects(()=>db.exec(mig('20261122270000_inventory_supplies_flow.sql')),/تم تطبيق/);await db.exec('rollback');
const central='00000000-0000-4000-8000-000000000001';
assert.equal((await owner('select is_main from inventory_locations where id=$1',[central]))[0].is_main,true);
const branch=(await owner('select id from inventory_branches limit 1'))[0].id;
const dental=(await owner("insert into inventory_locations(branch_id,name,kind,is_main) values($1,'رئيسي أسنان','substore',true) returning id",[branch]))[0].id;
const sub=(await owner("select id from inventory_locations where kind='substore' and not is_main limit 1"))[0].id;

// ---------- direct supplier invoice
await as(1);const supplier=await call('inventory_save_supplier',[null,'مورد الفاتورة المباشرة','','',true]);
const gloves=await call('inventory_save_item',[null,'GLV','جلافز M','عام','قطعة',100,0,35,0]);
const paste=await call('inventory_save_item',[null,'MPX','meta paste','أسنان','سرينجة',1,0,35,0]);
let ctx=await call('inventory_direct_invoice',['context',{}]);
assert(ctx.locations.some(l=>l.id===central&&l.central));assert(ctx.locations.some(l=>l.id===dental));assert(!ctx.locations.some(l=>l.id===sub));
assert(ctx.suppliers.some(s=>s.id===supplier));assert(ctx.items.some(i=>i.id===gloves&&+i.units_per_pack===100));
const today=new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Cairo'});
const inv={supplier_id:supplier,location_id:central,reference:'INV-55120',invoice_date:today,document_url:'',lines:[{item_id:gloves,quantity:1000,package_cost:180,lot_number:'G-1',expiry_date:'2028-03-31'}],token:key()};
const save=p=>call('inventory_direct_invoice',['save',p]);
await assert.rejects(()=>save({...inv,location_id:sub}),/مخزن رئيسي/);
await assert.rejects(()=>save({...inv,lines:[]}),/من 1 لـ 30/);
await assert.rejects(()=>save({...inv,lines:[inv.lines[0],inv.lines[0]]}),/متكرر/);
await assert.rejects(()=>save({...inv,lines:[{...inv.lines[0],quantity:-1}]}),/راجع كمية/);
const r1=await save(inv);assert.equal(+r1.total,1800);assert.equal(r1.repeat,false);
const again=await save(inv);assert.equal(again.id,r1.id);assert.equal(again.repeat,true);
assert.equal(+(await owner('select inventory_location_balance($1,$2) q',[central,gloves]))[0].q,1000);
assert.equal(+(await owner('select clinic_finance.supplier_balance($1) v',[supplier]))[0].v,1800);
const req=(await owner('select status,reviewer_id,request_type from inventory_requests where id=$1',[r1.order_id]))[0];assert.equal(req.status,'completed');assert.equal(req.request_type,'purchase');
await assert.rejects(()=>save({...inv,token:key()}),/./); // same supplier reference twice is refused
// into a non-central main store: stock lands there, payable identical
const r2=await save({...inv,location_id:dental,reference:'INV-DENT-1',lines:[{item_id:paste,quantity:5,package_cost:120,lot_number:'MP-1',expiry_date:'2027-06-30'}],token:key()});
assert.equal(+r2.total,600);assert.equal(r2.location,'رئيسي أسنان');
assert.equal(+(await owner('select inventory_location_balance($1,$2) q',[dental,paste]))[0].q,5);
assert.equal(+(await owner('select inventory_location_balance($1,$2) q',[central,paste]))[0].q,0);
assert.equal(+(await owner('select clinic_finance.supplier_balance($1) v',[supplier]))[0].v,2400);
const unbalanced=await owner('select e.id from clinic_finance.entries e join clinic_finance.lines l on l.entry_id=e.id group by e.id having sum(l.debit)<>sum(l.credit)');assert.equal(unbalanced.length,0);
for(const n of [2,4]){await as(n);await assert.rejects(()=>call('inventory_direct_invoice',['context',{}]),/مسؤول المخزن الرئيسي|صلاحية/);}

// ---------- «استهلاك أمس»
await as(1);let snap=await call('clinic_reception_snapshot',[live,day,day]);
const pr=snap.providers.find(p=>p.active),sv=snap.services.find(s=>s.active);
const cmd=(action,p)=>call('clinic_reception_command',[live,action,p,key()]);
await cmd('availability',{provider_id:pr.id,starts_at:day+'T08:00Z',ends_at:day+'T11:00Z'});
const app=(await cmd('book',{patient_id:pat,provider_id:pr.id,service_id:sv.id,starts_at:day+'T08:00Z'})).id;
const visit=(await cmd('arrive',{id:app})).id;
const use=(a,p)=>call('clinic_reception_visit_usage',[live,a,p]);
await assert.rejects(()=>use('list',{day:'2020-01-01'}),/آخر 14 يوم/);
let list=await use('list',{day:today});
const row=list.rows.find(r=>r.visit_id===visit);assert(row,'visit listed');assert.equal(row.done,false);
const order=row.orders[0].order_id;assert(row.orders[0].service);
assert(list.items.find(i=>i.id===gloves).stock[central]>=1000);assert(list.locations.some(l=>l.id===dental&&l.main));
const p0={visit_id:visit,order_id:order,none:false,lines:[{item_id:gloves,location_id:central,quantity:2}],token:key()};
await assert.rejects(()=>use('save',{...p0,order_id:key()}),/مش ضمن الزيارة/);
await assert.rejects(()=>use('save',{...p0,none:true}),/مش الاتنين/);
await assert.rejects(()=>use('save',{...p0,lines:[]}),/أضف المستلزمات/);
await assert.rejects(()=>use('save',{...p0,lines:[{item_id:gloves,location_id:central,quantity:5000}]}),/غير كاف/);
const s1=await use('save',p0);assert.equal(s1.status,'recorded');assert.equal(+s1.total_cost,3.6);
assert.deepEqual(await use('save',p0),s1);
await assert.rejects(()=>use('save',{...p0,token:key()}),/اتسجل قبل كده/);
assert.equal(+(await owner('select inventory_location_balance($1,$2) q',[central,gloves]))[0].q,998);
const cost=(await owner("select sum(l.debit)::numeric v from clinic_finance.entries e join clinic_finance.lines l on l.entry_id=e.id where e.source='reception_stock_cost' and l.account='5123'"))[0];assert(+cost.v>=3.6);
const mv=(await owner("select note from inventory_movements where item_id=$1 and quantity_delta<0",[gloves]))[0];assert(mv.note.includes('استهلاك خدمة'));
list=await use('list',{day:today});const after=list.rows.find(r=>r.visit_id===visit);
assert.equal(after.orders[0].usage_status,'recorded');assert.equal(after.orders[0].lines[0].item,'جلافز M');assert(+list.counts.cost>=3.6);
// «مفيش مستلزمات» on a second service of another visit
const app2=(await cmd('book',{patient_id:pat,provider_id:pr.id,service_id:sv.id,starts_at:day+'T09:00Z'})).id;
const visit2=(await cmd('arrive',{id:app2})).id;list=await use('list',{day:today});
const o2=list.rows.find(r=>r.visit_id===visit2).orders[0].order_id;
const s2=await use('save',{visit_id:visit2,order_id:o2,none:true,lines:[],token:key()});assert.equal(s2.status,'none');assert.equal(+s2.total_cost,0);
list=await use('list',{day:today});assert.equal(list.rows.find(r=>r.visit_id===visit2).done,true);
// boundaries
for(const n of [2,4,6]){await as(n);await assert.rejects(()=>use('list',{day:today}),/صلاحية|المتصل/);}
await owner('select 1');
for(const t of ['clinic_reception.visit_usage','clinic_reception.visit_usage_lines'])assert.equal((await owner("select has_table_privilege('authenticated',$1,'select') y",[t]))[0].y,false);
for(const f of ['public.clinic_reception_visit_usage(uuid,text,jsonb)','public.inventory_direct_invoice(text,jsonb)'])assert.equal((await owner("select has_function_privilege('anon',$1,'execute') y",[f]))[0].y,false);
const unb=await owner('select e.id from clinic_finance.entries e join clinic_finance.lines l on l.entry_id=e.id group by e.id having sum(l.debit)<>sum(l.credit)');assert.equal(unb.length,0);
// rollback refuses once usage lines exist
await assert.rejects(()=>db.exec(fs.readFileSync('supabase/rollbacks/20261122270000_inventory_supplies_flow.rollback.sql','utf8')),/مينفعش/);await db.exec('rollback');
await db.close();console.log('PASS supplies flow: main stores, direct supplier invoice (central + other main store, payable, replay, guards), next-day usage per visit/service at cost (5123), none, replay, duplicate/stock/permission guards, rollback guard.');}
run().catch(e=>{console.error(e);process.exit(1);});
