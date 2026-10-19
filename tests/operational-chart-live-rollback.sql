-- Production integration through authenticated RPCs using two existing managers.
-- All records are rolled back; no money is sent and no booking message is delivered.
begin;
do $$
declare a1 uuid;a2 uuid;reg uuid;sh uuid;sup uuid;item uuid;ord uuid;inv uuid;advance uuid;contract uuid;payroll uuid;asset uuid;dep uuid;pay uuid;act uuid;ref text:='TEST-CHART-LINKS-'||gen_random_uuid()::text;d date:=(now() at time zone 'Africa/Cairo')::date;snap jsonb;report jsonb;cash_before numeric;result_before numeric;unit_sale numeric;pos_amount numeric;
begin
select user_id into a1 from public.admins a where role='super_admin' and active and user_id is not null and not exists(select 1 from clinic_finance.shifts s where s.cashier_id=a.id and s.status<>'reviewed') order by id limit 1;
select user_id into a2 from public.admins where role='super_admin' and active and user_id is not null and user_id<>a1 order by id limit 1;
if a1 is null or a2 is null then raise exception 'Two existing unused manager accounts required';end if;
perform set_config('request.jwt.claim.sub',a1::text,true);execute 'set local role authenticated';
report:=public.clinic_finance_reports(d,d);cash_before:=(report->>'cash_closing')::numeric;result_before:=(report->>'cumulative_result')::numeric;
reg:=(public.clinic_finance_treasury_command('register_save',jsonb_build_object('name',ref,'treasury_kind','collection','assigned_to',public.my_admin_id(),'account_code','0102010104','parent_register_id',(select treasury_main->>'id' from (select public.clinic_finance_snapshot(d,d)->'treasury_main' treasury_main)s)),gen_random_uuid())->>'id')::uuid;sh:=public.clinic_finance_open_shift(reg,gen_random_uuid());
sup:=public.inventory_save_supplier(null,ref,'','rollback-only',true);
item:=public.inventory_save_item(null,ref,'صنف اختبار تراجع','اختبار','قرص',1,0,150,100);
ord:=public.inventory_create_request('purchase','أمر اختبار تراجع',ref,jsonb_build_array(jsonb_build_object('item_id',item,'quantity',10,'package_cost',40)));
perform set_config('request.jwt.claim.sub',a2::text,true);perform public.inventory_review_request(ord,true,'مراجعة شراء اختبار');
perform set_config('request.jwt.claim.sub',a1::text,true);perform public.clinic_finance_supplier_receive(ord,jsonb_build_array(jsonb_build_object('item_id',item,'quantity',10,'package_cost',40)),ref,gen_random_uuid());
snap:=public.inventory_workspace_snapshot('00000000-0000-4000-8000-000000000001');
select (x->>'current_sale_price')::numeric into unit_sale from jsonb_array_elements(snap->'items')x where x->>'id'=item::text;
pos_amount:=100+2*unit_sale;
inv:=public.clinic_finance_bill(jsonb_build_object('reference',ref,'patient_ref',ref,'description','خدمة واستهلاك اختبار','service_amount',300,'items',jsonb_build_array(jsonb_build_object('item_id',item,'location_id','00000000-0000-4000-8000-000000000001','quantity',2,'sale_price',unit_sale))),gen_random_uuid());
advance:=public.clinic_booking_command('receive',jsonb_build_object('patient_ref',ref,'reference',ref||'-ADV','amount',200,'method','bank'),gen_random_uuid());
perform set_config('request.jwt.claim.sub',a2::text,true);perform public.clinic_booking_command('verify',jsonb_build_object('id',advance,'approve',true,'note','وصول تحويل اختبار'),gen_random_uuid());
perform set_config('request.jwt.claim.sub',a1::text,true);perform public.clinic_booking_command('allocate',jsonb_build_object('advance_id',advance,'invoice_id',inv,'amount',200,'reference',ref||'-USE'),gen_random_uuid());
pay:=public.clinic_finance_collect(inv,sh,'pos',pos_amount,ref||'-POS',gen_random_uuid());
act:=public.clinic_finance_bank_command('pos_request',jsonb_build_object('reference',ref||'-SET','gross',pos_amount,'fee',15),gen_random_uuid());
perform set_config('request.jwt.claim.sub',a2::text,true);perform public.clinic_finance_bank_command('pos_review',jsonb_build_object('id',act,'approve',true,'note','مطابقة تسوية اختبار'),gen_random_uuid());
perform set_config('request.jwt.claim.sub',a1::text,true);contract:=public.clinic_finance_business_command('request',jsonb_build_object('kind','employment','subject',ref,'reference',ref||'-EMP','note','عقد اختبار تراجع','employee_name','موظف اختبار','base',1000,'from',date_trunc('month',d)::date,'to',d+365),gen_random_uuid());
perform set_config('request.jwt.claim.sub',a2::text,true);perform public.clinic_finance_business_command('review',jsonb_build_object('id',contract,'approve',true,'note','اعتماد عقد اختبار'),gen_random_uuid());
perform set_config('request.jwt.claim.sub',a1::text,true);payroll:=public.clinic_finance_business_command('request',jsonb_build_object('kind','payroll','subject',ref,'reference',ref||'-SAL','note','مرتب اختبار تراجع','contract_id',contract,'month',date_trunc('month',d)::date,'allowance',0,'tax',50,'insurance',20,'recovery',0),gen_random_uuid());
perform set_config('request.jwt.claim.sub',a2::text,true);perform public.clinic_finance_business_command('review',jsonb_build_object('id',payroll,'approve',true,'note','اعتماد استحقاق اختبار'),gen_random_uuid());
perform set_config('request.jwt.claim.sub',a1::text,true);asset:=public.clinic_finance_business_command('request',jsonb_build_object('kind','asset','subject',ref||'-ASSET','reference',ref||'-AS','note','أصل اختبار تراجع','amount',1200,'residual',0,'months',12,'start',date_trunc('month',d)::date,'method','bank'),gen_random_uuid());
perform set_config('request.jwt.claim.sub',a2::text,true);perform public.clinic_finance_business_command('review',jsonb_build_object('id',asset,'approve',true,'note','اعتماد أصل اختبار'),gen_random_uuid());
perform set_config('request.jwt.claim.sub',a1::text,true);dep:=public.clinic_finance_business_command('request',jsonb_build_object('kind','depreciation','subject',ref||'-ASSET','reference',ref||'-DEP','note','إهلاك اختبار تراجع','asset_id',asset,'month',date_trunc('month',d)::date),gen_random_uuid());
perform set_config('request.jwt.claim.sub',a2::text,true);perform public.clinic_finance_business_command('review',jsonb_build_object('id',dep,'approve',true,'note','اعتماد إهلاك اختبار'),gen_random_uuid());
snap:=public.clinic_finance_snapshot(d,d);
if (select (x->>'balance')::numeric from jsonb_array_elements(snap->'suppliers')x where x->>'id'=sup::text)<>400 then raise exception 'Supplier payable mismatch';end if;
if (select (x->>'collected')::numeric from jsonb_array_elements(snap->'invoices')x where x->>'id'=inv::text)<>300+2*unit_sale then raise exception 'Advance and POS allocation mismatch';end if;
report:=public.clinic_finance_reports(d,d);
if (report->>'cash_closing')::numeric-cash_before<>2*unit_sale-915 then raise exception 'Cash movement mismatch: %',(report->>'cash_closing')::numeric-cash_before;end if;
if (report->>'cumulative_result')::numeric-result_before<>2*unit_sale-895 then raise exception 'Result mismatch: %',(report->>'cumulative_result')::numeric-result_before;end if;
perform set_config('request.jwt.claim.sub',a1::text,true);perform public.clinic_booking_shift('close',jsonb_build_object('shift_id',sh,'counts',jsonb_build_object('100',0),'note','جرد صفر لأن التحصيل غير نقدي'),gen_random_uuid());
perform set_config('request.jwt.claim.sub',a2::text,true);perform public.clinic_finance_review_shift(sh,'مطابقة وردية اختبار');
execute 'reset role';
if exists(select 1 from clinic_finance.lines group by entry_id having sum(debit-credit)<>0) then raise exception 'Unbalanced ledger';end if;
if (select sum(quantity_delta) from public.inventory_movements where item_id=item)<>8 then raise exception 'Inventory mismatch';end if;
end $$;
rollback;
select jsonb_build_object('test','linked chart authenticated finance rollback passed','remaining_test_invoices',(select count(*) from clinic_finance.invoices where reference like 'TEST-CHART-LINKS-%'),'remaining_test_items',(select count(*) from public.inventory_items where sku like 'TEST-CHART-LINKS-%'),'private_schema_blocked',not has_schema_privilege('authenticated','clinic_finance','usage'),'anonymous_booking_rpc_blocked',not has_function_privilege('anon','public.clinic_booking_command(text,jsonb,uuid)','execute'));
