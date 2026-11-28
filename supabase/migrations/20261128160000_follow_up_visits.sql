-- «متابعة» — follow-up visits (owner approved 2026-11-28, mockup docs/ui-references/mockups/follow-up-visits.html):
--   «عدد المتابعات ممكن يحددها الحسابات أو مدير المركز بعد ما يعرف من الطبيب. الطبيب ما بياخدش حاجة من المتابعة لو هي من ضمن باقة…
--    انما لو المتابعة دي ليها سعر زي 100 جنيه… بياخد منها نسبة زي نسبته في الكشف. لو الصلاحية خلصت يتطبق الرسوم مباشرة، ويبقى في اوبشن
--    طلب مد يوم او يومين بحد اقصى 3 ايام، ويتوافق عليه من حد تاني، والمتابعة لازم تبقى مع نفس الطبيب. رسوم المتابعة كلها بتبقى 100،
--    إلا إذا في باقات بتدفع مسبقا، دي موجودة في لائحة الأسعار».
-- What this adds (nothing existing is removed; packages keep their own visits / validity / pricing):
--   follow_up_rules       per service: included follow-ups + valid days (set by accountant / financial_manager / general_manager / super_admin)
--   visit_follow_ups      the balance of one executed service (origin visit / order / patient / SAME doctor / included / expires / extension)
--                         — opened automatically when an order with a rule is executed
--   follow_up_uses        a hold per included booking (held → used at execution; released on cancel / no-show / switch to fee)
--   follow_up_extensions  «طلب مدّ» 1..3 days, approved by ANOTHER person
--   appointments.follow_up_id / follow_of_visit_id / follow_up_coverage ('included' | 'fee')
--   settings.follow_up_fee (default 100)
--   Order price at arrival (trigger): included → 0; fee → settings.follow_up_fee; an included booking that expired / ran out by then → fee.
--   Doctor fee: service_operation (execute) is patched at ONE anchor (saved in follow_up_saved_defs): a follow-up order uses the doctor's
--   «كشف» agreement (same percent as his consultation); 0-priced included follow-ups → 0 automatically.
--   RPC public.clinic_reception_follow_up(workspace, action, payload): sources / book / board / rules_get / rules_set / extend_request /
--   extensions / extend_review / report.
-- Rollback: supabase/rollbacks/20261128160000_follow_up_visits.rollback.sql
do $$ declare d text; n int; begin
  if to_regprocedure('clinic_reception.service_operation(uuid,text,jsonb,uuid)') is null
     or to_regprocedure('public.clinic_reception_command(uuid,text,jsonb,uuid)') is null
     or to_regprocedure('clinic_reception.consult_kind(text)') is null
     or to_regprocedure('clinic_reception.serves_service(uuid,text,text)') is null
     or to_regprocedure('clinic_reception.today()') is null then raise exception 'طبّق ملفات الاستقبال (الخدمات، consult_kind، serves_service) الأول'; end if;
  if to_regclass('clinic_reception.visit_follow_ups') is not null then raise exception 'تم تطبيق 20261128160000 قبل كده'; end if;
  d := pg_get_functiondef('clinic_reception.service_operation(uuid,text,jsonb,uuid)'::regprocedure);
  n := (length(d) - length(replace(d, $a$select * into agreement from clinic_reception.doctor_agreements where workspace_id=p_workspace and provider_id=o.provider_id and service_code=o.snapshot->>'code' and status='active' and current_date between valid_from and valid_to;$a$, ''))) / nullif(length($a$select * into agreement from clinic_reception.doctor_agreements where workspace_id=p_workspace and provider_id=o.provider_id and service_code=o.snapshot->>'code' and status='active' and current_date between valid_from and valid_to;$a$), 0);
  if n is distinct from 1 then raise exception 'سطر عقد الأتعاب في service_operation مش موجود مرة واحدة (%)', n; end if;
end $$;
begin;
create table clinic_reception.follow_up_saved_defs(name text primary key, def text not null, saved_at timestamptz not null default now());
revoke all on clinic_reception.follow_up_saved_defs from public, anon, authenticated;
insert into clinic_reception.follow_up_saved_defs values ('service_operation', pg_get_functiondef('clinic_reception.service_operation(uuid,text,jsonb,uuid)'::regprocedure));

alter table clinic_reception.settings add column if not exists follow_up_fee numeric(14,2) not null default 100 check (follow_up_fee >= 0);

create table clinic_reception.follow_up_rules(
  service_id uuid primary key references clinic_reception.services(id),
  workspace_id uuid not null references clinic_reception.workspaces(id),
  included_count int not null check (included_count between 0 and 50),
  valid_days int not null check (valid_days between 1 and 730),
  active boolean not null default true,
  note text check (note is null or length(note) <= 300),
  updated_by uuid references public.admins(id), updated_at timestamptz not null default now());

create table clinic_reception.visit_follow_ups(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references clinic_reception.workspaces(id),
  origin_visit_id uuid not null references clinic_reception.visits(id),
  origin_order_id uuid not null unique references clinic_reception.orders(id),
  patient_id uuid not null references clinic_reception.patients(id),
  provider_id uuid not null references clinic_reception.providers(id),
  service_id uuid not null references clinic_reception.services(id),
  included int not null check (included between 0 and 50),
  expires_on date not null,
  extended_until date,
  created_at timestamptz not null default now());
create index on clinic_reception.visit_follow_ups(patient_id);

create table clinic_reception.follow_up_uses(
  appointment_id uuid primary key references clinic_reception.appointments(id),
  follow_up_id uuid not null references clinic_reception.visit_follow_ups(id),
  order_id uuid references clinic_reception.orders(id),
  status text not null default 'held' check (status in ('held', 'used', 'released')),
  updated_at timestamptz not null default now());
create index on clinic_reception.follow_up_uses(follow_up_id);

create table clinic_reception.follow_up_extensions(
  id uuid primary key default gen_random_uuid(),
  follow_up_id uuid not null references clinic_reception.visit_follow_ups(id),
  days int not null check (days between 1 and 3),
  reason text not null check (length(btrim(reason)) between 5 and 300),
  requested_by uuid not null references public.admins(id), requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references public.admins(id), reviewed_at timestamptz, review_note text,
  check (reviewed_by is null or reviewed_by <> requested_by));
create unique index on clinic_reception.follow_up_extensions(follow_up_id) where status = 'pending';

alter table clinic_reception.appointments
  add column follow_up_id uuid references clinic_reception.visit_follow_ups(id),
  add column follow_of_visit_id uuid references clinic_reception.visits(id),
  add column follow_up_coverage text check (follow_up_coverage in ('included', 'fee'));

do $$ declare t text; begin
  foreach t in array array['follow_up_rules', 'visit_follow_ups', 'follow_up_uses', 'follow_up_extensions'] loop
    execute format('alter table clinic_reception.%I enable row level security', t);
    execute format('revoke all on clinic_reception.%I from public, anon, authenticated', t);
  end loop;
end $$;

-- helpers --------------------------------------------------------------------------------------------------------------------
create function clinic_reception.follow_up_valid_until(f clinic_reception.visit_follow_ups) returns date
language sql stable set search_path = pg_catalog as $$ select greatest(f.expires_on, coalesce(f.extended_until, f.expires_on)) $$;
create function clinic_reception.follow_up_left(p_id uuid, p_except uuid default null) returns int
language sql stable security definer set search_path = pg_catalog, public as $$
  select greatest(0, f.included - (select count(*) from clinic_reception.follow_up_uses u
                                     where u.follow_up_id = f.id and u.status in ('held', 'used') and u.appointment_id is distinct from p_except))::int
    from clinic_reception.visit_follow_ups f where f.id = p_id
$$;
create function clinic_reception.follow_up_can_manage() returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select public.has_role('accountant') or public.has_role('financial_manager') or public.has_role('general_manager') or public.has_role('super_admin')
$$;
-- the doctor's own «متابعة» service (same doctor, his department first)
create function clinic_reception.follow_up_service(p_workspace uuid, p_provider uuid) returns uuid
language sql stable security definer set search_path = pg_catalog, public as $$
  select s.id from clinic_reception.services s join clinic_reception.providers p on p.id = p_provider
   where s.workspace_id = p_workspace and s.active and clinic_reception.consult_kind(s.name) = 'F'
     and clinic_reception.serves_service(p_provider, s.department, s.code)
   order by (s.department = p.department) desc, s.price, s.name limit 1
$$;

-- order price at arrival + hold → order link -----------------------------------------------------------------------------------
create function clinic_reception.follow_up_order_before() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare a clinic_reception.appointments%rowtype; f clinic_reception.visit_follow_ups%rowtype; cov text; fee numeric; vno bigint; osvc text;
begin
  if new.entitlement_id is not null then return new; end if;
  select ap.* into a from clinic_reception.visits v join clinic_reception.appointments ap on ap.id = v.appointment_id where v.id = new.visit_id;
  if a.id is null or a.follow_up_coverage is null or new.service_id <> a.service_id then return new; end if;
  if exists (select 1 from clinic_reception.orders o where o.visit_id = new.visit_id and o.service_id = new.service_id and o.status <> 'cancelled' and o.snapshot ? 'follow_up') then return new; end if;
  cov := a.follow_up_coverage;
  if a.follow_up_id is not null then select * into f from clinic_reception.visit_follow_ups where id = a.follow_up_id; end if;
  if cov = 'included' and (f.id is null or clinic_reception.follow_up_valid_until(f) < clinic_reception.today()
                           or (clinic_reception.follow_up_left(f.id, a.id) <= 0
                               and not exists (select 1 from clinic_reception.follow_up_uses u where u.appointment_id = a.id and u.status = 'held'))) then
    cov := 'fee';   -- «لو الصلاحية خلصت يتطبق الرسوم مباشرة»
    update clinic_reception.appointments set follow_up_coverage = 'fee' where id = a.id;
    update clinic_reception.follow_up_uses set status = 'released', updated_at = now() where appointment_id = a.id and status = 'held';
  end if;
  fee := coalesce((select follow_up_fee from clinic_reception.settings where id), 100);
  new.price := case when cov = 'included' then 0 else fee end;
  select v.visit_no into vno from clinic_reception.visits v where v.id = coalesce(f.origin_visit_id, a.follow_of_visit_id);
  select s.name into osvc from clinic_reception.services s where s.id = f.service_id;
  new.snapshot := coalesce(new.snapshot, '{}'::jsonb) || jsonb_build_object('price', new.price,
    'follow_up', jsonb_build_object('id', f.id, 'coverage', cov, 'origin_visit_no', vno, 'origin_service', osvc));
  return new;
end $$;
create trigger trg_follow_up_order_before before insert on clinic_reception.orders for each row execute function clinic_reception.follow_up_order_before();

create function clinic_reception.follow_up_order_after() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
declare r clinic_reception.follow_up_rules%rowtype; v clinic_reception.visits%rowtype; ap uuid;
begin
  select * into v from clinic_reception.visits where id = new.visit_id;
  if tg_op = 'INSERT' then
    if new.snapshot ? 'follow_up' then update clinic_reception.follow_up_uses set order_id = new.id, updated_at = now() where appointment_id = v.appointment_id and status = 'held'; end if;
    return new;
  end if;
  -- executed
  if new.status = 'completed' and old.status <> 'completed' then
    if new.snapshot ? 'follow_up' then
      update clinic_reception.follow_up_uses set status = 'used', order_id = new.id, updated_at = now() where appointment_id = v.appointment_id and status = 'held';
    elsif new.entitlement_id is null then
      select * into r from clinic_reception.follow_up_rules where service_id = new.service_id and active and included_count > 0;
      if found then
        insert into clinic_reception.visit_follow_ups(workspace_id, origin_visit_id, origin_order_id, patient_id, provider_id, service_id, included, expires_on)
        values (new.workspace_id, new.visit_id, new.id, v.patient_id, new.provider_id, new.service_id, r.included_count, clinic_reception.today() + r.valid_days)
        on conflict (origin_order_id) do nothing;
      end if;
    end if;
  elsif new.status = 'cancelled' and old.status <> 'cancelled' and new.snapshot ? 'follow_up' then
    update clinic_reception.follow_up_uses set status = 'released', updated_at = now() where appointment_id = v.appointment_id and status in ('held', 'used');
  end if;
  return new;
end $$;
create trigger trg_follow_up_order_ins after insert on clinic_reception.orders for each row execute function clinic_reception.follow_up_order_after();
create trigger trg_follow_up_order_upd after update of status on clinic_reception.orders for each row execute function clinic_reception.follow_up_order_after();

create function clinic_reception.follow_up_appt_after() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.status in ('cancelled', 'no_show') and old.status is distinct from new.status then
    update clinic_reception.follow_up_uses set status = 'released', updated_at = now() where appointment_id = new.id and status = 'held';
  end if;
  return new;
end $$;
create trigger trg_follow_up_appt after update of status on clinic_reception.appointments for each row execute function clinic_reception.follow_up_appt_after();

-- doctor fee: a follow-up order uses the doctor's «كشف» agreement (same percent as his consultation) ----------------------------
do $$ begin
  execute replace(pg_get_functiondef('clinic_reception.service_operation(uuid,text,jsonb,uuid)'::regprocedure),
    $a$select * into agreement from clinic_reception.doctor_agreements where workspace_id=p_workspace and provider_id=o.provider_id and service_code=o.snapshot->>'code' and status='active' and current_date between valid_from and valid_to;$a$,
    $b$select * into agreement from clinic_reception.doctor_agreements where workspace_id=p_workspace and provider_id=o.provider_id and status='active' and current_date between valid_from and valid_to
      and (service_code=o.snapshot->>'code' or (o.snapshot ? 'follow_up' and service_code in (select s2.code from clinic_reception.services s2 where s2.workspace_id=p_workspace and clinic_reception.consult_kind(s2.name)='K')))
      order by (o.snapshot ? 'follow_up' and service_code<>o.snapshot->>'code') desc, valid_from desc limit 1;$b$);
end $$;

-- the RPC ----------------------------------------------------------------------------------------------------------------------
create function public.clinic_reception_follow_up(p_workspace uuid, p_action text, p_payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare p jsonb := coalesce(p_payload, '{}'); me uuid; f clinic_reception.visit_follow_ups%rowtype; ov clinic_reception.visits%rowtype;
  prov uuid; pat uuid; svc uuid; cov text; r jsonb; ap uuid; d date; e clinic_reception.follow_up_extensions%rowtype; t0 date; t1 date;
begin
  if p_action in ('book') then me := clinic_reception.access(p_workspace, 'book'); else me := clinic_reception.access(p_workspace, 'view'); end if;

  if p_action = 'sources' then
    pat := nullif(p->>'patient_id', '')::uuid;
    return jsonb_build_object('fee', coalesce((select follow_up_fee from clinic_reception.settings where id), 100),
      'follow_ups', coalesce((select jsonb_agg(jsonb_build_object('id', f2.id, 'origin_visit_id', f2.origin_visit_id, 'visit_no', v.visit_no,
          'service', s.name, 'provider_id', f2.provider_id, 'provider', pr.name, 'department', pr.department, 'done_on', (v.opened_at at time zone 'Africa/Cairo')::date,
          'included', f2.included, 'left', clinic_reception.follow_up_left(f2.id), 'valid_until', clinic_reception.follow_up_valid_until(f2),
          'expired', clinic_reception.follow_up_valid_until(f2) < clinic_reception.today(),
          'used', (select count(*) from clinic_reception.follow_up_uses u where u.follow_up_id = f2.id and u.status = 'used'),
          'pending_extension', exists (select 1 from clinic_reception.follow_up_extensions x where x.follow_up_id = f2.id and x.status = 'pending'),
          'has_service', clinic_reception.follow_up_service(p_workspace, f2.provider_id) is not null) order by v.opened_at desc)
        from clinic_reception.visit_follow_ups f2 join clinic_reception.visits v on v.id = f2.origin_visit_id
        join clinic_reception.services s on s.id = f2.service_id join clinic_reception.providers pr on pr.id = f2.provider_id
        where f2.workspace_id = p_workspace and f2.patient_id = pat), '[]'),
      'visits', coalesce((select jsonb_agg(x order by x->>'done_on' desc) from (
          select distinct on (v.id) jsonb_build_object('visit_id', v.id, 'visit_no', v.visit_no, 'service', s.name, 'provider_id', o.provider_id, 'provider', pr.name,
                 'done_on', (v.opened_at at time zone 'Africa/Cairo')::date, 'has_service', clinic_reception.follow_up_service(p_workspace, o.provider_id) is not null) x
            from clinic_reception.visits v join clinic_reception.orders o on o.visit_id = v.id and o.status = 'completed' and not (o.snapshot ? 'follow_up')
            join clinic_reception.services s on s.id = o.service_id join clinic_reception.providers pr on pr.id = o.provider_id
           where v.workspace_id = p_workspace and v.patient_id = pat and v.opened_at > now() - interval '120 days'
             and not exists (select 1 from clinic_reception.visit_follow_ups f3 where f3.origin_order_id = o.id)
           order by v.id, o.created_at) q), '[]'),
      'packages', coalesce((select jsonb_agg(jsonb_build_object('id', pk.id, 'expires_on', pk.expires_on, 'visits', pk.visits,
          'left', (select count(distinct en.visit_no) from clinic_reception.entitlements en where en.package_id = pk.id and en.used < en.quantity)))
        from clinic_reception.packages pk where pk.workspace_id = p_workspace and pk.patient_id = pat and pk.status = 'active'), '[]'));
  end if;

  if p_action = 'book' then
    if nullif(p->>'follow_up_id', '') is not null then
      select * into f from clinic_reception.visit_follow_ups where id = (p->>'follow_up_id')::uuid and workspace_id = p_workspace;
      if not found then raise exception 'المتابعة مش موجودة'; end if;
      prov := f.provider_id; pat := f.patient_id; select * into ov from clinic_reception.visits where id = f.origin_visit_id;
    else
      select * into ov from clinic_reception.visits where id = nullif(p->>'visit_id', '')::uuid and workspace_id = p_workspace;
      if not found then raise exception 'اختار الزيارة اللي المتابعة عليها'; end if;
      select o.provider_id into prov from clinic_reception.orders o where o.visit_id = ov.id and o.status = 'completed' order by o.created_at limit 1;
      if prov is null then raise exception 'الزيارة دي مفيهاش خدمة اتنفذت'; end if;
      pat := ov.patient_id;
    end if;
    -- «والمتابعة لازم تبقى مع نفس الطبيب»
    if nullif(p->>'provider_id', '') is not null and (p->>'provider_id')::uuid <> prov then raise exception 'المتابعة لازم تبقى مع نفس طبيب الزيارة'; end if;
    svc := clinic_reception.follow_up_service(p_workspace, prov);
    if svc is null then raise exception 'مفيش خدمة «متابعة» للطبيب ده — الحسابات تضيف خدمة متابعة لقسمه'; end if;
    d := ((p->>'starts_at')::timestamptz at time zone 'Africa/Cairo')::date;
    cov := case when f.id is not null and clinic_reception.follow_up_valid_until(f) >= d and clinic_reception.follow_up_left(f.id) > 0 then 'included' else 'fee' end;
    r := public.clinic_reception_command(p_workspace, 'book', jsonb_build_object('patient_id', pat, 'provider_id', prov, 'service_id', svc,
           'starts_at', p->>'starts_at', 'payer_kind', 'cash') || case when p ? 'ends_at' then jsonb_build_object('ends_at', p->>'ends_at') else '{}'::jsonb end,
           nullif(p->>'token', '')::uuid);
    ap := (r->>'id')::uuid;
    if ap is null then raise exception 'تعذر الحجز'; end if;
    update clinic_reception.appointments set follow_up_id = f.id, follow_of_visit_id = ov.id, follow_up_coverage = cov where id = ap and follow_up_coverage is null;
    select follow_up_coverage into cov from clinic_reception.appointments where id = ap;
    if cov = 'included' then insert into clinic_reception.follow_up_uses(appointment_id, follow_up_id) values (ap, f.id) on conflict (appointment_id) do nothing; end if;
    return r || jsonb_build_object('coverage', cov, 'fee', case when cov = 'fee' then coalesce((select follow_up_fee from clinic_reception.settings where id), 100) else 0 end,
      'visit_no', ov.visit_no, 'left', case when f.id is not null then clinic_reception.follow_up_left(f.id) end);
  end if;

  if p_action = 'board' then
    d := coalesce(nullif(p->>'day', '')::date, clinic_reception.today());
    return coalesce((select jsonb_object_agg(a.id, jsonb_build_object('coverage', a.follow_up_coverage, 'visit_no', v.visit_no,
        'left', case when a.follow_up_id is not null then clinic_reception.follow_up_left(a.follow_up_id) end,
        'included', (select f2.included from clinic_reception.visit_follow_ups f2 where f2.id = a.follow_up_id),
        'fee', coalesce((select follow_up_fee from clinic_reception.settings where id), 100)))
      from clinic_reception.appointments a left join clinic_reception.visits v on v.id = a.follow_of_visit_id
      where a.workspace_id = p_workspace and a.follow_up_coverage is not null and (a.starts_at at time zone 'Africa/Cairo')::date = d), '{}');
  end if;

  if p_action = 'rules_get' then
    return jsonb_build_object('can_manage', clinic_reception.follow_up_can_manage(), 'fee', coalesce((select follow_up_fee from clinic_reception.settings where id), 100),
      'services', coalesce((select jsonb_agg(jsonb_build_object('service_id', s.id, 'code', s.code, 'name', s.name, 'department', s.department, 'price', s.price,
          'included_count', r2.included_count, 'valid_days', r2.valid_days, 'active', r2.active, 'note', r2.note) order by s.department, s.name)
        from clinic_reception.services s left join clinic_reception.follow_up_rules r2 on r2.service_id = s.id
        where s.workspace_id = p_workspace and s.active and coalesce(clinic_reception.consult_kind(s.name), '') <> 'F'), '[]'));
  end if;

  if p_action = 'rules_set' then
    if not clinic_reception.follow_up_can_manage() then raise exception 'عدد المتابعات بيحدده الحسابات أو مدير المركز'; end if;
    if not exists (select 1 from clinic_reception.services where id = (p->>'service_id')::uuid and workspace_id = p_workspace) then raise exception 'الخدمة مش موجودة'; end if;
    insert into clinic_reception.follow_up_rules(service_id, workspace_id, included_count, valid_days, active, note, updated_by, updated_at)
    values ((p->>'service_id')::uuid, p_workspace, (p->>'included_count')::int, (p->>'valid_days')::int, coalesce((p->>'active')::boolean, true), nullif(btrim(coalesce(p->>'note', '')), ''), me, now())
    on conflict (service_id) do update set included_count = excluded.included_count, valid_days = excluded.valid_days, active = excluded.active, note = excluded.note,
      updated_by = me, updated_at = now();
    insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail) values (p_workspace, me, 'follow_up_rule', (p->>'service_id')::uuid, p);
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'extend_request' then
    select * into f from clinic_reception.visit_follow_ups where id = (p->>'follow_up_id')::uuid and workspace_id = p_workspace;
    if not found then raise exception 'المتابعة مش موجودة'; end if;
    if coalesce((p->>'days')::int, 0) not between 1 and 3 then raise exception 'المدّ يوم أو يومين بحد أقصى 3 أيام'; end if;
    if length(btrim(coalesce(p->>'reason', ''))) < 5 then raise exception 'اكتب سبب المدّ'; end if;
    if f.extended_until is not null then raise exception 'الصلاحية اتمدّت قبل كده'; end if;
    insert into clinic_reception.follow_up_extensions(follow_up_id, days, reason, requested_by) values (f.id, (p->>'days')::int, btrim(p->>'reason'), me) returning * into e;
    return to_jsonb(e);
  end if;

  if p_action = 'extensions' then
    return jsonb_build_object('can_review', clinic_reception.follow_up_can_manage(), 'items', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'days', x.days, 'reason', x.reason,
        'requested_by', to_jsonb(a)->>'name', 'mine', x.requested_by = me, 'requested_at', x.requested_at, 'patient', pt.name, 'file_no', pt.file_no, 'visit_no', v.visit_no,
        'provider', pr.name, 'expires_on', f2.expires_on) order by x.requested_at)
      from clinic_reception.follow_up_extensions x join clinic_reception.visit_follow_ups f2 on f2.id = x.follow_up_id
      join clinic_reception.patients pt on pt.id = f2.patient_id join clinic_reception.visits v on v.id = f2.origin_visit_id
      join clinic_reception.providers pr on pr.id = f2.provider_id join public.admins a on a.id = x.requested_by
      where f2.workspace_id = p_workspace and x.status = 'pending'), '[]'));
  end if;

  if p_action = 'extend_review' then
    select * into e from clinic_reception.follow_up_extensions where id = (p->>'id')::uuid and status = 'pending' for update;
    if not found then raise exception 'الطلب مش موجود أو اتراجع'; end if;
    if e.requested_by = me then raise exception 'المدّ لازم يوافق عليه حد تاني غير اللي طلبه'; end if;
    if not clinic_reception.follow_up_can_manage() then raise exception 'الموافقة للحسابات أو مدير المركز'; end if;
    update clinic_reception.follow_up_extensions set status = case when (p->>'approve')::boolean then 'approved' else 'rejected' end,
      reviewed_by = me, reviewed_at = now(), review_note = nullif(btrim(coalesce(p->>'note', '')), '') where id = e.id;
    if (p->>'approve')::boolean then
      update clinic_reception.visit_follow_ups set extended_until = greatest(expires_on, clinic_reception.today() - 1) + e.days where id = e.follow_up_id;
    end if;
    return jsonb_build_object('ok', true);
  end if;

  if p_action = 'report' then
    t0 := coalesce(nullif(p->>'from', '')::date, clinic_reception.today() - 30); t1 := coalesce(nullif(p->>'to', '')::date, clinic_reception.today());
    return jsonb_build_object('from', t0, 'to', t1,
      'doctors', coalesce((select jsonb_agg(x order by x->>'provider') from (select jsonb_build_object('provider', pr.name,
          'included', count(*) filter (where a.follow_up_coverage = 'included' and a.status = 'completed'),
          'fee', count(*) filter (where a.follow_up_coverage = 'fee' and a.status = 'completed'),
          'fee_income', coalesce(sum(o.price) filter (where a.follow_up_coverage = 'fee' and o.status = 'completed'), 0),
          'no_show', count(*) filter (where a.status = 'no_show'), 'booked', count(*) filter (where a.status in ('booked', 'arrived'))) x
        from clinic_reception.appointments a join clinic_reception.providers pr on pr.id = a.provider_id
        left join clinic_reception.visits v on v.appointment_id = a.id left join clinic_reception.orders o on o.visit_id = v.id and o.snapshot ? 'follow_up'
        where a.workspace_id = p_workspace and a.follow_up_coverage is not null and (a.starts_at at time zone 'Africa/Cairo')::date between t0 and t1
        group by pr.name) q), '[]'),
      'remaining', coalesce((select jsonb_agg(jsonb_build_object('file_no', pt.file_no, 'patient', pt.name, 'visit_no', v.visit_no, 'service', s.name, 'provider', pr.name,
          'left', clinic_reception.follow_up_left(f2.id), 'included', f2.included, 'valid_until', clinic_reception.follow_up_valid_until(f2)) order by clinic_reception.follow_up_valid_until(f2))
        from clinic_reception.visit_follow_ups f2 join clinic_reception.patients pt on pt.id = f2.patient_id join clinic_reception.visits v on v.id = f2.origin_visit_id
        join clinic_reception.services s on s.id = f2.service_id join clinic_reception.providers pr on pr.id = f2.provider_id
        where f2.workspace_id = p_workspace and clinic_reception.follow_up_left(f2.id) > 0 and clinic_reception.follow_up_valid_until(f2) >= clinic_reception.today()), '[]'));
  end if;
  raise exception 'إجراء غير معروف';
end $$;
revoke all on function public.clinic_reception_follow_up(uuid, text, jsonb) from public, anon;
grant execute on function public.clinic_reception_follow_up(uuid, text, jsonb) to authenticated;
revoke all on function clinic_reception.follow_up_left(uuid, uuid), clinic_reception.follow_up_can_manage(), clinic_reception.follow_up_service(uuid, uuid),
  clinic_reception.follow_up_valid_until(clinic_reception.visit_follow_ups) from public, anon, authenticated;
commit;
