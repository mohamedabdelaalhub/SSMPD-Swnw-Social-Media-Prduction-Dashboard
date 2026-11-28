// 20261128140000_hide_supply_cost (owner 2026-11-28, urgent): «سعر التكلفة يظهر فقط للمحاسب والمدير المالي، المالك، السوبر ادمن».
// The «استهلاك أمس» RPC no longer SENDS any cost to nursing / reception; accountant / financial_manager / general_manager /
// super_admin still get it. Real server functions (PGlite), as a NURSING user and a RECEPTION user with «view» / «collect».
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
// ---- the fix: apply the current live definition (can_save) + the wrap
for(const f of ['20261123050000_visit_usage_can_save.sql','20261128140000_hide_supply_cost.sql'])await db.exec(mig(f));
await assert.rejects(()=>db.exec(mig('20261128140000_hide_supply_cost.sql')),/تم تطبيق/);
await owner('update clinic_reception.settings set pilot_only=false');await owner("insert into admins(id,name,role) values($1,'ممرضة','nursing'),($2,'محاسب','accountant'),($3,'استقبال','reception')",[id(31),id(32),id(33)]);
await as(1);await cmd('member',{admin_id:id(31),capabilities:['view']});await cmd('member',{admin_id:id(32),capabilities:['view']});await cmd('member',{admin_id:id(33),capabilities:['view','collect']});
const KEYS=/"(cost|total_cost|bom_cost|unit_cost|avg_cost)"/;
const seen=async n=>{await as(n);return use('list',{day:today});};
// nursing: no cost anywhere in the reply
let nl=await seen(31);const txt=JSON.stringify(nl);assert(!KEYS.test(txt),'nursing gets no cost key: '+txt.match(KEYS));
assert.equal(nl.can_see_cost,false);assert.equal(nl.counts.cost,undefined);assert(nl.items.find(i=>i.id===gloves),'items still listed (stock / unit)');
const nrow=nl.rows.find(r=>r.visit_id===visit);assert.equal(nrow.orders[0].lines[0].item,'جلافز M');assert.equal(nrow.orders[0].lines[0].quantity!=null,true,'quantity stays');assert.equal(typeof nrow.orders[0].bom,'boolean');
assert(!/3\.6/.test(txt),'the 3.6 cost value is not in the reply');
// reception with collect: same (no cost), and its save reply has no cost either
let rl=await seen(33);assert(!KEYS.test(JSON.stringify(rl)));assert.equal(rl.can_save,true);
const app3=(await (async()=>{await as(1);return cmd('book',{patient_id:pat,provider_id:pr.id,service_id:sv.id,starts_at:day+'T10:00Z'});})()).id;const visit3=(await cmd('arrive',{id:app3})).id;
await as(33);rl=await use('list',{day:today});const o3=rl.rows.find(r=>r.visit_id===visit3).orders[0].order_id;
const p3={visit_id:visit3,order_id:o3,none:false,lines:[{item_id:gloves,location_id:central,quantity:1}],token:key()};
const s3=await use('save',p3);assert.equal(s3.status,'recorded');assert(!KEYS.test(JSON.stringify(s3)),'save reply without cost');assert.equal(s3.can_see_cost,false);
const r3=await use('save',p3);assert(!KEYS.test(JSON.stringify(r3)),'replay without cost');
// the cost is still recorded for the accounts
assert(+(await owner('select total_cost from clinic_reception.visit_usage where order_id=$1',[o3]))[0].total_cost>0,'cost still stored');
// cost viewers: accountant + super_admin see it
for(const n of [32,1]){const l=await seen(n);assert.equal(l.can_see_cost,true);assert(+l.counts.cost>=3.6,'cost for role '+n);assert(l.items.find(i=>i.id===gloves).cost!=null);}
// no direct access to the full function
await owner('select 1');assert.equal((await owner("select has_function_privilege('authenticated','clinic_reception.visit_usage_full(uuid,text,jsonb)','execute') y"))[0].y,false);
assert.equal((await owner("select has_function_privilege('anon','public.clinic_reception_visit_usage(uuid,text,jsonb)','execute') y"))[0].y,false);
// rollback restores the original
await db.exec(fs.readFileSync('supabase/rollbacks/20261128140000_hide_supply_cost.rollback.sql','utf8'));
await as(31);assert(KEYS.test(JSON.stringify(await use('list',{day:today}))),'rollback = old behaviour');
await db.close();console.log('PASS hide supply cost: nursing / reception get no cost keys (list, lines, items, counts, save, replay), accountant / super_admin still do, cost still stored, inner function not callable, rollback.');}
run().catch(e=>{console.error(e);process.exit(1);});
