-- Live rollback test for 20261126190000_vezeeta_sms_proof.sql («لصق رسالة فيزيتا» — «فيزيتا شامل» with the SMS as proof).
-- Run the WHOLE file as postgres. ONE transaction, ends with ROLLBACK — nothing is kept. Acts as Mazen (reception, auth sub
-- f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb). Fixture: 2 real live patients without a booking today; inside the txn their phones
-- (archive public.patients AND the reception file) are set to test numbers. A provider with a doctor_key + a priced non-offer service
-- (temp availability block if nobody is on shift; the unrelated cash-shift guard stubbed if Mazen has no open shift).
-- Output: one table (step, expected, actual, ok) — no names or phone numbers.
do $$ begin
  if to_regprocedure('clinic_reception.set_booking_discount_before_vezeeta_sms(uuid,uuid,jsonb,uuid)') is not null then
    raise exception '20261126190000 already applied — this dry-run is for before the apply'; end if;
end $$;

begin;
savepoint vzs_guard;
create temp table vzs_live(n serial, step text, expected text, actual text, ok boolean);
create temp table vzs_fx(w uuid, me uuid, sub uuid, prov uuid, svc uuid, p1 uuid, p2 uuid);

-- >>> MIGRATION BODY: supabase/migrations/20261126190000_vezeeta_sms_proof.sql (between its begin; / commit;) >>>

alter table clinic_reception.appointments add column discount_proof_text text, add column discount_proof_by uuid references public.admins(id),
  add column discount_proof_at timestamptz;

-- vezeeta: card number + valid until + (photo OR the pasted Vezeeta message); other kinds unchanged (as of 20261126170000)
alter table clinic_reception.appointments drop constraint appointments_discount_complete;
alter table clinic_reception.appointments add constraint appointments_discount_complete check (
  discount_kind is null
  or (discount_kind = 'syndicate' and discount_percent is not null and discount_org_type is not null
      and length(btrim(coalesce(discount_org_name, ''))) >= 2 and length(btrim(coalesce(discount_card_no, ''))) >= 2
      and discount_card_expiry is not null and length(coalesce(discount_card_path, '')) > 3)
  or (discount_kind = 'special' and discount_percent is not null and length(btrim(coalesce(discount_reason, ''))) >= 3)
  or (discount_kind = 'vezeeta' and discount_percent = 40 and length(btrim(coalesce(discount_card_no, ''))) >= 2
      and discount_card_expiry is not null and (length(coalesce(discount_card_path, '')) > 3 or length(coalesce(discount_proof_text, '')) >= 20))
  or (discount_kind = 'family' and discount_percent between 10 and 50)
  or (discount_kind = 'staff' and discount_percent is not null and discount_staff_id is not null and length(btrim(coalesce(discount_reason, ''))) >= 3));

create function clinic_reception.vezeeta_sms_ok(p_text text, p_patient uuid) returns text
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare t text := btrim(coalesce(p_text, '')); ph text;
begin
  if length(t) < 20 or length(t) > 1000 then raise exception 'الصق رسالة فيزيتا كاملة'; end if;
  if t !~* 'shamel' then raise exception 'الرسالة دي مش «فيزيتا شامل» — خصم فيزيتا شامل محتاج رسالة شامل أو الكارت'; end if;
  if t !~* 'hadayek' then raise exception 'الرسالة دي لفرع تاني — مش بتتحجز هنا'; end if;
  select right(regexp_replace(coalesce(nullif(btrim(ar.phone), ''), rp.phone, ''), '\D', '', 'g'), 10) into ph
    from clinic_reception.patients rp left join public.patients ar on ar.id = rp.patient_id where rp.id = p_patient;
  if coalesce(length(ph), 0) < 10 or position(ph in regexp_replace(t, '\D', '', 'g')) = 0 then
    raise exception 'رقم تليفون المريض مش هو اللي في رسالة فيزيتا — اختار ملف المريض الصح';
  end if;
  return t;
end $$;
revoke all on function clinic_reception.vezeeta_sms_ok(text, uuid) from public, anon, authenticated;

alter function clinic_reception.set_booking_discount(uuid, uuid, jsonb, uuid) rename to set_booking_discount_before_vezeeta_sms;
revoke all on function clinic_reception.set_booking_discount_before_vezeeta_sms(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
create function clinic_reception.set_booking_discount(p_workspace uuid, p_appointment uuid, p jsonb, p_me uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public as $$
declare ap record; t text;
begin
  if nullif(btrim(coalesce(p->>'discount_kind', '')), '') is distinct from 'vezeeta' or nullif(btrim(coalesce(p->>'discount_proof_text', '')), '') is null then
    perform clinic_reception.set_booking_discount_before_vezeeta_sms(p_workspace, p_appointment, p, p_me);
    -- any other save (another kind, clear, or a card) drops a stale message proof
    update clinic_reception.appointments set discount_proof_text = null, discount_proof_by = null, discount_proof_at = null
     where id = p_appointment and discount_proof_text is not null
       and (discount_kind is distinct from 'vezeeta' or length(coalesce(discount_card_path, '')) > 3);
    return;
  end if;
  select * into ap from clinic_reception.appointments where id = p_appointment and workspace_id = p_workspace for update;
  if not found then raise exception 'الحجز مش موجود'; end if;
  if ap.status <> 'booked' then raise exception 'الخصم بيتعدّل قبل وصول المريض بس'; end if;
  if ap.package_id is not null then raise exception 'حجز الباكج بسعره المتعاقد عليه — مينفعش عليه خصم'; end if;
  if to_regprocedure('clinic_reception.service_is_offer(uuid)') is not null and clinic_reception.service_is_offer(ap.service_id) then
    raise exception 'السعر ده عرض — مفيش خصم تاني عليه'; end if;
  t := clinic_reception.vezeeta_sms_ok(p->>'discount_proof_text', ap.patient_id);
  update clinic_reception.appointments set discount_kind = 'vezeeta', discount_percent = 40,
      discount_org_type = null, discount_org_name = null, discount_card_no = 'رسالة فيزيتا', discount_card_expiry = date '9999-12-31',
      discount_card_path = null, discount_reason = null, discount_proof_text = t, discount_proof_by = p_me, discount_proof_at = now(),
      discount_staff_id = null,
      discount_by = p_me, discount_at = now()
   where id = ap.id;
end $$;
revoke all on function clinic_reception.set_booking_discount(uuid, uuid, jsonb, uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
-- <<< END MIGRATION BODY <<<

do $$
declare sub uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; me uuid; w uuid; prov uuid; svc uuid; p1 uuid; p2 uuid; pids uuid[]; g jsonb;
  d date := (now() at time zone 'Africa/Cairo')::date;
begin
  select id into w from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  select id into me from public.admins where user_id = sub;
  if w is null or me is null then raise exception 'live workspace % / admin for sub % missing', w, sub; end if;
  perform clinic_reception.sync_catalog(w); perform clinic_reception.sync_catalog(w);
  select av.provider_id, s.id into prov, svc
    from clinic_reception.availability av join clinic_reception.providers pr2 on pr2.id = av.provider_id
    join clinic_reception.services s on s.workspace_id = w and s.department = pr2.department and s.active and s.price > 0
     and to_jsonb(s)->>'pricing_service_id' is not null and coalesce((to_jsonb(s)->>'is_home')::boolean, false) = false
     and not clinic_reception.service_is_offer(s.id)
     and not exists (select 1 from public.pricing_services ps where ps.active and ps.booking_enabled and btrim(ps.booking_code) = s.code
                       and ps.id <> (to_jsonb(s)->>'pricing_service_id')::uuid)
   where av.workspace_id = w and now() between av.starts_at and av.ends_at - interval '2 hours' and pr2.active and nullif(btrim(coalesce(pr2.doctor_key,'')),'') is not null
   order by s.price limit 1;
  if prov is null then
    select pr2.id, s.id into prov, svc from clinic_reception.providers pr2
      join clinic_reception.services s on s.workspace_id = w and s.department = pr2.department and s.active and s.price > 0
       and to_jsonb(s)->>'pricing_service_id' is not null and coalesce((to_jsonb(s)->>'is_home')::boolean, false) = false
       and not clinic_reception.service_is_offer(s.id)
       and not exists (select 1 from public.pricing_services ps where ps.active and ps.booking_enabled and btrim(ps.booking_code) = s.code
                         and ps.id <> (to_jsonb(s)->>'pricing_service_id')::uuid)
     where pr2.workspace_id = w and pr2.active and nullif(btrim(coalesce(pr2.doctor_key,'')),'') is not null
     order by s.price, pr2.name limit 1;
    insert into clinic_reception.availability(workspace_id, provider_id, starts_at, ends_at)
      values (w, prov, date_trunc('minute', now()) - interval '7 minutes', date_trunc('minute', now()) + interval '3 hours');
    insert into vzs_live(step, expected, actual, ok) values ('0a provider on shift', 'working now or a temp block', 'temp availability block (rolled back)', true);
  end if;
  select array_agg(id order by created_at desc) into pids from (select p.id, p.created_at from clinic_reception.patients p where p.workspace_id = w and p.patient_id is not null
     and not exists (select 1 from clinic_reception.appointments x where x.patient_id = p.id and (x.starts_at at time zone 'Africa/Cairo')::date = d)
   order by p.created_at desc limit 2) z;
  p1 := pids[1]; p2 := pids[2];
  perform set_config('request.jwt.claims', jsonb_build_object('sub', sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', sub::text, true);
  update clinic_reception.patients set phone = '01999000911' where id = p1;
  update public.patients set phone = '01999000911' where id = (select patient_id from clinic_reception.patients where id = p1);
  update clinic_reception.patients set phone = '01999000912' where id = p2;
  update public.patients set phone = '01999000912' where id = (select patient_id from clinic_reception.patients where id = p2);
  insert into vzs_fx values (w, me, sub, prov, svc, p1, p2);
  insert into vzs_live(step, expected, actual, ok) values ('fixture', '2 patients + provider/service', 'ok', p2 is not null and svc is not null);
  if to_regprocedure('clinic_reception.shift_guard_check(uuid)') is not null then
    begin g := clinic_reception.shift_guard_state();
      if coalesce((g->>'locked')::boolean, false) then
        execute 'create or replace function clinic_reception.shift_guard_check(p_workspace uuid) returns void language plpgsql as $f$ begin return; end $f$';
        insert into vzs_live(step, expected, actual, ok) values ('shift guard (unrelated)', 'open shift, or stubbed in this txn', 'stubbed (Mazen had no open shift)', true);
      end if;
    exception when others then insert into vzs_live(step, expected, actual, ok) values ('shift guard (unrelated)', 'state readable', sqlerrm, true); end;
  end if;
end $$;

do $$ declare f vzs_fx; r jsonb; err text; ap record; o record; wk uuid;
  sms text := 'Dear Doctor Test Doctor, You received a new Shamel booking Test Patient - 01999000911 Today '
              || to_char((now() at time zone 'Africa/Cairo')::date, 'DD/MM') || ' - Hadayek El-Ahram';
begin select * into f from vzs_fx;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', f.sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', f.sub::text, true);
  -- refusals first (nothing saved)
  begin execute 'set local role authenticated';
    perform public.clinic_reception_command(f.w, 'walk_in', jsonb_build_object('patient_id', f.p1, 'provider_id', f.prov, 'service_id', f.svc, 'same_day_ok', true,
      'source', 'vezeeta', 'discount_kind', 'vezeeta', 'discount_percent', '40', 'discount_proof_text', replace(sms, 'Shamel ', '')), gen_random_uuid()); execute 'reset role'; err := 'accepted';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into vzs_live(step, expected, actual, ok) values ('1 SMS without «Shamel»', 'refused «مش فيزيتا شامل»', err, err like '%مش «فيزيتا شامل»%');
  begin execute 'set local role authenticated';
    perform public.clinic_reception_command(f.w, 'walk_in', jsonb_build_object('patient_id', f.p1, 'provider_id', f.prov, 'service_id', f.svc, 'same_day_ok', true,
      'source', 'vezeeta', 'discount_kind', 'vezeeta', 'discount_percent', '40', 'discount_proof_text', replace(sms, 'Hadayek El-Ahram', 'Nasr City')), gen_random_uuid()); execute 'reset role'; err := 'accepted';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into vzs_live(step, expected, actual, ok) values ('2 SMS for another branch', 'refused «لفرع تاني»', err, err like '%لفرع تاني%');
  begin execute 'set local role authenticated';
    perform public.clinic_reception_command(f.w, 'walk_in', jsonb_build_object('patient_id', f.p2, 'provider_id', f.prov, 'service_id', f.svc, 'same_day_ok', true,
      'source', 'vezeeta', 'discount_kind', 'vezeeta', 'discount_percent', '40', 'discount_proof_text', sms), gen_random_uuid()); execute 'reset role'; err := 'accepted';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into vzs_live(step, expected, actual, ok) values ('3 SMS of another patient''s phone', 'refused «رقم تليفون المريض مش هو اللي في الرسالة»', err, err like '%رقم تليفون المريض مش هو اللي في رسالة فيزيتا%');
  begin execute 'set local role authenticated';
    perform public.clinic_reception_command(f.w, 'walk_in', jsonb_build_object('patient_id', f.p2, 'provider_id', f.prov, 'service_id', f.svc, 'same_day_ok', true,
      'source', 'vezeeta', 'discount_kind', 'vezeeta', 'discount_percent', '40'), gen_random_uuid()); execute 'reset role'; err := 'accepted';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into vzs_live(step, expected, actual, ok) values ('4 no SMS and no card', 'refused «رقم كارت فيزيتا شامل إجباري» (card path unchanged)', err, err like '%رقم كارت فيزيتا شامل إجباري%');
  -- 5) the real thing: walk-in, Shamel SMS as proof
  begin execute 'set local role authenticated';
    r := public.clinic_reception_command(f.w, 'walk_in', jsonb_build_object('patient_id', f.p1, 'provider_id', f.prov, 'service_id', f.svc, 'same_day_ok', true,
      'source', 'vezeeta', 'discount_kind', 'vezeeta', 'discount_percent', '40', 'discount_proof_text', sms), gen_random_uuid()); execute 'reset role'; err := 'ok'; wk := (r->>'id')::uuid;
  exception when others then execute 'reset role'; err := sqlerrm; end;
  select * into ap from clinic_reception.appointments where id = wk;
  insert into vzs_live(step, expected, actual, ok) values ('5 Mazen walk-in «فيزيتا شامل» with the SMS', 'saved · vezeeta 40 · proof + Mazen · no card photo · source vezeeta',
    err || ' · ' || coalesce(ap.discount_kind, '-') || ' ' || coalesce(ap.discount_percent::text, '-') || ' · proof ' || (ap.discount_proof_text is not null)
      || ' · by Mazen ' || (ap.discount_proof_by = f.me) || ' · photo ' || coalesce(ap.discount_card_path, 'none') || ' · source ' || coalesce(ap.source, '-'),
    err = 'ok' and ap.discount_kind = 'vezeeta' and ap.discount_percent = 40 and ap.discount_proof_text = sms and ap.discount_proof_by = f.me
      and ap.discount_card_path is null and ap.source = 'vezeeta');
  if wk is not null then
    begin execute 'set local role authenticated';
      perform public.clinic_reception_command(f.w, 'arrive', jsonb_build_object('id', wk), gen_random_uuid()); execute 'reset role'; err := 'ok';
    exception when others then execute 'reset role'; err := sqlerrm; end;
    select ord.discount, dr.status into o from clinic_reception.orders ord join clinic_reception.visits v on v.id = ord.visit_id
      left join clinic_reception.discount_requests dr on dr.order_id = ord.id where v.appointment_id = wk order by ord.created_at limit 1;
    insert into vzs_live(step, expected, actual, ok) values ('6 Mazen «وصل»', 'order 40% · approved', err || ' · ' || coalesce(o.discount::text, '-') || ' · ' || coalesce(o.status, '-'),
      err = 'ok' and o.discount = 40 and o.status = 'approved');
  end if;
end $$;

-- >>> ROLLBACK BODY: supabase/rollbacks/20261126190000_vezeeta_sms_proof.rollback.sql >>>
drop function clinic_reception.set_booking_discount(uuid, uuid, jsonb, uuid);
alter function clinic_reception.set_booking_discount_before_vezeeta_sms(uuid, uuid, jsonb, uuid) rename to set_booking_discount;
revoke all on function clinic_reception.set_booking_discount(uuid, uuid, jsonb, uuid) from public, anon, authenticated;
drop function clinic_reception.vezeeta_sms_ok(text, uuid);
update clinic_reception.appointments set discount_kind = 'special', discount_reason = 'فيزيتا شامل (رسالة فيزيتا)', discount_card_no = null,
    discount_card_expiry = null, discount_card_path = null, discount_percent = least(discount_percent, 30)
 where discount_kind = 'vezeeta' and length(coalesce(discount_card_path, '')) <= 3 and discount_proof_text is not null;
alter table clinic_reception.appointments drop constraint appointments_discount_complete;
alter table clinic_reception.appointments add constraint appointments_discount_complete check (
  discount_kind is null
  or (discount_kind = 'syndicate' and discount_percent is not null and discount_org_type is not null
      and length(btrim(coalesce(discount_org_name, ''))) >= 2 and length(btrim(coalesce(discount_card_no, ''))) >= 2
      and discount_card_expiry is not null and length(coalesce(discount_card_path, '')) > 3)
  or (discount_kind = 'special' and discount_percent is not null and length(btrim(coalesce(discount_reason, ''))) >= 3)
  or (discount_kind = 'vezeeta' and discount_percent = 40 and length(btrim(coalesce(discount_card_no, ''))) >= 2
      and discount_card_expiry is not null and length(coalesce(discount_card_path, '')) > 3)
  or (discount_kind = 'family' and discount_percent between 10 and 50)
  or (discount_kind = 'staff' and discount_percent is not null and discount_staff_id is not null and length(btrim(coalesce(discount_reason, ''))) >= 3));
alter table clinic_reception.appointments drop column discount_proof_text, drop column discount_proof_by, drop column discount_proof_at;
notify pgrst, 'reload schema';
-- <<< END ROLLBACK BODY <<<
insert into vzs_live(step, expected, actual, ok) select '7 rollback body', 'wrapper gone, columns gone',
  coalesce(to_regprocedure('clinic_reception.set_booking_discount_before_vezeeta_sms(uuid,uuid,jsonb,uuid)')::text, 'gone') || ' / proof column '
  || (select count(*) from information_schema.columns where table_schema = 'clinic_reception' and table_name = 'appointments' and column_name = 'discount_proof_text'),
  to_regprocedure('clinic_reception.set_booking_discount_before_vezeeta_sms(uuid,uuid,jsonb,uuid)') is null
  and not exists (select 1 from information_schema.columns where table_schema = 'clinic_reception' and table_name = 'appointments' and column_name = 'discount_proof_text');

select step, expected, actual, ok from vzs_live order by n;
rollback;
