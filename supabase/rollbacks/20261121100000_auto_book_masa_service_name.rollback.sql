begin;
do $$ begin execute (select def from clinic_reception.masa_service_saved_defs where name = 'auto_book_one'); end $$;
drop function if exists clinic_reception.auto_book_service_for(uuid, uuid, text);
drop function if exists clinic_reception.service_name_key(text);
drop table clinic_reception.masa_service_saved_defs;
commit;
