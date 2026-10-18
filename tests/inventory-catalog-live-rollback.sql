-- Authorized owner context; test definitions exist only inside this transaction.
begin;
create temp table catalog_qa_state(data jsonb);grant all on catalog_qa_state to authenticated;
select set_config('request.jwt.claim.sub',(select user_id::text from public.admins where id='bd5a528f-af8d-4ada-afe9-ce64e68b1d92' and active),true);
set local role authenticated;
do $$
declare loc uuid:='00000000-0000-4000-8000-000000000001';token uuid:=gen_random_uuid();prefix text:='__CATALOG_QA_'||gen_random_uuid()::text;row jsonb;outcome jsonb;v uuid;payload jsonb;failed boolean;
begin
 row:=jsonb_build_object('name',prefix,'base_unit','قطعة','pack_unit','علبة','units_per_pack',20,'reference_purchase_price',3,'markup_percent',25,'sale_price',3.75,'use_standard_markup',false,'minimum_quantity',0,'consumption_per_patient',1,'track_lots',true);
 outcome:=public.inventory_import_catalog(loc,jsonb_build_array(row),token,true);v:=(outcome->0->>'id')::uuid;
 assert outcome->0->>'sku' ~ '^ITM-[0-9]{7,}$','auto sku missing';
 assert public.inventory_import_catalog(loc,jsonb_build_array(row),token,true)=outcome,'retry mismatch';
 failed:=false;begin perform public.inventory_import_catalog(loc,jsonb_build_array(row||jsonb_build_object('name',prefix||' changed')),token,true);exception when others then failed:=true;end;assert failed,'changed token accepted';
 failed:=false;begin perform public.inventory_import_catalog(loc,jsonb_build_array(row||jsonb_build_object('name',prefix||' rollback'),row),gen_random_uuid(),true);exception when others then failed:=true;end;assert failed,'duplicate accepted';
 payload:=jsonb_build_object('p_id',v,'p_name',prefix,'p_base_unit','قطعة','p_pack_unit','علبة','p_units_per_pack',30,'p_minimum',0,'p_markup',25,'p_sale_price',3.75,'p_use_standard_markup',false);
 failed:=false;begin perform public.inventory_save_catalog(loc,'item',payload);exception when others then failed:=true;end;assert failed,'linked unit factor changed';
 assert exists(select 1 from jsonb_array_elements(public.inventory_workspace_snapshot(loc)->'items') x where x->>'id'=v::text and (x->>'reference_purchase_price')::numeric=3 and x->>'pack_unit'='علبة'),'manager catalog fields missing';
 insert into catalog_qa_state values(jsonb_build_object('id',v,'name',prefix,'token',token));
end $$;
reset role;
do $$declare v uuid:=(select (data->>'id')::uuid from catalog_qa_state);n text:=(select data->>'name' from catalog_qa_state);begin
 assert (select current_sale_price=3.75 and units_per_pack=20 and track_lots from public.inventory_items where id=v),'item values';
 assert exists(select 1 from public.pricing_supplies where inventory_item_id=v and package_price=60 and units_per_package=20 and inventory_quantity_per_unit=1),'pricing map';
 assert not exists(select 1 from public.inventory_items where name=n||' rollback'),'partial batch persisted';
 assert not exists(select 1 from public.inventory_movements where item_id=v),'stock movement created';
 assert not exists(select 1 from public.inventory_lots where item_id=v),'stock lot created';
 assert not exists(select 1 from public.inventory_request_lines where item_id=v),'purchase created';
 assert not has_function_privilege('anon','public.inventory_import_catalog(uuid,jsonb,uuid,boolean)','execute'),'anonymous execution';
end $$;
select set_config('request.jwt.claim.sub','',true);
set local role authenticated;
do $$declare failed boolean:=false;begin
 begin perform public.inventory_import_catalog('00000000-0000-4000-8000-000000000001','[]',gen_random_uuid(),false);exception when others then failed:=true;end;assert failed,'unidentified caller accepted';
 failed:=false;begin perform 1 from clinic_finance.inventory_catalog_prices;exception when insufficient_privilege then failed:=true;end;assert failed,'private cost access';
end $$;
reset role;
select true as catalog_tests_passed,'rollback' as persistence;
rollback;
