-- Current request stages use the existing personal inbox and read receipts.
alter table public.inventory_requests add column stage_changed_at timestamptz;
update public.inventory_requests set stage_changed_at=coalesce(completed_at,reviewed_at,requested_at);
create function clinic_finance.inventory_stage_clock() returns trigger language plpgsql set search_path=pg_catalog,public as $$begin new.stage_changed_at:=clock_timestamp();return new;end $$;
create trigger inventory_request_stage_clock before insert or update of status on public.inventory_requests for each row execute function clinic_finance.inventory_stage_clock();
create index inventory_request_stage_time on public.inventory_requests(stage_changed_at desc) where not staff_supply;
create function clinic_finance.inventory_request_visible(p_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select exists(select 1 from public.admins where id=public.my_admin_id() and active)
 and public.inventory_location_can('00000000-0000-4000-8000-000000000001','view')
 and exists(select 1 from public.inventory_requests r where r.id=p_id and not r.staff_supply and (r.requester_id=public.my_admin_id() or public.inventory_location_can('00000000-0000-4000-8000-000000000001','manage')));
$$;
create function public.inventory_request_detail(p_id uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare v jsonb;begin
 if not clinic_finance.inventory_request_visible(p_id) then raise exception 'الطلب غير متاح أو ليست لديك صلاحية عرضه';end if;
 select to_jsonb(r)||jsonb_build_object('requester_name',a.name,'can_review',public.inventory_can_manage() and public.inventory_location_can('00000000-0000-4000-8000-000000000001','manage') and r.status='pending' and (r.request_type<>'purchase' or r.requester_id<>public.my_admin_id()),
 'can_receive',public.inventory_location_can('00000000-0000-4000-8000-000000000001','manage') and r.status in ('approved','partial'),
 'lines',(select coalesce(jsonb_agg(to_jsonb(l)||jsonb_build_object('item_name',i.name,'track_lots',i.track_lots,'base_unit',i.base_unit,'units_per_pack',i.units_per_pack) order by l.id),'[]') from public.inventory_request_lines l join public.inventory_items i on i.id=l.item_id where l.request_id=r.id)) into v from public.inventory_requests r join public.admins a on a.id=r.requester_id where r.id=p_id;
 return v;
end $$;
create function clinic_finance.inventory_request_notices() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare me uuid:=public.my_admin_id();mgr boolean;v jsonb;begin
 if not exists(select 1 from public.admins where id=me and active) or not public.inventory_location_can('00000000-0000-4000-8000-000000000001','view') then return '[]';end if;mgr:=public.inventory_location_can('00000000-0000-4000-8000-000000000001','manage');
 select coalesce(jsonb_agg(n order by at desc),'[]') into v from (
 select r.stage_changed_at at,jsonb_build_object('key','inventory_request:'||r.id||':'||extract(epoch from r.stage_changed_at),
 'type','inventory_request','id',r.id,'at',r.stage_changed_at,'native_read',false,
 'message',case when r.request_type='purchase' then 'طلب توريد' else 'طلب صرف' end||' '||left(r.id::text,8)||case when r.supplier_name<>'' then ' — '||r.supplier_name else '' end||' — '||
 case r.status when 'pending' then 'بانتظار المراجعة' when 'approved' then case r.request_type when 'purchase' then 'معتمد وبانتظار الاستلام والفاتورة' else 'معتمد وبانتظار الصرف' end
 when 'partial' then case r.request_type when 'purchase' then 'استلام جزئي؛ توجد كميات متبقية' else 'صرف جزئي؛ توجد كميات متبقية' end when 'completed' then case r.request_type when 'purchase' then 'اكتمل الاستلام' else 'اكتمل الصرف' end when 'rejected' then 'مرفوض؛ راجع سبب الرفض' else r.status end) n
 from public.inventory_requests r where not r.staff_supply and (mgr or r.requester_id=me)
 and (r.status in ('pending','approved','partial') or r.stage_changed_at>now()-interval '30 days') order by r.stage_changed_at desc limit 40) x;return v;end
$$;
alter function public.personal_home_inbox() rename to home_inbox_before_inventory_stages;
alter function public.home_inbox_before_inventory_stages() set schema clinic_finance;
create function public.personal_home_inbox() returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare base jsonb;extra jsonb;all_rows jsonb;unread integer;begin
 base:=clinic_finance.home_inbox_before_inventory_stages();extra:=clinic_finance.inventory_request_notices();
 with rows as(select n||jsonb_build_object('read',exists(select 1 from public.personal_notice_reads r where r.admin_id=public.my_admin_id() and r.notice_key=n->>'key')) n from jsonb_array_elements(extra) n),
 all_notices as(select value n from jsonb_array_elements(base->'notices') union all select n from rows),
 latest as(select n from all_notices order by (n->>'at')::timestamptz desc limit 80)
 select coalesce(jsonb_agg(n order by (n->>'at')::timestamptz desc),'[]'),count(*) filter(where not (n->>'read')::boolean) into all_rows,unread from latest;
 return base||jsonb_build_object('notices',all_rows,'unread',unread,'limited',coalesce((base->>'limited')::boolean,false) or jsonb_array_length(base->'notices')+jsonb_array_length(extra)>80);
end $$;
revoke all on function clinic_finance.inventory_stage_clock(),clinic_finance.inventory_request_visible(uuid),clinic_finance.inventory_request_notices(),clinic_finance.home_inbox_before_inventory_stages() from public,anon,authenticated;
revoke all on function public.inventory_request_detail(uuid),public.personal_home_inbox() from public,anon,authenticated;
grant execute on function public.inventory_request_detail(uuid),public.personal_home_inbox() to authenticated;
do $$begin if exists(select 1 from pg_publication where pubname='supabase_realtime') and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='inventory_requests') then alter publication supabase_realtime add table public.inventory_requests;end if;end $$;
notify pgrst,'reload schema';
