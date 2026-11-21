-- Rollback of 20261121180000_booking_discount.sql. Card photos already uploaded stay in the bucket (not deleted).
begin;
drop trigger if exists booking_discount_exclusive on clinic_reception.discount_requests;
do $$ begin if to_regclass('clinic_reception.order_quotes') is not null then drop trigger if exists booking_discount_exclusive on clinic_reception.order_quotes; end if; end $$;
drop trigger if exists booking_discount_apply on clinic_reception.orders;
drop function if exists clinic_reception.booking_discount_exclusive();
drop function if exists clinic_reception.booking_discount_apply();
drop function if exists public.clinic_reception_command(uuid, text, jsonb, uuid);
alter function clinic_reception.command_before_booking_discount(uuid, text, jsonb, uuid) set schema public;
alter function public.command_before_booking_discount(uuid, text, jsonb, uuid) rename to clinic_reception_command;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;
drop function if exists clinic_reception.set_booking_discount(uuid, uuid, jsonb, uuid);
do $$ begin if to_regclass('storage.objects') is not null then
  execute 'drop policy if exists booking_discount_cards_insert on storage.objects';
  execute 'drop policy if exists booking_discount_cards_read on storage.objects';
end if; end $$;
drop function if exists public.booking_discount_card_allowed(text);
alter table clinic_reception.appointments drop constraint if exists appointments_discount_complete,
  drop column if exists discount_kind, drop column if exists discount_percent, drop column if exists discount_org_type,
  drop column if exists discount_org_name, drop column if exists discount_card_no, drop column if exists discount_card_expiry,
  drop column if exists discount_card_path, drop column if exists discount_reason, drop column if exists discount_by, drop column if exists discount_at;
commit;
