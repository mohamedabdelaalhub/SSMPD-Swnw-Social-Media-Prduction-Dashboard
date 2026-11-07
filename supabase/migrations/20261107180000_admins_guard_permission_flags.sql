-- Close the "claim own invite" self-escalation gap on public.admins.
-- Before: guard_admin_changes() blocked only role/active for non-super users, so an invited
-- employee claiming their row (policy "claim own invite") could also switch on any has_* / can_*
-- permission flag in the same UPDATE.
-- After: a non-super UPDATE may not change role, active, is_system_identity, any column whose
-- name starts with has_ or can_ (covers future flags automatically), and may not re-bind an
-- already-linked user_id. The legitimate claim (user_id null -> uid) and service-role binding
-- in hr-staff-account (user_id only) keep working. Super admin is unchanged.
-- Same function name/trigger; idempotent. Rollback: supabase/rollbacks/20261107180000_admins_guard_permission_flags.rollback.sql
create or replace function public.guard_admin_changes()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  o jsonb;
  n jsonb;
  k text;
begin
  if public.is_super() then return new; end if;
  if new.role is distinct from old.role or new.active is distinct from old.active then
    raise exception 'غير مسموح بتغيير الدور أو الحالة';
  end if;
  if old.user_id is not null and new.user_id is distinct from old.user_id then
    raise exception 'غير مسموح بتغيير ربط الحساب';
  end if;
  o := to_jsonb(old);
  n := to_jsonb(new);
  for k in select jsonb_object_keys(n) loop
    if (k like 'has\_%' or k like 'can\_%' or k = 'is_system_identity')
       and (n -> k) is distinct from (o -> k) then
      raise exception 'غير مسموح بتغيير الصلاحيات (%)', k;
    end if;
  end loop;
  return new;
end $$;

revoke all on function public.guard_admin_changes() from public, anon, authenticated;

drop trigger if exists admins_guard on public.admins;
create trigger admins_guard before update on public.admins
  for each row execute function public.guard_admin_changes();
