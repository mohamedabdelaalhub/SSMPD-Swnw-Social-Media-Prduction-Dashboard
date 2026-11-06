begin;
drop function if exists public.clinic_reception_so_setup_load(uuid);
drop function if exists public.clinic_reception_so_setup_save(uuid,text,jsonb);
commit;
