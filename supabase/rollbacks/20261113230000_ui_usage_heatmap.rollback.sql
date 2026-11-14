-- تراجع 20261113230000: يشيل دالة التسجيل وجدول العدّادات (بيانات استخدام بس، مفيش بيانات مرضى).
drop function if exists public.ui_usage_track(jsonb);
drop table if exists public.ui_usage_daily;
