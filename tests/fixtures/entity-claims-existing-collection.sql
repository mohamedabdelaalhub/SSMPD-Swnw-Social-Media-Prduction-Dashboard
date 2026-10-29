-- Existing production collection wrapper, captured before this feature.
CREATE OR REPLACE FUNCTION public.clinic_finance_collect_linked(p_invoice uuid, p_shift uuid, p_method text, p_amount numeric, p_reference text, p_token uuid, p_patient_file text, p_visit text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare me uuid:=clinic_finance.require_access('create');i clinic_finance.invoices%rowtype;p clinic_finance.payments%rowtype;v uuid;
 file_ref text:=trim(coalesce(p_patient_file,''));visit text:=trim(coalesce(p_visit,''));
begin
 perform clinic_finance.lock_day();
 if length(file_ref) not between 1 and 120 or length(visit) not between 1 and 120 then raise exception 'أدخل رقم ملف المريض ورقم الزيارة';end if;
 select * into i from clinic_finance.invoices where id=p_invoice for update;
 if not found or (i.created_by<>me and not clinic_finance.allowed('review')) then raise exception 'الفاتورة خارج نطاقك';end if;
 if nullif(trim(i.patient_ref),'') is not null and trim(i.patient_ref)<>file_ref then raise exception 'رقم الملف لا يطابق الفاتورة المختارة';end if;
 if i.visit_ref is not null and i.visit_ref<>visit then raise exception 'رقم الزيارة لا يطابق الفاتورة المختارة';end if;
 select * into p from clinic_finance.payments where created_by=me and token=p_token;
 if found and (p.patient_file_ref is distinct from file_ref or p.visit_ref is distinct from visit) then raise exception 'مفتاح طلب مختلف لبيانات المريض';end if;
 v:=public.clinic_finance_collect(p_invoice,p_shift,p_method,p_amount,p_reference,p_token);
 update clinic_finance.invoices set patient_ref=file_ref,visit_ref=visit where id=p_invoice;
 update clinic_finance.payments set patient_file_ref=file_ref,visit_ref=visit where id=v;
 if not found then raise exception 'لم يحفظ سند التحصيل';end if;
 return v;
end $function$
;

