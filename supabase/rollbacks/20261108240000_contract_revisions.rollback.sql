-- Rollback of 20261108240000_contract_revisions.sql. Refused once any revision has been approved (the old contracts were shortened/superseded; undo that by hand first).
begin;
do $$ begin
  if not exists (select 1 from information_schema.columns where table_schema='clinic_finance' and table_name='doctor_contracts' and column_name='supersedes') then raise exception 'التعديلات غير مطبّقة'; end if;
  if exists (select 1 from clinic_finance.doctor_contracts where supersedes is not null and status='active') or exists (select 1 from clinic_finance.doctor_contracts where status='superseded') then
    raise exception 'لا تراجع بعد اعتماد تعديلات عقود؛ أعد العقود الأصلية يدويًا أولًا';
  end if;
end $$;
delete from clinic_finance.doctor_contracts where supersedes is not null and status in ('pending','rejected');
do $mig$
declare f text; a int; b int; c int;
begin
  f := pg_get_functiondef('clinic_finance.doctor_command_before_departments(text,jsonb,uuid)'::regprocedure);
  f := replace(f, 'declare o clinic_finance.doctor_contracts%rowtype;me uuid;v_id uuid;', 'declare me uuid;v_id uuid;');
  a := position(' if approval and c.supersedes is not null then' in f);
  b := position('if approval and exists(select 1 from clinic_finance.doctor_contracts where doctor_key=c.doctor_key' in f);
  if a = 0 or b = 0 or b < a then raise exception 'نص الدالة لا يطابق ما طبّقه الملف'; end if;
  f := substr(f, 1, a - 1) || substr(f, b);
  a := position(' elsif p_action=''contract_revise'' then' in f);
  b := position('elsif p_action=''payout'' then me:=clinic_finance.require_access(''create'');' in f);
  if a = 0 or b = 0 or b < a then raise exception 'نص الدالة لا يطابق ما طبّقه الملف'; end if;
  f := substr(f, 1, a - 1) || substr(f, b);
  execute f;
end $mig$;
drop index clinic_finance.doctor_contracts_one_pending_revision;
alter table clinic_finance.doctor_contracts drop constraint doctor_contracts_status_check;
alter table clinic_finance.doctor_contracts add constraint doctor_contracts_status_check check (status = any (array['pending','active','rejected']));
alter table clinic_finance.doctor_contracts drop column superseded_valid_to;
alter table clinic_finance.doctor_contracts drop column supersedes;
commit;
