-- All configuration, inventory, payable, transfer and identity fixtures are rolled back.
begin;
do $$declare u1 uuid;u2 uuid;a2 uuid;it uuid;o uuid;lot uuid;rc uuid;k uuid:=gen_random_uuid();v jsonb;lines jsonb;branch uuid;dest uuid;tr uuid;ref text:='TEST-STANDARD-'||gen_random_uuid();d date:=(now() at time zone 'Africa/Cairo')::date;rate numeric;blocked boolean:=false;begin
 select user_id into u1 from public.admins where role='super_admin' and active and user_id is not null order by id limit 1;
 select user_id,id into u2,a2 from public.admins where role='super_admin' and active and user_id is not null and user_id<>u1 order by id limit 1;
 if u1 is null or u2 is null then raise exception 'Two existing manager identities required for rollback';end if;
 if not exists(select 1 from public.inventory_items where use_standard_markup) then
  perform set_config('request.jwt.claim.sub',u1::text,true);execute 'set local role authenticated';perform public.inventory_set_standard_markup(20,false);execute 'reset role';
 end if;
 select markup_percent into rate from clinic_finance.inventory_pricing_settings where id and configured;
 perform set_config('request.jwt.claim.sub',u1::text,true);execute 'set local role authenticated';
 it:=public.inventory_save_item(null,ref,ref,'اختبار','قطعة',1,0,999,0);perform public.inventory_set_track_lots(it,true);
 v:=public.inventory_workspace_snapshot('00000000-0000-4000-8000-000000000001');if not exists(select 1 from jsonb_array_elements(v->'items') x where x->>'id'=it::text and (x->>'markup_percent')::numeric=rate and (x->>'use_standard_markup')::boolean) then raise exception 'Standard inheritance mismatch';end if;
 perform public.inventory_save_supplier(null,ref,'','rollback fixture',true);
 o:=public.inventory_create_request('purchase','rollback fixture',ref,jsonb_build_array(jsonb_build_object('item_id',it,'quantity',2,'unit_cost',5)));
 perform set_config('request.jwt.claim.sub',u2::text,true);perform public.inventory_review_request(o,true,'technical rollback only');perform set_config('request.jwt.claim.sub',u1::text,true);
 lines:=jsonb_build_array(jsonb_build_object('item_id',it,'quantity',2,'package_cost',5,'lot_code_missing',true,'lot_number','','expiry_date',d+730));
 rc:=public.inventory_receive_invoice(o,lines,ref,d,'',k);if public.inventory_receive_invoice(o,lines,ref,d,'',k)<>rc then raise exception 'Receipt replay mismatch';end if;
 v:=public.inventory_tracking_codes('00000000-0000-4000-8000-000000000001',ref,0);if (v->>'total')::integer<>1 or (v->'rows'->0->>'code') not like 'INT-%' or v->'rows'->0->>'invoice_reference'<>ref then raise exception 'Tracking registry mismatch';end if;lot:=(v->'rows'->0->>'id')::uuid;
 -- Transfer setup is temporary and follows the same assignment API used by the repair button.
 branch:=public.inventory_save_structure(ref,null,null,true);select id into dest from public.inventory_locations where branch_id=branch and active order by id limit 1;
 begin perform public.inventory_create_transfer('00000000-0000-4000-8000-000000000001',dest,null,jsonb_build_array(jsonb_build_object('item_id',it,'quantity',1)),ref);exception when others then if sqlerrm like '%مستلم%' then blocked:=true;else raise;end if;end;
 if not blocked then raise exception 'Missing receiver accepted';end if;
 perform public.inventory_assign_location(dest,a2,'receiver',true);
 tr:=public.inventory_create_transfer('00000000-0000-4000-8000-000000000001',dest,a2,jsonb_build_array(jsonb_build_object('item_id',it,'quantity',1)),ref);
 if tr is null then raise exception 'Assigned receiver transfer failed';end if;
 execute 'reset role';
end $$;
rollback;
select jsonb_build_object('result','standard inheritance/internal tracking/receipt retry/receiver repair rollback passed','remaining_test_items',(select count(*) from public.inventory_items where sku like 'TEST-STANDARD-%'),'remaining_test_branches',(select count(*) from public.inventory_branches where name like 'TEST-STANDARD-%'),'remaining_test_suppliers',(select count(*) from public.inventory_suppliers where name like 'TEST-STANDARD-%'),'anonymous_registry',has_function_privilege('anon','public.inventory_tracking_codes(uuid,text,integer)','execute'),'anonymous_settings',has_function_privilege('anon','public.inventory_set_standard_markup(numeric,boolean)','execute'));
