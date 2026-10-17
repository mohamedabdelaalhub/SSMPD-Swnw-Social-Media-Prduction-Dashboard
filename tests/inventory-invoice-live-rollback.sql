-- Technical transaction test only; no approval or transaction survives rollback.
begin;
do $$declare u1 uuid;u2 uuid;sid uuid;it uuid;ord uuid;rc uuid;k uuid;ref text:='TEST-INVOICE-EXPIRY-'||gen_random_uuid();d date:=(now() at time zone 'Africa/Cairo')::date;ls jsonb;v jsonb;c numeric;idx int:=0;begin
 select user_id into u1 from public.admins where role='super_admin' and active and user_id is not null order by id limit 1;
 select user_id into u2 from public.admins where role='super_admin' and active and user_id is not null and user_id<>u1 order by id limit 1;
 if u1 is null or u2 is null then raise exception 'Two existing manager identities required for rollback test';end if;
 perform set_config('request.jwt.claim.sub',u1::text,true);execute 'set local role authenticated';
 sid:=public.inventory_save_supplier(null,ref,'','technical rollback fixture',true);
 it:=public.inventory_save_item(null,ref,ref,'اختبار','قطعة',10,0,20,0);perform public.inventory_set_track_lots(it,true);
 foreach c in array array[5,7,4] loop idx:=idx+1;
  ord:=public.inventory_create_request('purchase','technical rollback fixture',ref,jsonb_build_array(jsonb_build_object('item_id',it,'quantity',10,'unit_cost',c,'production_date',d,'shelf_life_months',24,'lot_number',ref||idx)));
  perform set_config('request.jwt.claim.sub',u2::text,true);perform public.inventory_review_request(ord,true,'technical rollback test only');perform set_config('request.jwt.claim.sub',u1::text,true);
  ls:=jsonb_build_array(jsonb_build_object('item_id',it,'quantity',10,'package_cost',c*10,'production_date',d,'shelf_life_months',24,'lot_number',ref||idx));k:=gen_random_uuid();
  rc:=public.inventory_receive_invoice(ord,ls,ref||idx,d,'',k);
  if public.inventory_receive_invoice(ord,ls,ref||idx,d,'',k)<>rc then raise exception 'Idempotency failed';end if;
 end loop;
 v:=public.inventory_workspace_snapshot('00000000-0000-4000-8000-000000000001');
 if not exists(select 1 from jsonb_array_elements(v->'items') x where x->>'id'=it::text and (x->>'current_sale_price')::numeric=8.4 and (x->>'highest_purchase_cost')::numeric=7) then raise exception 'Highest pricing mismatch';end if;
 execute 'reset role';
 if clinic_finance.supplier_balance(sid)<>160 then raise exception 'Payable mismatch';end if;
 if (select sum(invoice_total) from clinic_finance.supplier_receipts where supplier_id=sid)<>160 then raise exception 'Invoice totals mismatch';end if;
 if (select count(*) from public.inventory_lots where item_id=it and production_date=d and shelf_life_months=24 and expiry_date=(d+interval '24 months')::date)<>3 then raise exception 'Batch dates mismatch';end if;
 if exists(select 1 from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id join public.inventory_movements m on e.source_id=m.id where m.item_id=it group by e.id having sum(l.debit-l.credit)<>0) then raise exception 'Unbalanced purchase entries';end if;
end $$;
rollback;
select jsonb_build_object('result','invoice pricing/batch/payable rollback passed','remaining_test_items',(select count(*) from public.inventory_items where sku like 'TEST-INVOICE-EXPIRY-%'),'remaining_test_suppliers',(select count(*) from public.inventory_suppliers where name like 'TEST-INVOICE-EXPIRY-%'));
