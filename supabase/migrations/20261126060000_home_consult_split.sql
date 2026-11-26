-- «كشف منزلي (شامل الانتقال)» = 1500 for every doctor (owner 2026-11-26): the doctor gets 750, a nurse who goes WITH the doctor
-- gets 100, the center keeps the rest (650 with a nurse, 750 without). Services / supplies / medicines are separate lines on top.
-- Doctor 750 = an EXACT-CODE doctor contract at 50% on the home-consult code (ops supabase/ops/20261126_home_consult_split.sql,
-- maker-checker as usual). This file adds only what the reception execution does not do today:
--   (1) NURSE 100. clinic_reception.home_visit_split(service_code, nurse_fee) lists the services that pay a nurse a fixed amount
--       when the booking says «ممرض/ة مع طبيب» (appointments.performer_mode = 'nurse_with_doctor', nurse_admin_id, #641).
--       When such an order is executed (orders.status → completed, which also creates its reception invoice) ONE entry is posted:
--       source home_nurse_fee, 5111 → 2120, provider_id = the NURSE's reception provider (doctor_key = her HR code) + invoice_id.
--       That is exactly how doctor_fee / referral_fee lines are kept, so the nurse's balance, «صرف الحساب» (desk_rx_fees) and
--       «صرف مستحقات بالفواتير» pick it up unchanged (payable once the patient paid the invoice in full).
--       Amount = least(nurse_fee, what is left of the order after the doctor's fee). The doctor's fee is NOT reduced, so the center
--       remainder is revenue − doctor fee − nurse fee automatically. Nothing for «الطبيب» / «ممرض/ة لوحده».
--       Credit note / insurer contractual cut → the same share of the nurse fee is reversed (home_nurse_adjust); a voided
--       («إلغاء خدمة») order → reversed in full. Never blocks the execution: a missing provider / invoice / error is kept in
--       clinic_reception.home_nurse_issues and retried when the nurse's provider row appears.
--   (3) ALWAYS WITH THE DOCTOR (owner 2026-11-26 00:37Z): a split service cannot be booked / walked in / rescheduled / executed
--       with performer «ممرض/ة لوحده» (wrapper over public.clinic_reception_command + the execution guard below).
--   (4) TRAVEL TIME (same answers): the visit itself is the service length (15 min) and the booking also holds the doctor (and the
--       nurse) for the road there and back: appointments.travel_minutes (30 / 60 / 90 / 120, default home_visit_split.travel_minutes
--       = 60). The wrapper books minutes = visit + travel through the existing «minutes» override (clinic_reception.booking_minutes),
--       so availability, overlap and the booking gap cover the whole trip; a nurse on the booking is checked on the same span.
--       Reschedule keeps the stored travel unless a new one is sent. clinic_reception_snapshot gains home_visit_split
--       [{service_id, code, travel_minutes}] so the booking form hides «ممرض/ة لوحده» and offers «وقت الطريق (رايح وجاي)».
--   (2) EXACT CONTRACT GUARD. A split service is executed only on an exact-code contract of the doctor: without it the doctor's
--       department contract («قسم:خدمات الكشف», e.g. a consult %) would silently apply to the 1500. Live workspaces only.
-- Rows of home_visit_split are data (written by the ops script, no grants). Rollback: supabase/rollbacks/20261126060000_home_consult_split.rollback.sql
do $$ begin
  if to_regclass('clinic_reception.home_visit_split') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

begin;

do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'clinic_reception' and table_name = 'appointments' and column_name = 'performer_mode')
     or not exists (select 1 from information_schema.columns where table_schema = 'clinic_reception' and table_name = 'appointments' and column_name = 'nurse_admin_id') then
    raise exception 'طبّق 20261120220000_reception_booking_nurse_performer الأول';
  end if;
  if to_regprocedure('clinic_finance.desk_rx_fees(text)') is null or to_regprocedure('clinic_reception.post(uuid,text,uuid,text,text,text,numeric,jsonb)') is null
     or to_regclass('clinic_reception.doctor_agreements') is null or to_regclass('clinic_finance.doctor_contracts') is null then
    raise exception 'مكونات أتعاب الاستقبال / صرف الحساب غير موجودة';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'clinic_reception' and table_name = 'invoices' and column_name = 'credit_amount')
     or not exists (select 1 from information_schema.columns where table_schema = 'clinic_reception' and table_name = 'orders' and column_name = 'agreement_id') then
    raise exception 'أعمدة الاستقبال المتوقعة (credit_amount / agreement_id) غير موجودة';
  end if;
  if to_regprocedure('public.clinic_reception_command(uuid,text,jsonb,uuid)') is null or to_regprocedure('public.clinic_reception_snapshot(uuid,date,date)') is null
     or to_regprocedure('clinic_reception.booking_minutes(uuid,jsonb)') is null then
    raise exception 'أوامر الحجز / لقطة الاستقبال / مدة الحجز غير موجودة';
  end if;
end $$;

create table clinic_reception.home_visit_split (
  service_code text primary key check (length(btrim(service_code)) >= 2),
  nurse_fee numeric(12,2) not null check (nurse_fee > 0 and nurse_fee <= 100000),
  exact_contract boolean not null default true,
  travel_minutes integer not null default 60 check (travel_minutes in (30, 60, 90, 120)),
  active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now()
);
alter table clinic_reception.home_visit_split enable row level security;
revoke all on clinic_reception.home_visit_split from public, anon, authenticated;

create table clinic_reception.home_nurse_issues (
  order_id uuid primary key references clinic_reception.orders(id) on delete cascade,
  workspace_id uuid not null references clinic_reception.workspaces(id),
  reason text not null,
  detail text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
alter table clinic_reception.home_nurse_issues enable row level security;
revoke all on clinic_reception.home_nurse_issues from public, anon, authenticated;

-- the nurse's reception provider: doctor_key = her HR doctor_key or HR code (clinic_people.people), active first
create function clinic_reception.home_nurse_provider(p_workspace uuid, p_admin uuid, out provider_id uuid, out nurse_key text)
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare k1 text; k2 text;
begin
  if p_admin is null or to_regclass('clinic_people.people') is null then return; end if;
  execute 'select nullif(btrim(doctor_key), ''''), nullif(btrim(code), '''') from clinic_people.people where admin_id = $1' into k1, k2 using p_admin;
  nurse_key := coalesce(k1, k2);
  select p.id, p.doctor_key into provider_id, nurse_key from clinic_reception.providers p
   where p.workspace_id = p_workspace and p.doctor_key is not null and p.doctor_key in (k1, k2)
   order by p.active desc, (p.doctor_key = k1) desc, p.id limit 1;
  if provider_id is null then nurse_key := coalesce(k1, k2); end if;
end $$;

-- money already booked for the nurse on one order (fee + adjustments)
create function clinic_reception.home_nurse_booked(p_order uuid, out original numeric, out current_fee numeric, out dims jsonb)
language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce(sum(l.credit) filter (where j.source = 'home_nurse_fee'), 0), coalesce(sum(l.credit - l.debit), 0),
         (array_agg(j.dimensions) filter (where j.source = 'home_nurse_fee'))[1]
    from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id = j.id and l.account = '2120'
   where j.source in ('home_nurse_fee', 'home_nurse_adjust') and nullif(j.dimensions->>'order_id', '')::uuid = p_order
$$;

-- keeps the nurse fee equal to its share of what the patient / insurer really owes; 0 for a cancelled (voided) order
create function clinic_reception.home_nurse_sync(p_order uuid) returns void language plpgsql security definer set search_path = pg_catalog, public as $$
declare o clinic_reception.orders%rowtype; i clinic_reception.invoices%rowtype; b record; target numeric; cut numeric;
begin
  select * into o from clinic_reception.orders where id = p_order;
  if not found then return; end if;
  select * into b from clinic_reception.home_nurse_booked(p_order);
  if b.original <= 0 then return; end if;
  if o.status = 'cancelled' then target := 0;
  else
    select * into i from clinic_reception.invoices where order_id = p_order order by created_at limit 1;
    if not found or i.amount <= 0 then return; end if;
    cut := coalesce(i.credit_amount, 0) + coalesce((select c.contractual from clinic_reception.claims c where c.invoice_id = i.id), 0);
    target := round(b.original * greatest(0, 1 - cut / i.amount), 2);
  end if;
  if b.current_fee > target then
    perform clinic_reception.post(o.workspace_id, 'home_nurse_adjust', gen_random_uuid(), 'رد أتعاب ممرض/ة الزيارة المنزلية (إشعار دائن / خصم تعاقدي / إلغاء)', '2120', '5111', b.current_fee - target, b.dims);
  elsif b.current_fee < target then
    perform clinic_reception.post(o.workspace_id, 'home_nurse_adjust', gen_random_uuid(), 'إعادة أتعاب ممرض/ة الزيارة المنزلية بعد تعديل الإشعار', '5111', '2120', target - b.current_fee, b.dims);
  end if;
end $$;

-- posts the nurse fee of one completed order (idempotent); never raises: problems are kept in home_nurse_issues
create function clinic_reception.home_nurse_try(p_order uuid) returns text language plpgsql security definer set search_path = pg_catalog, public as $$
declare o clinic_reception.orders%rowtype; cfg clinic_reception.home_visit_split%rowtype; ap record; np record; inv uuid; pat uuid; amt numeric; why text;
begin
  select * into o from clinic_reception.orders where id = p_order;
  if not found or o.status <> 'completed' then return 'skip'; end if;
  select * into cfg from clinic_reception.home_visit_split where service_code = o.snapshot->>'code' and active;
  if not found then return 'none'; end if;
  begin
    select a.performer_mode, a.nurse_admin_id into ap from clinic_reception.visits v join clinic_reception.appointments a on a.id = v.appointment_id where v.id = o.visit_id;
    if ap.performer_mode is distinct from 'nurse_with_doctor' or ap.nurse_admin_id is null then return 'no_nurse'; end if;
    if exists (select 1 from clinic_reception.journal where workspace_id = o.workspace_id and source = 'home_nurse_fee' and source_id = o.id) then
      update clinic_reception.home_nurse_issues set resolved_at = coalesce(resolved_at, now()) where order_id = o.id; return 'done';
    end if;
    select * into np from clinic_reception.home_nurse_provider(o.workspace_id, ap.nurse_admin_id);
    if np.provider_id is not null and np.provider_id = o.provider_id then return 'self'; end if;
    select id, patient_id into inv, pat from clinic_reception.invoices where order_id = o.id order by created_at limit 1;
    amt := least(cfg.nurse_fee, greatest(0, coalesce(o.net_revenue, 0) - coalesce(o.doctor_fee, 0)));
    why := case when np.provider_id is null then 'missing_provider' when inv is null then 'missing_invoice' when amt <= 0 then 'nothing_left' end;
    if why is not null then
      insert into clinic_reception.home_nurse_issues(order_id, workspace_id, reason, detail) values (o.id, o.workspace_id, why, coalesce(np.nurse_key, ap.nurse_admin_id::text))
        on conflict (order_id) do update set reason = excluded.reason, detail = excluded.detail, resolved_at = null;
      return why;
    end if;
    perform clinic_reception.post(o.workspace_id, 'home_nurse_fee', o.id, 'أتعاب ممرض/ة مع الطبيب — ' || coalesce(o.snapshot->>'name', 'زيارة منزلية'), '5111', '2120', amt,
      jsonb_build_object('patient_id', pat, 'visit_id', o.visit_id, 'order_id', o.id, 'provider_id', np.provider_id, 'invoice_id', inv,
                         'home_nurse', true, 'nurse_admin_id', ap.nurse_admin_id, 'doctor_provider_id', o.provider_id));
    perform clinic_reception.home_nurse_sync(o.id);
    update clinic_reception.home_nurse_issues set resolved_at = now() where order_id = o.id;
    return 'posted';
  exception when others then
    insert into clinic_reception.home_nurse_issues(order_id, workspace_id, reason, detail) values (o.id, o.workspace_id, 'error', left(sqlerrm, 500))
      on conflict (order_id) do update set reason = 'error', detail = excluded.detail, resolved_at = null;
    return 'error';
  end;
end $$;

-- (2) a split service runs only on the doctor's EXACT-code contract (live): the agreement the execution picked must come from it
create function clinic_reception.home_split_contract_guard() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare scope text;
begin
  if new.status = 'completed' and old.status is distinct from 'completed'
     and exists (select 1 from clinic_reception.home_visit_split s where s.service_code = new.snapshot->>'code' and s.active)
     and exists (select 1 from clinic_reception.visits v join clinic_reception.appointments a on a.id = v.appointment_id
                  where v.id = new.visit_id and a.performer_mode = 'nurse_alone') then
    raise exception 'الكشف المنزلي لازم يكون معاه الطبيب — اختار «الطبيب» أو «ممرض/ة مع طبيب»' using hint = 'home_split_nurse_alone';
  end if;
  if new.status = 'completed' and old.status is distinct from 'completed'
     and exists (select 1 from clinic_reception.home_visit_split s where s.service_code = new.snapshot->>'code' and s.active and s.exact_contract)
     and exists (select 1 from clinic_reception.workspaces w where w.id = new.workspace_id and w.mode = 'live') then
    select c.service_scope into scope from clinic_reception.doctor_agreements g join clinic_finance.doctor_contracts c on c.id = g.finance_contract_id where g.id = new.agreement_id;
    if scope is distinct from new.snapshot->>'code' then
      raise exception 'عقد «%» للطبيب ده لسه ما اتعتمدش في الحسابات (عقد بكود الخدمة نفسه، مش عقد القسم) — كلّم المدير المالي', coalesce(new.snapshot->>'name', new.snapshot->>'code')
        using hint = 'home_split_contract';
    end if;
  end if;
  return new;
end $$;
create trigger home_split_contract_guard before update of status on clinic_reception.orders for each row execute function clinic_reception.home_split_contract_guard();

create function clinic_reception.home_nurse_on_order() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then perform clinic_reception.home_nurse_try(new.id);
  elsif new.status = 'cancelled' and old.status = 'completed' then
    begin perform clinic_reception.home_nurse_sync(new.id);
    exception when others then
      insert into clinic_reception.home_nurse_issues(order_id, workspace_id, reason, detail) values (new.id, new.workspace_id, 'sync_error', left(sqlerrm, 500))
        on conflict (order_id) do update set reason = 'sync_error', detail = excluded.detail, resolved_at = null;
    end;
  end if;
  return new;
end $$;
create trigger home_nurse_on_order after update of status on clinic_reception.orders for each row execute function clinic_reception.home_nurse_on_order();

-- credit notes / contractual cuts keep the nurse fee proportional (never blocks the underlying operation)
create function clinic_reception.home_nurse_follow_cut() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare inv uuid := case when tg_table_name = 'claims' then (to_jsonb(new)->>'invoice_id')::uuid else (to_jsonb(new)->>'id')::uuid end; ord uuid; ws uuid;
begin
  select order_id, workspace_id into ord, ws from clinic_reception.invoices where id = inv;
  if ord is null or not exists (select 1 from clinic_reception.journal j where j.source = 'home_nurse_fee' and j.source_id = ord) then return new; end if;
  begin
    perform clinic_reception.home_nurse_sync(ord);
  exception when others then
    insert into clinic_reception.home_nurse_issues(order_id, workspace_id, reason, detail) values (ord, ws, 'sync_error', left(sqlerrm, 500))
      on conflict (order_id) do update set reason = 'sync_error', detail = excluded.detail, resolved_at = null;
  end;
  return new;
end $$;
create trigger home_nurse_follow_credit after update of credit_amount on clinic_reception.invoices for each row
  when (new.credit_amount is distinct from old.credit_amount) execute function clinic_reception.home_nurse_follow_cut();
create trigger home_nurse_follow_contractual after insert or update of contractual on clinic_reception.claims for each row execute function clinic_reception.home_nurse_follow_cut();

-- retry waiting nurse fees when a provider row appears / gets its doctor_key
create function clinic_reception.home_nurse_retry_provider() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare x record;
begin
  if new.doctor_key is null then return new; end if;
  for x in select q.order_id from clinic_reception.home_nurse_issues q where q.resolved_at is null and q.workspace_id = new.workspace_id and q.reason = 'missing_provider' and q.detail = new.doctor_key loop
    perform clinic_reception.home_nurse_try(x.order_id);
  end loop;
  return new;
end $$;
create trigger home_nurse_retry_provider after insert or update of doctor_key on clinic_reception.providers for each row execute function clinic_reception.home_nurse_retry_provider();


-- (3)+(4) booking wrapper: refuse «ممرض/ة لوحده» on a split service; book visit + travel, keep travel on the appointment
alter table clinic_reception.appointments add column if not exists travel_minutes integer;
alter table clinic_reception.appointments drop constraint if exists appointments_travel_check;
alter table clinic_reception.appointments add constraint appointments_travel_check check (travel_minutes is null or travel_minutes in (30, 60, 90, 120));

alter function public.clinic_reception_command(uuid, text, jsonb, uuid) rename to command_before_home_split;
alter function public.command_before_home_split(uuid, text, jsonb, uuid) set schema clinic_reception;

create function public.clinic_reception_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare a clinic_reception.appointments%rowtype; s clinic_reception.services%rowtype; cfg clinic_reception.home_visit_split%rowtype;
  mode text; travel integer; base integer; out jsonb; v uuid; x clinic_reception.appointments%rowtype; clash record;
begin
  if p_action not in ('book', 'walk_in', 'reschedule') or jsonb_typeof(p_payload) is distinct from 'object' then
    return clinic_reception.command_before_home_split(p_workspace, p_action, p_payload, p_token);
  end if;
  if p_action = 'reschedule' then
    select * into a from clinic_reception.appointments where workspace_id = p_workspace and id = nullif(p_payload->>'id', '')::uuid;
  end if;
  select * into s from clinic_reception.services where workspace_id = p_workspace and id = coalesce(nullif(p_payload->>'service_id', '')::uuid, a.service_id);
  if s.id is not null then select * into cfg from clinic_reception.home_visit_split where service_code = s.code and active; end if;
  if cfg.service_code is null or nullif(p_payload->>'package_id', '') is not null then
    out := clinic_reception.command_before_home_split(p_workspace, p_action, p_payload - 'travel_minutes', p_token);
    if a.id is not null and a.travel_minutes is not null and nullif(out->>'id', '') is not null then
      update clinic_reception.appointments set travel_minutes = null where workspace_id = p_workspace and id = (out->>'id')::uuid;
    end if;
    return out;
  end if;
  mode := case when p_payload ? 'performer_mode' then coalesce(nullif(p_payload->>'performer_mode', ''), 'doctor') else coalesce(a.performer_mode, 'doctor') end;
  if mode = 'nurse_alone' then
    raise exception 'الكشف المنزلي لازم يكون معاه الطبيب — اختار «الطبيب» أو «ممرض/ة مع طبيب»' using hint = 'home_split_nurse_alone';
  end if;
  if nullif(p_payload->>'travel_minutes', '') is not null then
    if p_payload->>'travel_minutes' not in ('30', '60', '90', '120') then raise exception 'وقت الطريق (رايح وجاي) لازم يكون 30 أو 60 أو 90 أو 120 دقيقة'; end if;
    travel := (p_payload->>'travel_minutes')::integer;
  else travel := coalesce(a.travel_minutes, cfg.travel_minutes); end if;
  if nullif(p_payload->>'minutes', '') is not null then
    if p_payload->>'minutes' !~ '^[0-9]{1,3}$' then raise exception 'مدة الجلسة غير صحيحة'; end if;
    base := (p_payload->>'minutes')::integer;
  else base := s.minutes; end if;
  out := clinic_reception.command_before_home_split(p_workspace, p_action,
           (p_payload - 'travel_minutes') || jsonb_build_object('minutes', (base + travel)::text), p_token);
  v := nullif(out->>'id', '')::uuid;
  if v is null then return out; end if;
  update clinic_reception.appointments set travel_minutes = travel where workspace_id = p_workspace and id = v returning * into x;
  -- the nurse is held for the whole trip too (the booking wrapper checks her only when the performer keys are sent)
  if x.nurse_admin_id is not null then
    select o.starts_at, coalesce(ad.name, 'الممرض/ة') who into clash
      from clinic_reception.appointments o left join public.admins ad on ad.id = o.nurse_admin_id
     where o.nurse_admin_id = x.nurse_admin_id and o.id <> x.id and o.status in ('booked', 'arrived')
       and o.starts_at < x.ends_at and o.ends_at > x.starts_at
     order by o.starts_at limit 1;
    if found then
      raise exception '% عنده/عندها زيارة تانية في نفس الوقت (الساعة %) — اختار وقت أو ممرض/ة تاني', clash.who,
        to_char(clash.starts_at at time zone 'Africa/Cairo', 'HH24:MI') using hint = 'nurse_overlap';
    end if;
  end if;
  return out;
end $$;

alter function public.clinic_reception_snapshot(uuid, date, date) rename to snapshot_before_home_split;
alter function public.snapshot_before_home_split(uuid, date, date) set schema clinic_reception;
create function public.clinic_reception_snapshot(p_workspace uuid, p_from date default current_date, p_to date default current_date)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare result jsonb;
begin
  result := clinic_reception.snapshot_before_home_split(p_workspace, p_from, p_to);   -- access check first
  return result || jsonb_build_object('home_visit_split', coalesce((
    select jsonb_agg(jsonb_build_object('service_id', s.id, 'code', s.code, 'travel_minutes', h.travel_minutes) order by s.code)
      from clinic_reception.services s join clinic_reception.home_visit_split h on h.service_code = s.code and h.active
     where s.workspace_id = p_workspace and s.active), '[]'::jsonb));
end $$;

-- the wrappers get exactly the privileges of the functions they wrap
do $$ declare r record; pair text[]; begin
  foreach pair slice 1 in array array[['clinic_reception.command_before_home_split(uuid,text,jsonb,uuid)', 'public.clinic_reception_command(uuid,text,jsonb,uuid)'],
                                      ['clinic_reception.snapshot_before_home_split(uuid,date,date)', 'public.clinic_reception_snapshot(uuid,date,date)']] loop
    execute format('revoke all on function %s from public, anon, authenticated', pair[2]);
    for r in select a.grantee, a.privilege_type from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
              where p.oid = pair[1]::regprocedure and a.grantee <> p.proowner loop
      execute format('grant %s on function %s to %s', r.privilege_type, pair[2], case when r.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(r.grantee)) end);
    end loop;
    execute format('revoke all on function %s from public, anon, authenticated', pair[1]);
  end loop;
end $$;

revoke all on function clinic_reception.home_nurse_provider(uuid, uuid), clinic_reception.home_nurse_booked(uuid), clinic_reception.home_nurse_sync(uuid),
  clinic_reception.home_nurse_try(uuid), clinic_reception.home_split_contract_guard(), clinic_reception.home_nurse_on_order(),
  clinic_reception.home_nurse_follow_cut(), clinic_reception.home_nurse_retry_provider() from public, anon, authenticated;

commit;
