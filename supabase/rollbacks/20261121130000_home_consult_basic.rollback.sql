begin;
create or replace function clinic_reception.is_basic_service(p_department text, p_name text) returns boolean
language sql immutable set search_path = pg_catalog as $$
 select coalesce(p_department,'')='خدمات الكشف'
     or clinic_reception.norm_ar(p_name) ~ '^(ال)?(كشف|استشاره|متابعه)'
$$;
commit;
