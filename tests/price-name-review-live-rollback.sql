-- Rule 9 live check for «مراجعة أسماء الجهات» — AS THE OWNER, the exact payloads the buttons send, then ROLLBACK.
-- «هي دي» / «اختار خدمة تانية» → price_service_mapping_command source_review; «مش عندنا» (single + bulk) → source_defer.
-- «بعدين» writes nothing. Run: psql -v ON_ERROR_STOP=1 -f tests/price-name-review-live-rollback.sql
begin;
select set_config('request.jwt.claims','{"sub":"21a0b295-f4ca-472d-b48b-7be456cf0c64","role":"authenticated"}',true);
create temp table nr_result(step text,ok boolean,detail jsonb) on commit drop;
do $$
declare l clinic_prices.lists%rowtype;b clinic_prices.batches%rowtype;i1 int;i2 int;sid uuid;res jsonb;r1 jsonb;r2 jsonb;
begin
 if public.my_admin_id() is distinct from 'bd5a528f-af8d-4ada-afe9-ce64e68b1d92'::uuid then raise exception 'wrong actor';end if;
 -- the screen reads exactly these two RPCs
 perform public.price_lists_workspace();
 select * into l from clinic_prices.lists where list_kind='reference' and status='draft' and deleted_at is null and clinic_prices.can_edit(id) and valid_to>=current_date order by name limit 1;
 perform public.price_service_mapping_workspace(l.id);
 select * into b from clinic_prices.batches where list_id=l.id and status='draft' order by created_at limit 1;
 select min(o.i-1) into i1 from jsonb_array_elements(b.rows) with ordinality o(x,i) where not coalesce((o.x->>'confirmed')::boolean,false) and coalesce(o.x->>'review_status','') not in ('deferred','proposed') and (o.x->>'price')::numeric>0;
 select min(o.i-1) into i2 from jsonb_array_elements(b.rows) with ordinality o(x,i) where o.i-1>i1 and not coalesce((o.x->>'confirmed')::boolean,false) and coalesce(o.x->>'review_status','') not in ('deferred','proposed');
 select s.id into sid from public.pricing_services s where s.active and not exists(select 1 from clinic_prices.items it where it.list_id=l.id and it.service_id=s.id) order by s.canonical_code limit 1;
 r1:=b.rows->i1;r2:=b.rows->i2;
 res:=public.price_service_mapping_command(jsonb_build_object('action','source_review','list_id',l.id,'list_revision',l.revision,'batch_id',b.id,'batch_revision',b.revision,
   'indexes',jsonb_build_array(i1),'service_id',sid,'details_confirmed',true,'note','ربط من مراجعة أسماء الجهات'));
 insert into nr_result values('«هي دي» source_review',true,jsonb_build_object('list',l.name,'row',r1->>'name','returned',res,
   'row_after',(select rows->i1 from clinic_prices.batches where id=b.id)-'reviewed_at','item_created',exists(select 1 from clinic_prices.items where list_id=l.id and service_id=sid)));
 res:=public.price_service_mapping_command(jsonb_build_object('action','source_defer','list_id',l.id,'list_revision',(res->>'list_revision')::int,'batch_id',b.id,'batch_revision',(res->>'batch_revision')::int,
   'indexes',jsonb_build_array(i2),'service_id',null,'details_confirmed',false,'note','مش عندنا — مراجعة أسماء الجهات'));
 insert into nr_result values('«مش عندنا» source_defer',true,jsonb_build_object('row',r2->>'name','returned',res,'review_status_after',(select rows->i2->>'review_status' from clinic_prices.batches where id=b.id)));
 insert into nr_result values('audit',true,(select jsonb_agg(action order by id) from clinic_prices.audit where list_id=l.id and created_at=now()));
end $$;
select step,ok,detail from nr_result;
rollback;
