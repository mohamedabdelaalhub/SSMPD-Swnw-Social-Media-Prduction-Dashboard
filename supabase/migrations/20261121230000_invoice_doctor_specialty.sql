-- Owner 2026-11-21 «عايز في الفواتير بيانات الطبيب: الاسم / التخصص تبقى موجودة»: each line of the patient invoice
-- (clinic_reception_invoice_print) also returns the doctor's specialty = the provider's department (lines already carry
-- the doctor name and the service department). In-place patch on exact anchors (each must occur once); old body saved.
-- Rollback: supabase/rollbacks/20261121230000_invoice_doctor_specialty.rollback.sql
begin;
create table clinic_reception.invoice_doctor_saved_defs(name text primary key, def text not null);
do $$
declare d text; n text := 'public.clinic_reception_invoice_print(uuid,uuid)';
  a1 text := $a$pr.name doctor, o.snapshot->>'department' department$a$;
  a2 text := $a$'department', x.department,$a$;
begin
  if to_regprocedure(n) is null then raise exception 'دالة طباعة الفاتورة مش موجودة'; end if;
  d := pg_get_functiondef(n::regprocedure);
  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 or (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 then
    raise exception 'نقطة الربط في دالة طباعة الفاتورة مش موجودة مرة واحدة';
  end if;
  insert into clinic_reception.invoice_doctor_saved_defs values (n, d);
  d := replace(d, a1, a1 || ', pr.department specialty');
  d := replace(d, a2, a2 || $b$ 'specialty', x.specialty,$b$);
  execute d;
end $$;
commit;
