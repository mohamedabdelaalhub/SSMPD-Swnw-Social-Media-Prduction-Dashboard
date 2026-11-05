begin;
drop function if exists public.clinic_reception_so_catalog(uuid);
drop function if exists public.clinic_reception_so_attach(uuid,uuid,jsonb);
drop function if exists public.clinic_reception_so_set_status(uuid,uuid,text);
drop function if exists public.clinic_reception_so_attach_report(uuid,uuid,text);
drop function if exists public.clinic_reception_so_provider_board(uuid,uuid);
commit;
