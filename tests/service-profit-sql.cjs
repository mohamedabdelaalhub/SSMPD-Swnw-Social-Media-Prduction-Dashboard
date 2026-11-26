// «ربح كل خدمة بعد المستلزمات» (20261125233000): the report function on PGlite with the wave 5/7 helpers stubbed by fixed rows.
// Checks: revenue = net − contractual, supplies actual, per-visit over visits with usage, planned BOM from the price model × quantity,
// margin after supplies and after doctor + referral fees, status (below / missing / no_supplies / ok), sold extras, totals, gate called.
const {PGlite}=require('@electric-sql/pglite'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{const db=new PGlite();
await db.exec(`create role authenticated;create role anon;create schema clinic_reception;
create table public.report_registry(code text primary key,title text,area text,sort int,sensitive boolean,active boolean default true);
create table public.report_access(report_code text,role text,admin_id uuid);
create table public.gate_log(code text);
create function public.report_require(p text) returns void language sql as $$insert into public.gate_log values(p)$$;
create function public.report_check_period(a date,b date) returns void language sql as $$select$$;
create table clinic_reception.visit_usage(order_id uuid);
create table public.pricing_supplies(id uuid primary key,package_price numeric,units_per_package numeric);
create table public.pricing_services(id uuid primary key,supplies_used jsonb);
create table clinic_reception.services(id uuid primary key,pricing_service_id uuid);
create table clinic_reception.orders(id uuid primary key,service_id uuid,quantity numeric);
create table public.oc(order_id uuid,workspace_id uuid,day date,service text,specialty text,provider_id uuid,doctor text,visit_id uuid,net numeric,contractual numeric,doctor_fee numeric,referral_fee numeric,supplies numeric);
create function public.report_order_costs(a date,b date,c uuid) returns table(order_id uuid,workspace_id uuid,day date,service text,specialty text,provider_id uuid,doctor text,visit_id uuid,net numeric,contractual numeric,doctor_fee numeric,referral_fee numeric,supplies numeric) language sql as $$select * from public.oc$$;
create table public.so(day date,location_id uuid,location text,branch_name text,is_pharmacy boolean,item_id uuid,item text,category text,unit text,is_medicine boolean,reason text,quantity numeric,cost numeric,sale numeric,order_id uuid,service text,specialty text);
create function public.report_stock_out(a date,b date,c uuid) returns table(day date,location_id uuid,location text,branch_name text,is_pharmacy boolean,item_id uuid,item text,category text,unit text,is_medicine boolean,reason text,quantity numeric,cost numeric,sale numeric,order_id uuid,service text,specialty text) language sql as $$select * from public.so$$;`);
const sql=fs.readFileSync('supabase/migrations/20261125233000_service_profit_report.sql','utf8');await db.exec(sql);
await assert.rejects(()=>db.exec(sql),/تم تطبيق هذا الملف من قبل/);await db.exec('rollback');
assert.deepEqual((await db.query("select role from report_access where report_code='service_profit'")).rows.map(r=>r.role),['financial_manager']);
const u=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
// price model: drip service plans 2 units of a 50/2 supply (= 50) per order
await db.query("insert into pricing_supplies values($1,50,2)",[u(900)]);
await db.query("insert into pricing_services values($1,$2::jsonb),($3,'[]'::jsonb)",[u(800),JSON.stringify([{supply_id:u(900),quantity:2}]),u(801)]);
await db.query("insert into clinic_reception.services values($1,$2),($3,$4),($5,null)",[u(700),u(800),u(701),u(801),u(702)]);
const orders=[[1,700,1],[2,700,1],[3,700,2],[4,701,1],[5,701,1],[6,702,1]];
for(const [o,s,q] of orders)await db.query("insert into clinic_reception.orders values($1,$2,$3)",[u(o),u(s),q]);
// drip: 3 orders, revenue 100 each (one with 10 insurer cut), supplies 60+60+0 → order 3 missing usage; doctor 20 each
const oc=[[1,'محلول','تمريض',100,0,20,0,60],[2,'محلول','تمريض',100,10,20,0,60],[3,'محلول','تمريض',100,0,20,5,0],
 [4,'كشف','عيادات',300,0,100,0,0],[5,'كشف','عيادات',300,0,100,0,0],[6,'غيار','تمريض',50,0,0,0,70]];
for(const [o,s,sp,n,c,d,r,sup] of oc)await db.query("insert into oc values($1,null,'2026-11-25',$2,$3,null,null,null,$4,$5,$6,$7,$8)",[u(o),s,sp,n,c,d,r,sup]);
await db.query("insert into clinic_reception.visit_usage values($1)",[u(6)]);
await db.query("insert into so(item,unit,is_medicine,reason,quantity,cost,sale,service) values ('سِت محلول','قطعة',false,'included',2,120,0,'محلول'),('شاش','قطعة',false,'included',1,70,0,'غيار'),('بانادول','علبة',true,'sold',3,30,45,null),('سرنجة','قطعة',false,'sold',5,10,20,null),('ضايع','قطعة',false,'waste',1,9,0,null)");
const v=(await db.query("select public.report_service_profit('2026-11-01','2026-11-30') v")).rows[0].v;
assert.deepEqual((await db.query("select code from gate_log")).rows.map(r=>r.code),['service_profit']);
const by=Object.fromEntries(v.rows.map(r=>[r.service,r]));
const d=by['محلول'];
assert.equal(+d.orders,3);assert.equal(+d.revenue,290);assert.equal(+d.supplies,120);assert.equal(+d.used_orders,2);assert.equal(+d.per_visit,60);
assert.equal(+d.bom,200,'50 per unit × (1+1+2)');assert.equal(+d.bom_per_visit,66.67);assert.equal(+d.missing,1);assert.equal(d.status,'missing');
assert.equal(+d.margin,170);assert.equal(+d.doctor_fees,65);assert.equal(+d.net_margin,105);assert.equal(+d.margin_pct,58.6);assert.equal(+d.net_margin_pct,36.2);
const k=by['كشف'];assert.equal(k.status,'no_supplies');assert.equal(+k.missing,0,'no BOM and no usage → not «ناقص»');assert.equal(k.per_visit,null);assert.equal(+k.net_margin,400);
const g=by['غيار'];assert.equal(g.status,'below');assert.equal(+g.margin,-20);assert.equal(v.rows[0].service,'غيار','below first');
assert.deepEqual(v.items['محلول'],[{item:'سِت محلول',unit:'قطعة',qty:2,cost:120}]);
const sold=Object.fromEntries(v.sold.map(s=>[s.kind,s]));assert.equal(+sold.medicines.profit,15);assert.equal(+sold.medicines.pct,33.3);assert.equal(+sold.nursing.sale,20);
assert.equal(+v.totals.revenue,940);assert.equal(+v.totals.supplies,190);assert.equal(+v.totals.below,1);assert.equal(+v.totals.missing,1);assert.equal(+v.totals.net_margin,940-190-265);
assert.equal(v.costs_from,'2026-11-24');
const acl=(await db.query("select proacl::text a from pg_proc where proname='report_service_profit'")).rows[0].a;assert(!/anon=/.test(acl)&&/authenticated=X/.test(acl),acl);
console.log('PASS service profit report SQL: revenue/supplies/per-visit/BOM/margins/doctor fees/status/items/sold/totals, gate + grants');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
