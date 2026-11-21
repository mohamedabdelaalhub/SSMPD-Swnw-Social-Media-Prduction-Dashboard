-- Owner 2026-11-21: «الكشف المنزلي بس يبقى متاح لكل الأطباء» (with الكشف / الاستشارة / المتابعة, already basic since
-- 20261117130000). A home doctor visit is now a basic service too, whatever its name: «كشف منزلي» (already covered by the
-- «كشف…» prefix) and names like «زيارة منزلية» / «استشارة في المنزل». Home NURSING, lab draws and imaging done at home
-- stay with their own department (not opened to every doctor).
-- Only clinic_reception.is_basic_service changes (same signature; used by the booking/execution scope check, the booking
-- readiness report and basic_service_ids in the reception data). Rollback restores the previous body.
begin;
create or replace function clinic_reception.is_basic_service(p_department text, p_name text) returns boolean
language sql immutable set search_path = pg_catalog as $$
 select coalesce(p_department, '') = 'خدمات الكشف'
     or clinic_reception.norm_ar(p_name) ~ '^(ال)?(كشف|استشاره|متابعه)'
     or (clinic_reception.norm_ar(p_name) ~ 'منزل'
         and clinic_reception.norm_ar(p_name) ~ '(كشف|زياره|استشاره|متابعه)'
         and clinic_reception.norm_ar(p_name) !~ '(تمريض|ممرض|تحليل|تحاليل|سحب|عينه|اشعه|سونار|رسم|جلسه|علاج طبيعي)')
$$;
commit;
