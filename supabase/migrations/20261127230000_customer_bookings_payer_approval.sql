-- Website booking form, payment step (owner 2026-11-27, mockups payment-options / approval-page): the patient says how the visit is paid
-- and may send the insurer's approval number (at booking or later).
--   * payment_mode: direct | insurance | membership | entity (what the patient chose on the site)
--   * payer_entity_id: the chosen contracting entity (insurer, union / club, nursery, gym ...), FK to public.contracting_entities
--   * approval_no / approval_at: the insurer's approval number as typed by the patient (reception verifies it; never a price or a coverage %)
-- Additive and nullable: existing rows and writers are unaffected. Rollback: supabase/rollbacks/20261127230000_customer_bookings_payer_approval.rollback.sql
begin;
do $$ begin
  if to_regclass('public.customer_bookings') is null then raise exception 'customer_bookings غير موجود'; end if;
  if to_regclass('public.contracting_entities') is null then raise exception 'contracting_entities غير موجود'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customer_bookings' and column_name = 'payment_mode') then
    raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;
alter table public.customer_bookings add column payment_mode text check (payment_mode is null or payment_mode in ('direct', 'insurance', 'membership', 'entity'));
alter table public.customer_bookings add column payer_entity_id uuid references public.contracting_entities(id) on delete set null;
alter table public.customer_bookings add column approval_no text check (approval_no is null or length(approval_no) between 3 and 40);
alter table public.customer_bookings add column approval_at timestamptz;
alter table public.customer_bookings add constraint customer_bookings_payer_consistent check (payment_mode is null or payment_mode = 'direct' or payer_entity_id is not null or approval_no is null);
create index customer_bookings_payer_entity_idx on public.customer_bookings (payer_entity_id) where payer_entity_id is not null;
commit;
