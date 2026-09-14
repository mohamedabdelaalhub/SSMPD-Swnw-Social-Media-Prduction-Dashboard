-- متابعة الزيارات وصلاحية حذف زيارات التغذية
-- شغّله مرة واحدة في Supabase SQL Editor.

alter table public.admins
  add column if not exists can_delete_nutrition_visits boolean not null default false;

create or replace function public.can_delete_nutrition_visits()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.admins
    where user_id = auth.uid()
      and active
      and (role = 'super_admin' or can_delete_nutrition_visits)
  );
$$;
revoke all on function public.can_delete_nutrition_visits() from public;
grant execute on function public.can_delete_nutrition_visits() to authenticated;

drop policy if exists "nutrition visits delete" on public.patient_nutrition_visits;
create policy "nutrition visits delete" on public.patient_nutrition_visits
  for delete using (public.can_delete_nutrition_visits());

alter table public.patient_visits
  add column if not exists follow_up_status text not null default 'pending',
  add column if not exists follow_up_status_at timestamptz,
  add column if not exists follow_up_status_by uuid references public.admins(id);

alter table public.patient_visits
  drop constraint if exists patient_visits_follow_up_status_check;
alter table public.patient_visits
  add constraint patient_visits_follow_up_status_check
  check (follow_up_status in ('pending','attended','no_show'));

create or replace function public.set_patient_visit_follow_up_status_meta()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.follow_up_status := coalesce(new.follow_up_status, 'pending');
  elsif new.follow_up_status is distinct from old.follow_up_status then
    new.follow_up_status_at := now();
    new.follow_up_status_by := public.my_admin_id();
  elsif new.follow_up_date is distinct from old.follow_up_date then
    new.follow_up_status := 'pending';
    new.follow_up_status_at := null;
    new.follow_up_status_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists patient_visits_follow_up_status_meta on public.patient_visits;
create trigger patient_visits_follow_up_status_meta
before insert or update on public.patient_visits
for each row execute function public.set_patient_visit_follow_up_status_meta();
