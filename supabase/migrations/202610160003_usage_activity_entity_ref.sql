-- إشعارات "آخر الأنشطة": ربط الحدث بالعنصر (ليد/مريض/مادة) عشان الضغط عليه يفتحه في مكانه. مُطبَّق على الحية.
alter table public.usage_activity_log add column if not exists entity_type text check (entity_type in ('content','lead','patient'));
alter table public.usage_activity_log add column if not exists entity_id uuid;
