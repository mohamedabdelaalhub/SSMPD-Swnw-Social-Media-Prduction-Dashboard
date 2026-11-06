-- ADDITIVE ONLY. Read-only list of service orders (internal + external) for the staff status screen. Review file.
begin;
create or replace function public.clinic_reception_so_orders_list(p_workspace uuid,p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_reception.access(p_workspace,'view');
begin
 return coalesce((select jsonb_agg(r) from (
   select jsonb_build_object('order_id',x.order_id,'provider',coalesce(e.name,'داخل المركز'),'mode',x.mode,'kind',x.kind,'status',x.status,'status_at',x.status_at,
     'service',o.snapshot->>'name','patient_name',p.name,'phone',p.phone) r
   from clinic_reception.order_ext x
   join clinic_reception.orders o on o.id=x.order_id and o.workspace_id=p_workspace
   left join clinic_reception.external_providers e on e.id=x.external_provider_id
   join clinic_reception.visits v on v.id=o.visit_id
   join clinic_reception.patients p on p.id=v.patient_id
   order by x.status_at desc limit greatest(1,least(coalesce(p_limit,200),500))) q),'[]'::jsonb);
end $$;
revoke all on function public.clinic_reception_so_orders_list(uuid,int) from public,anon,authenticated;
grant execute on function public.clinic_reception_so_orders_list(uuid,int) to authenticated;
commit;
