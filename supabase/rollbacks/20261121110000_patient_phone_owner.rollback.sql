begin;
do $$ begin execute (select def from clinic_reception.phone_owner_saved_defs where name = 'clinic_reception_auto_book'); end $$;
drop table clinic_reception.phone_owner_saved_defs;
drop function if exists public.patient_phone_peers(text, uuid);
drop function if exists clinic_reception.require_phone_owner(text, text, uuid);
-- columns kept (data); drop them only if no file has a value:
-- alter table public.patients drop column phone_owner, drop column phone_owner_note;
commit;
