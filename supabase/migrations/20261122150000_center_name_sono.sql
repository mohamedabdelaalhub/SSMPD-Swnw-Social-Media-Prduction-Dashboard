-- Center name in Arabic (owner 2026-11-22: «مركز عيادات سونو التخصصية في كله»; contracts stay as they are). The booking
-- confirmation / reminder text has said «Swnw للعيادات التخصصية» since 20261121150000; it now says
-- «مركز عيادات سونو التخصصية». The contact line (0236230005 — موبايل وواتساب: 01010686264) is unchanged.
-- * Every function in schemas public / clinic_finance / clinic_reception whose body contains «Swnw للعيادات التخصصية»
--   is re-created with that text replaced (in-place text patch; old bodies saved for rollback; raises if none found).
-- * Prepared messages not sent yet (booking_messages.status = 'ready') get the same replacement. Sent messages are history.
-- Nothing is sent by this change.
-- Rollback: supabase/rollbacks/20261122150000_center_name_sono.rollback.sql
begin;

create table if not exists clinic_finance.center_name_saved_defs(sig text primary key, def text not null);
revoke all on clinic_finance.center_name_saved_defs from public, anon, authenticated;

do $$
declare r record; d text; n int := 0;
begin
  for r in select p.oid, n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where p.prokind = 'f' and n.nspname in ('public', 'clinic_finance', 'clinic_reception')
              and position('Swnw للعيادات التخصصية' in p.prosrc) > 0 loop
    d := pg_get_functiondef(r.oid);
    insert into clinic_finance.center_name_saved_defs values (r.sig, d) on conflict (sig) do update set def = excluded.def;
    execute replace(d, 'Swnw للعيادات التخصصية', 'مركز عيادات سونو التخصصية');
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'no function carries «Swnw للعيادات التخصصية» — check the live definitions'; end if;
  raise notice 'center name: % function(s) updated', n;
end $$;

update clinic_finance.booking_messages
   set body = replace(body, 'Swnw للعيادات التخصصية', 'مركز عيادات سونو التخصصية')
 where status = 'ready' and body like '%Swnw للعيادات التخصصية%';

commit;
