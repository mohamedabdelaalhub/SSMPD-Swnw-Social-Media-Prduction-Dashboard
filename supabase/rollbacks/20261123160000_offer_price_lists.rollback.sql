-- Rollback of 20261123160000_offer_price_lists.sql (safe to run twice).
-- Refuses while offer lists exist: delete (soft) or move them first, otherwise their prices would silently vanish.
begin;
do $$begin
 if exists(select 1 from clinic_prices.lists where list_kind='offer' and deleted_at is null) then
  raise exception 'فيه عروض موجودة؛ احذفها من شاشة الأسعار الأول';end if;
 if to_regprocedure('clinic_prices.resolve_before_offer(uuid,numeric,date,uuid)') is not null then
  drop function clinic_prices.resolve(uuid,numeric,date,uuid);
  alter function clinic_prices.resolve_before_offer(uuid,numeric,date,uuid) rename to resolve;
 end if;
end $$;
revoke all on function clinic_prices.resolve(uuid,numeric,date,uuid) from public,anon,authenticated;
drop trigger if exists offer_list_guard on clinic_prices.lists;
drop function if exists clinic_prices.guard_offer_list();
update clinic_prices.lists set list_kind='center' where list_kind='offer' and deleted_at is not null;
alter table clinic_prices.lists drop constraint if exists lists_list_kind_check;
alter table clinic_prices.lists add constraint lists_list_kind_check check (list_kind in ('center','reference'));
commit;
