-- Rollback (drops only what service-orders-reports.sql created). Bucket removed only if empty.
begin;
drop policy if exists so_reports_insert on storage.objects;
drop policy if exists so_reports_staff_read on storage.objects;
drop policy if exists so_reports_patient_read on storage.objects;
drop function if exists public.patient_portal_service_reports();
drop function if exists public.clinic_reception_so_reports(uuid,uuid);
drop function if exists public.clinic_reception_so_register_report(uuid,uuid,text,text,text,bigint,text);
drop function if exists public.clinic_reception_so_patient_can_read(text);
drop function if exists public.clinic_reception_so_can_read_staff(text);
drop function if exists public.clinic_reception_so_can_upload(text);
drop function if exists public.clinic_reception_so_path_ok(text);
drop table if exists clinic_reception.order_reports;
delete from storage.buckets where id='service-reports' and not exists(select 1 from storage.objects where bucket_id='service-reports');
commit;
