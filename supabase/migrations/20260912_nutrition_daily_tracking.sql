-- Daily nutrition tracking. Existing visit-level confirmations remain untouched.
begin;
create table if not exists public.patient_nutrition_daily_completions (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references public.patient_nutrition_visits(id) on delete cascade,
  meal_id text not null,
  tracking_date date not null,
  meal_name_snapshot text not null default '',
  completed boolean not null default false,
  completed_at timestamptz,
  recorded_by_admin_id uuid references public.admins(id),
  recorded_by_account_id uuid references public.patient_accounts(id),
  updated_at timestamptz not null default now(),
  unique(visit_id, meal_id, tracking_date)
);
alter table public.patient_nutrition_daily_completions enable row level security;
drop policy if exists "nutrition daily read" on public.patient_nutrition_daily_completions;
create policy "nutrition daily read" on public.patient_nutrition_daily_completions
for select to authenticated using (exists (
  select 1 from public.patient_nutrition_visits v where v.id = visit_id and (
    public.has_archive_access() or public.has_archive_review_access() or public.can_access_leads()
    or public.is_assigned_doctor_for_patient(v.patient_id)
  )
));
drop policy if exists "nutrition daily insert" on public.patient_nutrition_daily_completions;
create policy "nutrition daily insert" on public.patient_nutrition_daily_completions
for insert to authenticated with check (public.has_archive_access() or public.can_manage_all_content());
drop policy if exists "nutrition daily update" on public.patient_nutrition_daily_completions;
create policy "nutrition daily update" on public.patient_nutrition_daily_completions
for update to authenticated using (public.has_archive_access() or public.can_manage_all_content())
with check (public.has_archive_access() or public.can_manage_all_content());

create or replace function public.guard_nutrition_daily_completion()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.patient_nutrition_visits; meal jsonb; matches int;
begin
  if TG_OP = 'UPDATE' and (new.visit_id, new.meal_id, new.tracking_date) is distinct from
    (old.visit_id, old.meal_id, old.tracking_date) then
    raise exception 'IMMUTABLE_COMPLETION_KEY';
  end if;
  select * into v from public.patient_nutrition_visits where id = new.visit_id for share;
  if not found then raise exception 'VISIT_NOT_FOUND'; end if;
  if new.tracking_date < v.visit_date or new.tracking_date > (now() at time zone 'Africa/Cairo')::date then
    raise exception 'INVALID_TRACKING_DATE';
  end if;
  select count(*) into matches from jsonb_array_elements(v.meals) m where m->>'id' = new.meal_id;
  if matches <> 1 then raise exception 'MEAL_NOT_FOUND'; end if;
  select m into meal from jsonb_array_elements(v.meals) m where m->>'id' = new.meal_id;
  new.meal_name_snapshot := coalesce(meal->>'name', '');
  if auth.role() = 'service_role' then
    if new.recorded_by_account_id is null or not exists (
      select 1 from public.patient_accounts a join public.patient_account_access x on x.account_id = a.id
      where a.id = new.recorded_by_account_id and a.status = 'active' and a.activation_completed_at is not null
      and x.patient_id = v.patient_id and x.verification_status = 'approved' and x.revoked_at is null
      and (x.expires_at is null or x.expires_at > now())
    ) then raise exception 'NO_APPROVED_MEDICAL_ACCESS'; end if;
    new.recorded_by_admin_id := null;
  else
    if not (public.has_archive_access() or public.can_manage_all_content()) then raise exception 'FORBIDDEN'; end if;
    new.recorded_by_admin_id := public.my_admin_id();
    new.recorded_by_account_id := null;
  end if;
  new.updated_at := now();
  new.completed_at := case when new.completed then now() else null end;
  if TG_OP = 'UPDATE' and new.completed = old.completed then
    new.completed_at := old.completed_at;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_nutrition_daily_completion() from public;
drop trigger if exists guard_nutrition_daily on public.patient_nutrition_daily_completions;
create trigger guard_nutrition_daily before insert or update on public.patient_nutrition_daily_completions
for each row execute function public.guard_nutrition_daily_completion();

create or replace function public.audit_nutrition_daily_completion()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.patient_portal_audit_log(account_id, patient_id, actor_admin_id, action, entity_type, entity_id, metadata)
  select new.recorded_by_account_id, v.patient_id, new.recorded_by_admin_id,
    'nutrition_daily_completion_set', 'patient_nutrition_daily_completions', new.id,
    jsonb_build_object('visit_id', new.visit_id, 'meal_id', new.meal_id, 'tracking_date', new.tracking_date, 'completed', new.completed)
  from public.patient_nutrition_visits v where v.id = new.visit_id;
  return new;
end;
$$;
revoke all on function public.audit_nutrition_daily_completion() from public;
drop trigger if exists audit_nutrition_daily on public.patient_nutrition_daily_completions;
create trigger audit_nutrition_daily after insert or update on public.patient_nutrition_daily_completions
for each row execute function public.audit_nutrition_daily_completion();
commit;
