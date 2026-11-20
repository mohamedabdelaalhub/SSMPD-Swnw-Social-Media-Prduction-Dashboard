-- Rollback of 20261120290000_doctor_assistant_role.sql. Fails if any admin still has role/extra role doctor_assistant
-- (switch them back first: docs/ops/2026-11-20-doctor-assistant-ahmed.sql rollback block).
begin;
do $$
declare r record;
begin
  for r in select oid_name, def from clinic_reception.doctor_assistant_saved_defs where oid_name not like 'constraint:%' loop
    execute r.def;
  end loop;
  for r in select oid_name, def from clinic_reception.doctor_assistant_saved_defs where oid_name like 'constraint:%' loop
    execute format('alter table %s drop constraint %I', split_part(split_part(r.oid_name, ':', 2), ':', 1), split_part(r.oid_name, ':', 3));
    execute format('alter table %s add constraint %I %s', split_part(split_part(r.oid_name, ':', 2), ':', 1), split_part(r.oid_name, ':', 3), r.def);
  end loop;
end $$;
drop function if exists public.clinic_reception_my_departments(uuid);
drop table clinic_reception.doctor_assistant_saved_defs;
commit;
