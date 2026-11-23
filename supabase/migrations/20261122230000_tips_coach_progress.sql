-- «نصايح الشغل» — role-based tips with animated slides (owner 2026-11-22, approved mockup docs/ui-references/mockups/tips-coach.html):
-- «عايز رسايل بوب أب تطلع للريسبشن من وقت للتاني بتعليمات التشغيل … ونفس الكلام مع الحسابات».
-- Per-user progress so the tips stop when learned and a manager can see adoption:
-- * public.tip_progress: one row per (admin, tip): times seen, learned / snoozed / «ما تورينيش دي تاني».
-- * tip_progress_mine() / tip_progress_mark(tip, action): the signed-in user's own rows only.
-- * tip_progress_team(): seen / learned counts per employee, for super_admin / general_manager / financial_manager.
-- No patient data. The tips' text lives in assets/js/tips-coach.js.
-- Rollback: supabase/rollbacks/20261122230000_tips_coach_progress.rollback.sql
begin;

create table if not exists public.tip_progress (
  admin_id uuid not null references public.admins(id) on delete cascade,
  tip_id text not null check (tip_id ~ '^[a-z0-9_]{2,40}$'),
  seen_count int not null default 0,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  learned_at timestamptz,
  snoozed_until timestamptz,
  never boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (admin_id, tip_id)
);
alter table public.tip_progress enable row level security;
revoke all on public.tip_progress from public, anon, authenticated;

create or replace function public.tip_progress_mine() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('tip', tip_id, 'seen', seen_count, 'last_seen_at', last_seen_at, 'learned', learned_at is not null,
           'snoozed_until', snoozed_until, 'never', never)), '[]'::jsonb)
    from public.tip_progress where admin_id = public.my_admin_id()
$$;

-- action: seen | learned | snooze (2 hours) | never | reset
create or replace function public.tip_progress_mark(p_tip text, p_action text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.my_admin_id();
begin
  if v_me is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  if coalesce(p_tip, '') !~ '^[a-z0-9_]{2,40}$' then raise exception 'bad tip' using errcode = '22023'; end if;
  if p_action not in ('seen', 'learned', 'snooze', 'never', 'reset') then raise exception 'bad action' using errcode = '22023'; end if;
  insert into public.tip_progress (admin_id, tip_id) values (v_me, p_tip) on conflict do nothing;
  update public.tip_progress set
    seen_count = seen_count + case when p_action = 'seen' then 1 else 0 end,
    first_seen_at = case when p_action = 'seen' then coalesce(first_seen_at, now()) else first_seen_at end,
    last_seen_at = case when p_action = 'seen' then now() else last_seen_at end,
    learned_at = case when p_action = 'learned' then coalesce(learned_at, now()) when p_action = 'reset' then null else learned_at end,
    snoozed_until = case when p_action = 'snooze' then now() + interval '2 hours' when p_action = 'reset' then null else snoozed_until end,
    never = case when p_action = 'never' then true when p_action = 'reset' then false else never end,
    updated_at = now()
   where admin_id = v_me and tip_id = p_tip;
  return jsonb_build_object('ok', true);
end $$;

-- Manager view: who saw / learned how many tips.
create or replace function public.tip_progress_team() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not (public.is_super() or public.has_role('general_manager') or public.has_role('financial_manager')) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('admin_id', a.id, 'name', coalesce(nullif(a.name, ''), 'موظف'), 'role', a.role,
            'seen', (select count(*) from public.tip_progress t where t.admin_id = a.id and t.seen_count > 0),
            'learned', (select count(*) from public.tip_progress t where t.admin_id = a.id and t.learned_at is not null),
            'last_seen_at', (select max(t.last_seen_at) from public.tip_progress t where t.admin_id = a.id)) order by a.name)
     from public.admins a
    where a.active and (a.role in ('reception', 'customer_service', 'accountant', 'financial_manager')
          or exists (select 1 from public.admin_extra_roles x where x.admin_id = a.id and x.role in ('reception', 'customer_service', 'accountant', 'financial_manager')))), '[]'::jsonb);
end $$;

revoke all on function public.tip_progress_mine() from public, anon;
revoke all on function public.tip_progress_mark(text, text) from public, anon;
revoke all on function public.tip_progress_team() from public, anon;
grant execute on function public.tip_progress_mine() to authenticated;
grant execute on function public.tip_progress_mark(text, text) to authenticated;
grant execute on function public.tip_progress_team() to authenticated;

commit;
