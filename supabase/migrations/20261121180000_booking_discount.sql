-- Optional discount on a booking (owner 2026-11-21, mockup docs/ui-references/mockups/booking-discount.html «موافق»):
--   * «خصم نقابة / نادي»: الجهة نقابة / نادي / أخرى + name, card number (required), card valid until (required, ≥ visit
--     day) and a card photo (required, private bucket 'booking-discount-cards'); or «خصم خاص» with a reason.
--   * Owner «خليه ٣٠٪»: up to 30% is applied at arrival; above 30% it waits in «مراجعة الخصومات» (existing review: a
--     different person; > 15% also needs finance_review).
--   * Owner «يوقف اي خصومات تانية»: a visit whose booking has this discount takes no other discount and no contract
--     price (quote) on any of its services.
-- Stored on the appointment at 'book' (flat payload keys discount_*); applied at arrival on the arrival order through the
-- existing discount_requests flow (reason «خصم الحجز: …»). 'booking_discount' {id, discount_kind|null, …} edits or
-- clears it while the booking is still 'booked'. Package bookings keep their contracted price (no discount).
-- Front wrapper on public.clinic_reception_command (previous becomes clinic_reception.command_before_booking_discount).
-- Rollback: supabase/rollbacks/20261121180000_booking_discount.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.clinic_reception_command(uuid,text,jsonb,uuid)') is null or to_regclass('clinic_reception.discount_requests') is null then
    raise exception 'مكونات الحجز غير موجودة';
  end if;
  if to_regprocedure('clinic_reception.command_before_booking_discount(uuid,text,jsonb,uuid)') is not null then
    raise exception 'تم تطبيق هذا الملف من قبل';
  end if;
end $$;

alter table clinic_reception.appointments
  add column if not exists discount_kind text check (discount_kind in ('syndicate','special')),
  add column if not exists discount_percent numeric(5,2) check (discount_percent > 0 and discount_percent <= 100),
  add column if not exists discount_org_type text check (discount_org_type in ('syndicate','club','other')),
  add column if not exists discount_org_name text,
  add column if not exists discount_card_no text,
  add column if not exists discount_card_expiry date,
  add column if not exists discount_card_path text,
  add column if not exists discount_reason text,
  add column if not exists discount_by uuid references public.admins(id),
  add column if not exists discount_at timestamptz;
alter table clinic_reception.appointments add constraint appointments_discount_complete check (
  discount_kind is null
  or (discount_kind = 'syndicate' and discount_percent is not null and discount_org_type is not null
      and length(btrim(coalesce(discount_org_name, ''))) >= 2 and length(btrim(coalesce(discount_card_no, ''))) >= 2
      and discount_card_expiry is not null and length(coalesce(discount_card_path, '')) > 3)
  or (discount_kind = 'special' and discount_percent is not null and length(btrim(coalesce(discount_reason, ''))) >= 3));

-- card photos: private bucket, path <auth uid>/<workspace id>/<file>; uploader + reception members of that workspace read
create or replace function public.booking_discount_card_allowed(p_name text) returns boolean
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare ws uuid;
begin
  begin ws := (string_to_array(p_name, '/'))[2]::uuid; exception when others then return false; end;
  perform clinic_reception.access(ws, 'book');
  return true;
exception when others then return false;
end $$;
revoke all on function public.booking_discount_card_allowed(text) from public, anon;
grant execute on function public.booking_discount_card_allowed(text) to authenticated;

do $$ begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
    values ('booking-discount-cards', 'booking-discount-cards', false, 8388608, array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
    on conflict (id) do nothing;
  execute 'drop policy if exists booking_discount_cards_insert on storage.objects';
  execute $p$create policy booking_discount_cards_insert on storage.objects for insert to authenticated
    with check (bucket_id = 'booking-discount-cards' and (storage.foldername(name))[1] = auth.uid()::text
                and public.booking_discount_card_allowed(name))$p$;
  execute 'drop policy if exists booking_discount_cards_read on storage.objects';
  execute $p$create policy booking_discount_cards_read on storage.objects for select to authenticated
    using (bucket_id = 'booking-discount-cards' and public.booking_discount_card_allowed(name))$p$;
end $$;

-- validate + store the discount on a booked appointment (null kind clears it)
create function clinic_reception.set_booking_discount(p_workspace uuid, p_appointment uuid, p jsonb, p_me uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare ap record; kind text := nullif(btrim(coalesce(p->>'discount_kind', '')), ''); pct numeric; exp date; path text; d date; has_file boolean;
begin
  select * into ap from clinic_reception.appointments where id = p_appointment and workspace_id = p_workspace for update;
  if not found then raise exception 'الحجز مش موجود'; end if;
  if ap.status <> 'booked' then raise exception 'الخصم بيتعدّل قبل وصول المريض بس'; end if;
  if kind is null then
    update clinic_reception.appointments set discount_kind = null, discount_percent = null, discount_org_type = null, discount_org_name = null,
      discount_card_no = null, discount_card_expiry = null, discount_card_path = null, discount_reason = null, discount_by = p_me, discount_at = now()
     where id = ap.id;
    return;
  end if;
  if kind not in ('syndicate','special') then raise exception 'اختار نوع الخصم'; end if;
  if ap.package_id is not null then raise exception 'حجز الباكج بسعره المتعاقد عليه — مينفعش عليه خصم'; end if;
  begin pct := nullif(btrim(coalesce(p->>'discount_percent', '')), '')::numeric; exception when others then pct := null; end;
  if pct is null or pct <= 0 or pct > 100 then raise exception 'اكتب نسبة الخصم (من ١ لـ ١٠٠)'; end if;
  d := (ap.starts_at at time zone 'Africa/Cairo')::date;
  if kind = 'syndicate' then
    if coalesce(p->>'discount_org_type', '') not in ('syndicate','club','other') then raise exception 'اختار الجهة: نقابة أو نادي أو أخرى'; end if;
    if length(btrim(coalesce(p->>'discount_org_name', ''))) < 2 then raise exception 'اكتب اسم الجهة'; end if;
    if length(btrim(coalesce(p->>'discount_card_no', ''))) < 2 then raise exception 'رقم الكارنيه إجباري'; end if;
    begin exp := nullif(p->>'discount_card_expiry', '')::date; exception when others then exp := null; end;
    if exp is null then raise exception 'اكتب الكارنيه ساري لحد إمتى'; end if;
    if exp < d then raise exception 'الكارنيه منتهي قبل يوم الزيارة — الخصم مش متاح'; end if;
    path := btrim(coalesce(p->>'discount_card_path', ''));
    if length(path) < 4 then raise exception 'ارفع صورة الكارنيه'; end if;
    if to_regclass('storage.objects') is not null then
      execute 'select exists (select 1 from storage.objects o where o.bucket_id = ''booking-discount-cards'' and o.name = $1)' into has_file using path;
      if not has_file then raise exception 'ارفع صورة الكارنيه'; end if;
    end if;
  elsif length(btrim(coalesce(p->>'discount_reason', ''))) < 3 then
    raise exception 'اكتب سبب الخصم';
  end if;
  update clinic_reception.appointments set discount_kind = kind, discount_percent = pct,
      discount_org_type = case when kind = 'syndicate' then p->>'discount_org_type' end,
      discount_org_name = case when kind = 'syndicate' then left(btrim(p->>'discount_org_name'), 120) end,
      discount_card_no = case when kind = 'syndicate' then left(btrim(p->>'discount_card_no'), 60) end,
      discount_card_expiry = case when kind = 'syndicate' then exp end,
      discount_card_path = case when kind = 'syndicate' then path end,
      discount_reason = case when kind = 'special' then left(btrim(p->>'discount_reason'), 300) end,
      discount_by = p_me, discount_at = now()
   where id = ap.id;
end $$;
revoke all on function clinic_reception.set_booking_discount(uuid, uuid, jsonb, uuid) from public, anon, authenticated;

do $$ begin
  alter function public.clinic_reception_command(uuid, text, jsonb, uuid) rename to command_before_booking_discount;
  alter function public.command_before_booking_discount(uuid, text, jsonb, uuid) set schema clinic_reception;
end $$;
revoke all on function clinic_reception.command_before_booking_discount(uuid, text, jsonb, uuid) from public, anon, authenticated;

create function public.clinic_reception_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; out jsonb; prev jsonb; kind text := nullif(btrim(coalesce(p_payload->>'discount_kind', '')), '');
begin
  if p_action = 'booking_discount' then
    me := clinic_reception.access(p_workspace, 'book');
    select c.response into prev from clinic_reception.commands c where c.workspace_id = p_workspace and c.actor_id = me and c.token = p_token;
    if found then return prev; end if;
    perform clinic_reception.set_booking_discount(p_workspace, nullif(p_payload->>'id', '')::uuid, p_payload, me);
    out := jsonb_build_object('id', p_payload->>'id', 'discount_kind', kind);
    insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
      values (p_workspace, me, 'booking_discount', nullif(p_payload->>'id', '')::uuid, p_payload - 'discount_card_path');
    insert into clinic_reception.commands(workspace_id, actor_id, token, action, payload, response) values (p_workspace, me, p_token, p_action, p_payload, out);
    return out;
  end if;
  out := clinic_reception.command_before_booking_discount(p_workspace, p_action, p_payload, p_token);
  if p_action = 'book' and kind is not null and out ? 'id' then
    me := clinic_reception.access(p_workspace, 'book');
    if not exists (select 1 from clinic_reception.appointments where id = (out->>'id')::uuid and discount_kind is not null) then
      perform clinic_reception.set_booking_discount(p_workspace, (out->>'id')::uuid, p_payload, me);
    end if;
  end if;
  return out;
end $$;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;

-- arrival: the arrival order gets the booking discount (≤ 30% applied, above waits for review); card re-checked
create function clinic_reception.booking_discount_apply() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare ap record; why text; ok boolean;
begin
  if new.entitlement_id is not null then return new; end if;
  select a.* into ap from clinic_reception.visits v join clinic_reception.appointments a on a.id = v.appointment_id where v.id = new.visit_id;
  if not found or ap.discount_kind is null or ap.service_id is distinct from new.service_id then return new; end if;
  if (select count(*) from clinic_reception.orders o where o.visit_id = new.visit_id and o.service_id = new.service_id) > 1 then return new; end if;
  if ap.discount_kind = 'syndicate' and ap.discount_card_expiry < (now() at time zone 'Africa/Cairo')::date then
    raise exception 'كارنيه الخصم (%) منتهي — شيل الخصم من الحجز أو حدّثه قبل تسجيل الحضور', ap.discount_org_name;
  end if;
  why := 'خصم الحجز: ' || case when ap.discount_kind = 'syndicate'
           then case ap.discount_org_type when 'syndicate' then 'نقابة' when 'club' then 'نادي' else 'جهة' end
                || ' — ' || ap.discount_org_name || ' — كارنيه ' || ap.discount_card_no
           else 'خصم خاص — ' || ap.discount_reason end;
  ok := ap.discount_percent <= 30;
  insert into clinic_reception.discount_requests(workspace_id, order_id, percent, reason, created_by, status)
    values (new.workspace_id, new.id, ap.discount_percent, why, coalesce(ap.discount_by, ap.created_by), case when ok then 'approved' else 'pending' end);
  if ok then update clinic_reception.orders set discount = ap.discount_percent where id = new.id; end if;
  return new;
end $$;
revoke all on function clinic_reception.booking_discount_apply() from public, anon, authenticated;
create trigger booking_discount_apply after insert on clinic_reception.orders
  for each row execute function clinic_reception.booking_discount_apply();

-- exclusivity: no other discount and no contract price on a visit whose booking carries the discount
create function clinic_reception.booking_discount_exclusive() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare oid uuid := new.order_id; ap record;
begin
  select a.discount_kind, a.discount_org_name into ap
    from clinic_reception.orders o join clinic_reception.visits v on v.id = o.visit_id join clinic_reception.appointments a on a.id = v.appointment_id
   where o.id = oid;
  if not found or ap.discount_kind is null then return new; end if;
  if tg_table_name = 'discount_requests' and new.reason like 'خصم الحجز: %' then return new; end if;
  raise exception 'الحجز ده عليه خصم % — مينفعش خصم تاني ولا سعر تعاقد عليه',
    case when ap.discount_kind = 'syndicate' then 'نقابة / نادي (' || ap.discount_org_name || ')' else 'خاص' end;
end $$;
revoke all on function clinic_reception.booking_discount_exclusive() from public, anon, authenticated;
create trigger booking_discount_exclusive before insert on clinic_reception.discount_requests
  for each row execute function clinic_reception.booking_discount_exclusive();
do $$ begin
  if to_regclass('clinic_reception.order_quotes') is not null then
    create trigger booking_discount_exclusive before insert on clinic_reception.order_quotes
      for each row execute function clinic_reception.booking_discount_exclusive();
  end if;
end $$;

commit;
