-- Rollback of 20261123030000_reception_room_link.sql. Links already made stay; only the wider permission and the audit go.
begin;
do $$ begin
  if to_regprocedure('clinic_reception.queue_rpc_before_room_link(uuid,text,jsonb)') is null then raise exception 'لم يُطبّق الملف'; end if;
  if position('queue_rpc_before_room_link' in pg_get_functiondef('public.clinic_reception_queue(uuid,text,jsonb)'::regprocedure)) = 0 then
    raise exception 'فيه ملف أحدث لف دالة الطابور — رجّعه الأول'; end if;
end $$;
drop function public.clinic_reception_queue(uuid, text, jsonb);
alter function clinic_reception.queue_rpc_before_room_link(uuid, text, jsonb) set schema public;
alter function public.queue_rpc_before_room_link(uuid, text, jsonb) rename to clinic_reception_queue;
revoke all on function public.clinic_reception_queue(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_queue(uuid, text, jsonb) to authenticated;
drop function clinic_reception.room_link_allowed(uuid);
commit;
