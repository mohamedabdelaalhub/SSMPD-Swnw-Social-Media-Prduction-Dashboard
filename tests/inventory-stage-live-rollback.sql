-- Technical test only. All test orders/receipts/read markers are rolled back.
begin;
do $$declare u1 uuid;u2 uuid;it uuid;sid uuid;o uuid;v jsonb;n jsonb;oldkey text;newkey text;d date:=(now() at time zone 'Africa/Cairo')::date;ref text:='TEST-STAGE-'||gen_random_uuid();begin
 select user_id into u1 from public.admins where role='super_admin' and active and user_id is not null order by id limit 1;
 select user_id into u2 from public.admins where role='super_admin' and active and user_id is not null and user_id<>u1 order by id limit 1;
 if u1 is null or u2 is null then raise exception 'Two existing manager identities required for transaction rollback test';end if;
 perform set_config('request.jwt.claim.sub',u1::text,true);execute 'set local role authenticated';
 sid:=public.inventory_save_supplier(null,ref,'','rollback fixture',true);it:=public.inventory_save_item(null,ref,ref,'اختبار','قطعة',1,0,20,0);
 o:=public.inventory_create_request('purchase','rollback fixture',ref,jsonb_build_array(jsonb_build_object('item_id',it,'quantity',3,'unit_cost',5)));
 select x into n from jsonb_array_elements(public.personal_home_inbox()->'notices') x where x->>'id'=o::text;
 if n is null or n->>'message' not like '%بانتظار المراجعة%' then raise exception 'Pending notice missing';end if;oldkey:=n->>'key';
 perform public.personal_home_read(array[oldkey]);
 if not exists(select 1 from jsonb_array_elements(public.personal_home_inbox()->'notices') x where x->>'key'=oldkey and (x->>'read')::boolean) then raise exception 'Read state missing';end if;
 perform set_config('request.jwt.claim.sub',u2::text,true);v:=public.inventory_request_detail(o);if not (v->>'can_review')::boolean then raise exception 'Review route missing';end if;perform public.inventory_review_request(o,true,'technical rollback only');
 perform set_config('request.jwt.claim.sub',u1::text,true);v:=public.inventory_request_detail(o);if v->>'status'<>'approved' or not (v->>'can_receive')::boolean then raise exception 'Approved route missing';end if;
 for j in 1..3 loop
  perform public.inventory_receive_invoice(o,jsonb_build_array(jsonb_build_object('item_id',it,'quantity',1,'package_cost',5)),ref||j,d,'',gen_random_uuid());
  select x into n from jsonb_array_elements(public.personal_home_inbox()->'notices') x where x->>'id'=o::text;newkey:=n->>'key';
  if newkey is null or newkey=oldkey or (n->>'read')::boolean then raise exception 'New stage read key missing';end if;oldkey:=newkey;
  v:=public.inventory_request_detail(o);if (v->>'status')<>(case when j<3 then 'partial' else 'completed' end) then raise exception 'Current stage mismatch';end if;
 end loop;
 execute 'reset role';
end $$;
rollback;
select jsonb_build_object('result','request stage/read/partial/current-detail rollback passed','remaining_test_requests',(select count(*) from public.inventory_requests where supplier_name like 'TEST-STAGE-%'),'remaining_test_items',(select count(*) from public.inventory_items where sku like 'TEST-STAGE-%'),'anonymous_detail',has_function_privilege('anon','public.inventory_request_detail(uuid)','execute'),'private_inbox_bypass',has_function_privilege('authenticated','clinic_finance.home_inbox_before_inventory_stages()','execute'));
