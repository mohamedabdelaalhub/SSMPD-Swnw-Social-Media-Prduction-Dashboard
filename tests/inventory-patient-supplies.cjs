const scenario=require('./reception-management-pilot.cjs'),assert=require('node:assert/strict'),fs=require('fs');
async function run(){const x=await scenario(true),{b,live,pat,patient,day}=x,{db,as,call,owner,id,key}=b;
await owner('select 1');await db.exec(fs.readFileSync('supabase/migrations/20261017194115_inventory_patient_supply.sql','utf8'));
const location='00000000-0000-4000-8000-000000000001';await as(1);
const item=await call('inventory_save_item',[null,'PATIENT-EXTRA','مستلزم إضافي للاختبار','عام','قطعة',1,0,250,7]);
const lot=(await owner("insert into inventory_lots(item_id,lot_number,expiry_date,received_quantity,unit_cost,created_by) values($1,'EXTRA-LOT','2030-01-01',20,2,$2) returning id",[item,id(1)]))[0].id;
await owner("insert into inventory_movements(item_id,location_id,lot_id,movement_type,quantity_delta,unit_cost,reference_type,created_by) values($1,$2,$3,'opening_balance',20,2,'opening',$4)",[item,location,lot,id(1)]);
await as(1);let ctx=await call('inventory_patient_supply_context',[location,item,'مريض',null]);assert.equal(ctx.patients[0].patient_id,patient);assert.equal(ctx.visits.length,0);
ctx=await call('inventory_patient_supply_context',[location,item,'',patient]);assert.equal(ctx.visits.length,1);assert.equal(+ctx.item.sale_price,7);
const visit=ctx.visits[0],inv=ctx.invoices[0],payload={workspace_id:live,patient_id:patient,visit_id:visit.id,invoice_id:inv.id,location_id:location,item_id:item,quantity:2,sale_price:7,note:'كمية إضافية خارج الخدمة',repeat_confirmed:false,patient_confirmed:true};
async function issue(p=payload,k=key()){return call('inventory_dispense_patient',[p,k]);}
await assert.rejects(()=>issue({...payload,patient_id:key()}),/لا تخص/);
await assert.rejects(()=>issue({...payload,invoice_id:key()}),/الفاتورة لا تخص/);
await assert.rejects(()=>issue({...payload,sale_price:6}),/سعر بيع الصنف تغير/);
await assert.rejects(()=>issue({...payload,note:''}),/وضح سبب/);
await assert.rejects(()=>issue({...payload,patient_confirmed:false}),/أكد موافقة/);
const token=key(),res=await issue(payload,token);assert.equal(+res.amount,14);assert.equal(res.invoice_id,inv.id);assert.deepEqual(await issue(payload,token),res);
await assert.rejects(()=>issue({...payload,quantity:3},token),/مفتاح إعادة المحاولة/);
await assert.rejects(()=>issue(),/سبق صرف/);
await assert.rejects(()=>issue({...payload,quantity:500,repeat_confirmed:true}),/المخزون المتاح غير كاف/);
assert.equal((await owner('select count(*)::int n from clinic_reception.patient_supplies'))[0].n,1);
const balance=(await owner('select inventory_location_balance($1,$2) q',[location,item]))[0];assert.equal(+balance.q,18);
assert.equal((await owner("select count(*)::int n from clinic_finance.entries where source='reception_extra_material'"))[0].n,1);
const cost=(await owner("select sum(l.debit)::numeric amount from clinic_finance.entries e join clinic_finance.lines l on l.entry_id=e.id where e.source='reception_stock_cost' and l.account='5121'"))[0];assert.equal(+cost.amount,4);
const ps=(await owner('select * from clinic_reception.patient_supplies'))[0];assert.equal(+ps.cost,4);
const native=(await owner("select * from inventory_movements where item_id=$1 and quantity_delta<0",[item]))[0];assert.equal(native.patient_invoice_ref,'RX-'+inv.invoice_no);assert(native.note.includes('كمية إضافية'));
await as(1);ctx=await call('inventory_patient_supply_context',[location,item,'',patient]);assert.equal(ctx.previous.length,1);assert.equal(+ctx.invoices[0].amount,+inv.amount+14);
const shared=await call('clinic_reception_shared_records',['patient',patient,day,day,0]);assert.equal(shared.invoices.find(i=>i.id===inv.id).additional_supplies[0].name,'مستلزم إضافي للاختبار');
const snap=await call('clinic_reception_snapshot',[live,day,day]);assert(snap.invoice_materials.some(i=>i.invoice_id===inv.id&&i.note===payload.note));
const report=await call('clinic_reception_report',[live,day,day]);assert.equal(+report.patient_supplies[0].revenue,14);assert.equal(+report.patient_supplies[0].cost,4);
const dimensions=(await owner("select dimensions from clinic_reception.journal where source='stock_cost' and dimensions->>'patient_supply_id'=$1",[res.id]))[0].dimensions;assert.equal(dimensions.invoice_id,inv.id);assert.equal(dimensions.visit_id,visit.id);
await as(1);await issue({...payload,quantity:1,repeat_confirmed:true});
await assert.rejects(()=>call('inventory_consume_at',[location,item,1,'issue','']),/سبب الاستهلاك/);
await assert.rejects(()=>call('inventory_consume_at',[location,item,1,'issue','على مريض','RX-12']),/ربطه بالزيارة/);
// The service's included item is already issued: no silent repeat.
const included=(await owner('select inventory_item_id from clinic_reception.items where id=(select item_id from clinic_reception.movements where kind=$1 limit 1)',['included']))[0].inventory_item_id;
await as(1);const includedCtx=await call('inventory_patient_supply_context',[location,included,'',patient]);
await assert.rejects(()=>issue({...payload,item_id:included,sale_price:+includedCtx.item.sale_price}),/سبق صرف/);
// Before service execution: one real supply statement; planned BOM cannot be withdrawn here.
let newer=await call('clinic_reception_snapshot',[live,day,day]);const pr=newer.providers.find(p=>p.active),sv=newer.services.find(s=>s.active);
const cmd=(action,p)=>call('clinic_reception_command',[live,action,p,key()]);
await cmd('availability',{provider_id:pr.id,starts_at:day+'T12:00Z',ends_at:day+'T16:00Z'});
const app=(await cmd('book',{patient_id:pat,provider_id:pr.id,service_id:sv.id,starts_at:day+'T12:00Z'})).id;
const secondVisit=(await cmd('arrive',{id:app})).id;
const firstExtra={...payload,visit_id:secondVisit,invoice_id:null,quantity:1,repeat_confirmed:false};
await assert.rejects(()=>issue({...firstExtra,item_id:included,sale_price:+includedCtx.item.sale_price}),/ضمن خدمة لم تنفذ/);
const supplement=await issue(firstExtra);assert.notEqual(supplement.invoice_id,inv.id);
assert.equal((await owner('select clinic_reception.service_value($1) v',[supplement.invoice_id]))[0].v,'0');
await as(1);await assert.rejects(()=>issue({...firstExtra,repeat_confirmed:true}),/اختر فاتورة الزيارة/);
newer=await call('clinic_reception_snapshot',[live,day,day]);const ord=newer.orders.find(o=>o.visit_id===secondVisit),rxItem=newer.items.find(i=>i.inventory_item_id===item),rxIncluded=newer.items.find(i=>i.inventory_item_id===included),mappedLocation=newer.locations.find(l=>l.inventory_location_id===location);
await assert.rejects(()=>cmd('execute',{id:ord.id,location_id:mappedLocation.id,additional_confirmed:true,materials:[{item_id:rxIncluded.id,quantity:6},{item_id:rxItem.id,quantity:1}]}),/سبق صرف هذا المستلزم/);
await cmd('execute',{id:ord.id,location_id:mappedLocation.id});
assert.equal((await owner('select count(*)::int n from clinic_reception.invoices where visit_id=$1',[secondVisit]))[0].n,2);
assert.equal(+(await owner('select inventory_location_balance($1,$2) q',[location,item]))[0].q,16);
assert.equal(+(await owner('select count(*)::int n from clinic_finance.entries e join clinic_finance.lines l on l.entry_id=e.id group by e.id having sum(l.debit)<>sum(l.credit)')) .length,0);
// Permissions retain the connected two-person pilot and private-table boundary.
for(const n of [2,4,6]){await as(n);await assert.rejects(()=>call('inventory_patient_supply_context',[location,item,'مريض',null]),/المتصل متاح|صلاحية/);await assert.rejects(()=>issue(),/المتصل متاح|صلاحية/);}
await owner("select 1");assert.equal((await owner("select has_function_privilege('anon','public.inventory_dispense_patient(jsonb,uuid)','execute') yes"))[0].yes,false);assert.equal((await owner("select has_table_privilege('authenticated','clinic_reception.patient_supplies','insert') yes"))[0].yes,false);
await owner("update clinic_reception.visits set status='completed',closed_at=now() where id=$1",[visit.id]);await as(1);await assert.rejects(()=>issue({...payload,repeat_confirmed:true}),/زيارة مفتوحة/);
await db.close();console.log('PASS patient supply: canonical patient/visit/invoice, event revenue and actual cost, stock once, replay, mismatch/price/reason/stock/duplicate/closed-visit guards, statements/reports and pilot permissions.');}
run().catch(e=>{console.error(e.message,e.where,e.stack);process.exit(1);});
