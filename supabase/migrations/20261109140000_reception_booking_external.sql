-- «خدمة خارجية» in the RECEPTION booking (owner decision 2026-11-09): a booking can carry an extra amount that is ADDED to the patient's bill
-- (service 500 + extra 250 = the patient pays 750), same data model as the accounting invoice option of 20261109130000 (external_service / external_extra, no list of external codes).
--
--  * clinic_reception_command('book', {..., external_service:true, external_extra:250}) stores the extra in the NEW table clinic_reception.appointment_external (one row per appointment).
--    The command function is WRAPPED (moved, not edited): any other action, and a 'book' without the option, delegate unchanged (byte-identical behaviour).
--  * The bill is created later, when the service is executed (the existing function inserts clinic_reception.invoices). An AFTER INSERT trigger on that table adds the extra to the invoice
--    amount (500 -> 750) and posts it (Dr 1122 / Cr 4110, source 'external_service', same dimensions as the service posting). No existing function text is replaced, so no md5 pin is needed.
--    The extra is applied ONCE (applied_invoice_id); an appointment without the option is untouched.
--  * Doctor/provider fees are NOT computed on the extra (the order/agreement machinery works on the service price, which is unchanged).
-- ADDITIVE: 1 table, 1 trigger, 2 functions, 1 wrapper. Rollback: supabase/rollbacks/20261109140000_reception_booking_external.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.clinic_reception_command(uuid,text,jsonb,uuid)') is null or to_regclass('clinic_reception.invoices') is null then raise exception 'سلسلة الاستقبال غير موجودة'; end if;
  if to_regclass('clinic_reception.appointment_external') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_reception.appointment_external (
  appointment_id uuid primary key references clinic_reception.appointments(id),
  workspace_id uuid not null,
  external_extra numeric(14,2) not null check (external_extra > 0 and external_extra <= 1000000),
  created_by uuid not null references public.admins(id),
  created_at timestamptz not null default now(),
  applied_invoice_id uuid references clinic_reception.invoices(id)
);
alter table clinic_reception.appointment_external enable row level security;
revoke all on clinic_reception.appointment_external from public, anon, authenticated;

create function clinic_reception.apply_external_extra() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare x clinic_reception.appointment_external%rowtype; v clinic_reception.visits%rowtype; dims jsonb;
begin
  if new.kind <> 'service' or new.visit_id is null then return new; end if;
  select * into v from clinic_reception.visits where id = new.visit_id;
  if not found then return new; end if;
  select * into x from clinic_reception.appointment_external where appointment_id = v.appointment_id and applied_invoice_id is null for update;
  if not found then return new; end if;
  update clinic_reception.invoices set amount = amount + x.external_extra where id = new.id;
  dims := jsonb_build_object('patient_id', new.patient_id, 'visit_id', new.visit_id, 'order_id', new.order_id, 'invoice_id', new.id, 'appointment_id', v.appointment_id);
  perform clinic_reception.post(new.workspace_id, 'external_service', new.id, 'خدمة خارجية (مبلغ إضافي)', '1122', '4110', x.external_extra, dims);
  update clinic_reception.appointment_external set applied_invoice_id = new.id where appointment_id = x.appointment_id;
  return new;
end $$;
create trigger invoices_apply_external_extra after insert on clinic_reception.invoices for each row execute function clinic_reception.apply_external_extra();

alter function public.clinic_reception_command(uuid, text, jsonb, uuid) set schema clinic_reception;
alter function clinic_reception.clinic_reception_command(uuid, text, jsonb, uuid) rename to command_before_external_booking;
create function public.clinic_reception_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_ext boolean; v_extra numeric; r jsonb; v_id uuid;
begin
  if p_action <> 'book' or p_payload is null or not (p_payload ? 'external_service' or p_payload ? 'external_extra') then
    return clinic_reception.command_before_external_booking(p_workspace, p_action, p_payload, p_token);
  end if;
  if p_payload ? 'external_service' and jsonb_typeof(p_payload->'external_service') not in ('boolean', 'null') then raise exception 'خيار الخدمة الخارجية غير صالح'; end if;
  v_ext := coalesce((p_payload->'external_service') = 'true'::jsonb, false);
  if not v_ext then
    if p_payload ? 'external_extra' and jsonb_typeof(p_payload->'external_extra') <> 'null' then raise exception 'فعّل خيار الخدمة الخارجية لإضافة مبلغ إضافي'; end if;
    return clinic_reception.command_before_external_booking(p_workspace, p_action, p_payload - 'external_service' - 'external_extra', p_token);
  end if;
  if jsonb_typeof(p_payload->'external_extra') is distinct from 'number' then raise exception 'اكتب المبلغ الإضافي للخدمة الخارجية رقمًا'; end if;
  v_extra := (p_payload->>'external_extra')::numeric;
  if v_extra <= 0 or v_extra > 1000000 or v_extra <> round(v_extra, 2) then raise exception 'المبلغ الإضافي للخدمة الخارجية غير صالح (أكبر من صفر، جنيه وقرشان)'; end if;
  r := clinic_reception.command_before_external_booking(p_workspace, p_action, p_payload - 'external_service' - 'external_extra', p_token);
  v_id := nullif(r->>'id', '')::uuid;
  if v_id is null then raise exception 'تعذر ربط المبلغ الإضافي بالحجز'; end if;
  insert into clinic_reception.appointment_external(appointment_id, workspace_id, external_extra, created_by) values (v_id, p_workspace, v_extra, public.my_admin_id())
  on conflict (appointment_id) do nothing;   -- same token replayed: the first value stays
  return r;
end $$;

do $$ declare r record;
begin
  revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon, authenticated, service_role;
  for r in select a.grantee, a.privilege_type from pg_proc p, aclexplode(p.proacl) a where p.oid = 'clinic_reception.command_before_external_booking(uuid,text,jsonb,uuid)'::regprocedure and a.grantee <> p.proowner loop
    execute format('grant %s on function public.clinic_reception_command(uuid, text, jsonb, uuid) to %s', r.privilege_type, case when r.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(r.grantee)) end);
  end loop;
end $$;
revoke all on function clinic_reception.apply_external_extra() from public, anon, authenticated;

create function public.clinic_reception_external_enabled() returns boolean language sql stable security definer set search_path = pg_catalog, public as $$ select true $$;
revoke all on function public.clinic_reception_external_enabled() from public, anon;
grant execute on function public.clinic_reception_external_enabled() to authenticated;
commit;
