-- Booking confirmation / reminder text (agent chat handoff 16, via main chat 4, 2026-11-21): the prepared WhatsApp text said
-- «عيادات سونو التخصصية» and «للاستفسار: 01010686264». The center name is «Swnw للعيادات التخصصية» and the inquiries
-- number is 0236230005.
-- * Every function in schemas public / clinic_finance / clinic_reception whose body contains the old name or the old number
--   is re-created with both replaced (in-place text patch; old bodies saved for rollback; raises if none found).
-- * Prepared messages not sent yet (booking_messages.status = 'ready') get the same replacement, so staff never copy the old
--   text. Messages already marked sent are history and stay as they were.
-- Nothing is sent by this change (opening wa.me is not sending).
-- Rollback: supabase/rollbacks/20261121150000_booking_messages_center_text.rollback.sql
begin;

create table if not exists clinic_finance.center_text_saved_defs(sig text primary key, def text not null);
revoke all on clinic_finance.center_text_saved_defs from public, anon, authenticated;

do $$
declare r record; d text; n int := 0;
begin
  for r in select p.oid, n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where p.prokind = 'f' and n.nspname in ('public', 'clinic_finance', 'clinic_reception')
              and (position('عيادات سونو التخصصية' in p.prosrc) > 0 or position('01010686264' in p.prosrc) > 0) loop
    d := pg_get_functiondef(r.oid);
    insert into clinic_finance.center_text_saved_defs values (r.sig, d) on conflict (sig) do update set def = excluded.def;
    execute replace(replace(d, 'عيادات سونو التخصصية', 'Swnw للعيادات التخصصية'), '01010686264', '0236230005');
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'no function carries the old booking text — check the live definitions'; end if;
  raise notice 'booking text: % function(s) updated', n;
end $$;

update clinic_finance.booking_messages
   set body = replace(replace(body, 'عيادات سونو التخصصية', 'Swnw للعيادات التخصصية'), '01010686264', '0236230005')
 where status = 'ready' and (body like '%عيادات سونو التخصصية%' or body like '%01010686264%');

commit;
