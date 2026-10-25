create or replace function public.reschedule_content_publish(p_id uuid, p_when timestamp with time zone)
returns jsonb
language plpgsql security definer set search_path=public
as $function$
declare item public.content_items%rowtype; me uuid := public.my_admin_id(); moved int:=0; changed int;
begin
 if me is null then raise exception 'سجّل الدخول الأول'; end if;
 if p_when is null or p_when < now() - interval '1 minute' then raise exception 'اختار ميعاد في المستقبل'; end if;
 select * into item from public.content_items where id=p_id for update;
 if not found or item.stage <> 'scheduled' then raise exception 'المادة دي مش مجدولة'; end if;
 if not (public.can_manage_all_content() or public.has_role('approver')
   or (public.has_role('page_manager') and item.created_by=me)) then
  raise exception 'غير مسموح لك بتعديل ميعاد النشر للمادة دي';
 end if;
 perform 1 from public.meta_publish_jobs where content_id=p_id for update;
 perform 1 from public.tiktok_publish_jobs where content_id=p_id for update;
 if exists(select 1 from public.meta_publish_jobs where content_id=p_id and status='processing')
    or exists(select 1 from public.tiktok_publish_jobs where content_id=p_id and status='processing') then
  raise exception 'النشر التلقائي بدأ بالفعل، مينفعش تغيّر الميعاد دلوقتي';
 end if;
 update public.meta_publish_jobs set scheduled_at=p_when where content_id=p_id and status='pending';
 get diagnostics moved = row_count;
 update public.tiktok_publish_jobs set scheduled_at=p_when,updated_at=now() where content_id=p_id and status='pending';
 get diagnostics changed = row_count; moved:=moved+changed;
 update public.content_items set scheduled_publish_at=p_when, scheduled_by=me where id=p_id returning * into item;
 insert into public.activity_log(content_id,actor_id,action,from_stage,to_stage)
 values(p_id,me,'تعديل ميعاد النشر إلى '||to_char(p_when at time zone 'Africa/Cairo','YYYY-MM-DD HH24:MI')||' (توقيت القاهرة)','scheduled','scheduled');
 return jsonb_build_object('item',to_jsonb(item),'jobs_moved',moved);
end $function$;