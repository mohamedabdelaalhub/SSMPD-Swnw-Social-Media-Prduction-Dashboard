-- Booking confirmation / reminder contact line (owner 2026-11-22, via main chat 4): the landline is 0236230005 and the
-- mobile, used for calls and WhatsApp, is 01010686264. Since 20261121150000 the prepared text ends with
-- «للاستفسار: 0236230005» only; it now reads «للاستفسار: 0236230005 — موبايل وواتساب: 01010686264».
-- * Every function in schemas public / clinic_finance / clinic_reception whose body contains «للاستفسار: 0236230005»
--   (and not the new line yet) is re-created with the line replaced (in-place text patch; old bodies saved for rollback;
--   raises if none found).
-- * Prepared messages not sent yet (booking_messages.status = 'ready') get the same replacement. Messages already marked
--   sent are history and stay as they were.
-- Nothing is sent by this change (opening wa.me is not sending).
-- Rollback: supabase/rollbacks/20261122070000_booking_messages_contact_numbers.rollback.sql
begin;

create table if not exists clinic_finance.contact_text_saved_defs(sig text primary key, def text not null);
revoke all on clinic_finance.contact_text_saved_defs from public, anon, authenticated;

do $$
declare r record; d text; n int := 0;
begin
  for r in select p.oid, n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' sig
             from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where p.prokind = 'f' and n.nspname in ('public', 'clinic_finance', 'clinic_reception')
              and position('للاستفسار: 0236230005' in p.prosrc) > 0
              and position('موبايل وواتساب: 01010686264' in p.prosrc) = 0 loop
    d := pg_get_functiondef(r.oid);
    insert into clinic_finance.contact_text_saved_defs values (r.sig, d) on conflict (sig) do update set def = excluded.def;
    execute replace(d, 'للاستفسار: 0236230005', 'للاستفسار: 0236230005 — موبايل وواتساب: 01010686264');
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'no function carries «للاستفسار: 0236230005» — check the live definitions'; end if;
  raise notice 'booking contact line: % function(s) updated', n;
end $$;

update clinic_finance.booking_messages
   set body = replace(body, 'للاستفسار: 0236230005', 'للاستفسار: 0236230005 — موبايل وواتساب: 01010686264')
 where status = 'ready' and body like '%للاستفسار: 0236230005%' and body not like '%موبايل وواتساب: 01010686264%';

commit;
