// 20261122300000_medicines_pricing_discount: pricing kind (supply / medicine / shortage), medicines never marked up,
// month-end supplier discount (accountant creates, financial manager reviews; 2111 → 4118; supplier balance drops).
const boot=require('./helpers/clinic-finance.cjs'),fs=require('fs'),assert=require('node:assert/strict');
const mig=f=>fs.readFileSync('supabase/migrations/'+f,'utf8');
async function run(){const b=await boot(['clinic_doctor_settlements','clinic_supplier_finance','clinic_bank_insurance','clinic_payroll_assets_tax','clinic_opening_reports','clinic_booking_advances','clinic_legacy_assets','clinic_register_directions_payments','inventory_accounting_links']),{db,as,call,owner,key,id}=b;
for(const f of ['20261017182845_inventory_invoice_expiry_pricing.sql','20261017190930_inventory_standard_markup_batch_codes.sql','20261122300000_medicines_pricing_discount.sql'])await db.exec(mig(f));
await assert.rejects(()=>db.exec(mig('20261122300000_medicines_pricing_discount.sql')),/تم تطبيق/);await db.exec('rollback');
await db.exec('create table if not exists pricing_supplies(inventory_item_id uuid,package_price numeric,inventory_quantity_per_unit numeric,units_per_package numeric)');
const today=new Date().toLocaleDateString('en-CA',{timeZone:'Africa/Cairo'}),month=today.slice(0,7)+'-01';
await as(1);const supplier=await call('inventory_save_supplier',[null,'شركة أدوية تجريبية','','',true]);
const med=await call('inventory_save_item',[null,'KET','كيتولاك أمبول','أدوية','أمبول',1,0,0,0]);
const short=await call('inventory_save_item',[null,'SHO','دواء ناقص تجريبي','أدوية','أمبول',1,0,0,0]);
const glove=await call('inventory_save_item',[null,'GLV','جلافز','عام','قطعة',1,0,0,0]);
// pricing kinds
let r=await call('inventory_set_pricing_kind',[med,'medicine',null]);assert.equal(r.pricing_kind,'medicine');assert.equal(+r.markup_percent,0);
r=await call('inventory_set_pricing_kind',[short,'shortage',null]);assert.equal(+r.markup_percent,35);
r=await call('inventory_set_pricing_kind',[glove,'supply',35]);assert.equal(+r.markup_percent,35);
await assert.rejects(()=>call('inventory_set_pricing_kind',[glove,'other',null]),/غير معروف/);
await as(4);await assert.rejects(()=>call('inventory_set_pricing_kind',[glove,'supply',10]),/لمسؤول المخزن|صلاحية/);
await as(1);const pl=await call('inventory_pricing_list',[]);assert.equal(pl.find(x=>x.id===med).pricing_kind,'medicine');
// purchases: 2 invoices this month (one with a shortage line)
async function buy(lines,ref){await as(1);const order=await call('inventory_create_request',['purchase','توريد أدوية','شركة أدوية تجريبية',lines.map(l=>({item_id:l.item,quantity:l.q,unit_cost:l.c}))]);await as(3);await call('inventory_review_request',[order,true,'ok']);await as(1);
 return call('inventory_receive_invoice',[order,lines.map(l=>({item_id:l.item,quantity:l.q,package_cost:l.c})),ref,today,'',key()]);}
await buy([{item:med,q:100,c:24}],'PH-1');await buy([{item:med,q:50,c:24},{item:short,q:10,c:100}],'PH-2');
const prices=Object.fromEntries((await owner('select id,current_sale_price p,markup_percent m from inventory_items')).map(x=>[x.id,x]));
assert.equal(+prices[med].p,24,'medicine sold at public price');assert.equal(+prices[med].m,0);
assert.equal(+prices[short].p,135,'shortage = cost + 35%');
// the standard markup «apply to all» cannot mark a medicine up (trigger)
await owner('update inventory_items set markup_percent=35,current_sale_price=32.4 where id=$1',[med]);
const after=(await owner('select markup_percent m,current_sale_price p from inventory_items where id=$1',[med]))[0];assert.equal(+after.m,0);assert.equal(+after.p,24);
// month-end discount
const before=+(await owner('select clinic_finance.supplier_balance($1) v',[supplier]))[0].v;assert.equal(before,4600);
const disc=(a,p)=>call('clinic_finance_supplier_discount',[a,p]);
await as(2);let pv=await disc('preview',{supplier_id:supplier,month});assert.equal(pv.invoices.length,2);assert.equal(+pv.basis,3600,'shortage line excluded');
assert.equal(+pv.invoices.find(i=>i.reference==='PH-2').excluded,1000);
await assert.rejects(()=>disc('create',{supplier_id:supplier,month,token:key()}),/واحد بس/);
await assert.rejects(()=>disc('create',{supplier_id:supplier,month,amount:5000,token:key()}),/مايزيدش/);
const tok=key(),d=await disc('create',{supplier_id:supplier,month,percent:12,token:tok,document_url:'https://example.test/n.pdf'});
assert.equal(+d.amount,432);assert.equal(d.status,'pending');assert.equal((await disc('create',{supplier_id:supplier,month,percent:12,token:tok})).id,d.id);
await assert.rejects(()=>disc('create',{supplier_id:supplier,month,percent:10,token:key()}),/قبل كده/);
await assert.rejects(()=>disc('review',{id:d.id,approve:true}),/صلاحية/); // accountant cannot review
assert.equal(+(await owner('select clinic_finance.supplier_balance($1) v',[supplier]))[0].v,before,'nothing posted before review');
await as(3);await assert.rejects(()=>disc('review',{id:d.id,approve:false,note:''}),/سبب الرفض/);
const ok=await disc('review',{id:d.id,approve:true,note:'مطابق للإشعار'});assert.equal(ok.status,'approved');
await assert.rejects(()=>disc('review',{id:d.id,approve:true}),/قبل كده/);
assert.equal(+(await owner('select clinic_finance.supplier_balance($1) v',[supplier]))[0].v,before-432);
const lines=await owner("select l.account,l.debit,l.credit from clinic_finance.entries e join clinic_finance.lines l on l.entry_id=e.id where e.source='supplier_month_discount'");
assert.deepEqual(lines.map(x=>[x.account,+x.debit,+x.credit]).sort(),[['2111',432,0],['4118',0,432]]);
// self-review is refused (creator = reviewer) — super admin creates, then reviews
await as(1);const other=await call('inventory_save_supplier',[null,'مورد أدوية تاني','','',true]);
await as(1);const o2=await call('inventory_create_request',['purchase','x','مورد أدوية تاني',[{item_id:med,quantity:10,unit_cost:24}]]);await as(3);await call('inventory_review_request',[o2,true,'ok']);await as(1);await call('inventory_receive_invoice',[o2,[{item_id:med,quantity:10,package_cost:24}],'PH-9',today,'',key()]);
const d2=await disc('create',{supplier_id:other,month,amount:20,token:key()});await assert.rejects(()=>disc('review',{id:d2.id,approve:true}),/شخص غير/);
// report + list
await as(3);const rep=await disc('report',{month});assert.equal(+rep.discounts,432);
assert.equal(rep.suppliers.find(s=>s.supplier==='شركة أدوية تجريبية').status,'approved');assert.equal(rep.suppliers.find(s=>s.supplier==='مورد أدوية تاني').status,'pending');
assert.equal((await disc('list',{month})).length,2);
await as(4);await assert.rejects(()=>disc('report',{month}),/صلاحية/);
await owner('select 1');assert.equal((await owner("select has_table_privilege('authenticated','clinic_finance.supplier_month_discounts','select') y"))[0].y,false);
const unb=await owner('select e.id from clinic_finance.entries e join clinic_finance.lines l on l.entry_id=e.id group by e.id having sum(l.debit)<>sum(l.credit)');assert.equal(unb.length,0);
await db.close();console.log('PASS medicines: pricing kinds (medicine 0% at public price even after apply-all, shortage 35%, supply per-item), month-end discount preview (shortage excluded), %/amount, one per supplier+month, accountant creates, financial manager reviews (not self), 2111→4118, supplier balance, report/list, privileges.');}
run().catch(e=>{console.error(e);process.exit(1);});
