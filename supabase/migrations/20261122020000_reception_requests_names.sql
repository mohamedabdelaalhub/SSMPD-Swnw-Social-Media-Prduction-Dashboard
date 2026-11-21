-- Reception requests table (owner 2026-11-22): each request row also carries creator_name and reviewer_name
-- (public.admins.name) so the screen can show «مقدّم الطلب» and «اعتمده / رفضه». Only change vs the live
-- controls_snapshot captured 2026-11-21: the 'requests' rows get the two names. Anchor matched exactly once.
begin;
CREATE OR REPLACE FUNCTION clinic_reception.controls_snapshot(p_workspace uuid, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$declare me uuid:=clinic_reception.access(p_workspace,'view');v jsonb;manager boolean;reviewer boolean;begin
 v:=clinic_reception.packages_snapshot(p_workspace,p_from,p_to);manager:=(v->>'can_manage')::boolean;reviewer:=manager or exists(select 1 from clinic_reception.members where workspace_id=p_workspace and admin_id=me and 'review'=any(capabilities));
 if reviewer and not manager then v:=v||jsonb_build_object('agreements',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.doctor_agreements x where workspace_id=p_workspace),'purchases',(select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('lines',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from clinic_reception.purchase_lines l where purchase_id=x.id))),'[]') from clinic_reception.purchases x where workspace_id=p_workspace),'discounts',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.discount_requests x where workspace_id=p_workspace),'suppliers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') from clinic_reception.suppliers where workspace_id=p_workspace));end if;
 return v||jsonb_build_object(
 'can_review',reviewer,
 'entities',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.entities x where workspace_id=p_workspace),
 'entity_contracts',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.entity_contracts x where workspace_id=p_workspace and (manager or status='active')),
 'quotes',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.order_quotes x where workspace_id=p_workspace),
 'claims',case when reviewer then(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.claims x where workspace_id=p_workspace) else '[]'::jsonb end,
 'requests',(select coalesce(jsonb_agg(to_jsonb(x)||jsonb_build_object('creator_name',(select name from public.admins where id=x.created_by),'reviewer_name',(select name from public.admins where id=x.reviewed_by))),'[]') from clinic_reception.requests x where workspace_id=p_workspace and (manager or created_by=me or exists(select 1 from clinic_reception.members where workspace_id=p_workspace and admin_id=me and 'review'=any(capabilities)))),
 'transfers',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.transfers x where workspace_id=p_workspace),
 'counts',(select coalesce(jsonb_agg(case when manager then to_jsonb(x) else to_jsonb(x)-'book' end),'[]') from clinic_reception.counts x where workspace_id=p_workspace and (reviewer or created_by=me)),
 'tasks',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.tasks x where workspace_id=p_workspace and (manager or assigned_to=me)),
 'outbox',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.outbox x where workspace_id=p_workspace),
 'attributions',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from clinic_reception.attributions x where workspace_id=p_workspace),
 'provider_balances',case when manager then(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'due',-clinic_reception.balance(p_workspace,'2120','provider_id',x.id::text))),'[]') from clinic_reception.providers x where workspace_id=p_workspace) else '[]'::jsonb end);
end $function$;
notify pgrst,'reload schema';
commit;
