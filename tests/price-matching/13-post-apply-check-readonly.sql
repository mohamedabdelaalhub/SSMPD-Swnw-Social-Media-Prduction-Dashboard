-- After the 21:13Z apply — READ ONLY. Reception copies of 0000003/0000004 off? Center review state.
begin read only;
select 'reception_copies', jsonb_agg(jsonb_build_object('code',r.code,'active',r.active,'pricing_active',p.active,'workspace',r.workspace_id) order by r.code)
 from clinic_reception.services r join public.pricing_services p on p.id=r.pricing_service_id
 where p.booking_code in ('0000003','0000004','0000167','0000168')
union all
select 'center_review', (select jsonb_build_object('list_status',l.status,'items',(select count(*) from clinic_prices.items where list_id=l.id),
  'review',(select jsonb_build_object('status',status,'prepared_by',prepared_by,'groups',jsonb_array_length(plan)) from clinic_prices.master_reviews where list_id=l.id))
  from clinic_prices.lists l where l.id='12289346-917a-40e6-bd74-9b9696f844f4');
rollback;
