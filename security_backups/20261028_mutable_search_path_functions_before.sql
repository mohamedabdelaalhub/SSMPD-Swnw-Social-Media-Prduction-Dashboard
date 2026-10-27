-- Schema-only backup before fixing mutable search_path warnings.
-- Captured from pg_get_functiondef and pg_proc.proconfig for project uuijfbpgvtdxgaosqpxo.

-- proconfig was NULL for all four functions before the change.

CREATE OR REPLACE FUNCTION public.ads_period_ar(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case p when 'day' then 'يومي' when 'week' then 'أسبوعي' when 'month' then 'شهري' else 'إجمالي للفترة' end;
$function$;

CREATE OR REPLACE FUNCTION public.effective_admin_id()
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE
AS $function$
declare
  v_setting text;
begin
  v_setting := nullif(current_setting('app.caller_admin_id', true), '');
  if v_setting is not null then
    return v_setting::uuid;
  end if;
  return public.my_admin_id();
end;
$function$;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  -- أرشفة الوسائط (content_archive_commit) بتبدّل الروابط من غير ما تعتبرها "نشاط" على المادة
  if coalesce(current_setting('ssmpd.media_archive', true), '') = '1' then return new; end if;
  new.updated_at = now(); return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.track_stage_history()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  if tg_op = 'INSERT' then
    new.stage_history = jsonb_build_array(jsonb_build_object('stage', new.stage, 'at', now()));
  elsif new.stage is distinct from old.stage then
    new.stage_history = coalesce(old.stage_history, '[]'::jsonb) || jsonb_build_object('stage', new.stage, 'at', now());
  end if;
  return new;
end
$function$;
