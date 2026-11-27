-- «جرد الوردية: تأكيد العد + تنبيه لو مش مطابق» (owner 2026-11-25 «طبق تصور الجرد» + «عايزه يبقى أوبشن أقدر أوقفه»).
-- The count stays BLIND: the cashier never sees the expected cash, a difference, or «زيادة / عجز». Before handing over, the screen
-- asks the server only «is this count equal to the recorded collection?» and, when it is not, tells him «عدّ تاني».
--   public.clinic_finance_count_check(action, payload):
--     'check'    — the shift's own cashier (or a reviewer closing it), an OPEN collection shift, valid denominations → logs the attempt
--                  and answers {enabled, match} (match only — no amounts). At most 3 checks per shift (stops probing for the
--                  expected amount by trial); after that {limit:true} and the cashier just hands over.
--     'settings' — {enabled, can_change}; 'set' — super admin / financial manager turn the alert on or off (audited).
--     'attempts' — reviewers: the logged attempts of the given cash cases' shifts (counted, matched, when, by).
-- Unchanged: end_shift / close_shift and the cash case they open; nothing is posted; no automatic salary deduction.
-- Rollback: supabase/rollbacks/20261125110000_shift_count_check.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.clinic_finance_count_check(text,jsonb)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if to_regprocedure('clinic_finance.shift_cash(uuid)') is null or to_regclass('clinic_finance.cash_cases') is null then raise exception 'مكونات الخزينة غير موجودة'; end if;
end $$;

create table clinic_finance.count_check_settings(id boolean primary key default true check (id), enabled boolean not null default true,
  updated_by uuid references public.admins(id), updated_at timestamptz);
insert into clinic_finance.count_check_settings(id, enabled) values (true, true);
create table clinic_finance.count_attempts(id uuid primary key default gen_random_uuid(), shift_id uuid not null references clinic_finance.shifts(id),
  counted numeric(14,2) not null, counts jsonb not null, matched boolean, created_by uuid not null references public.admins(id),
  created_at timestamptz not null default now());
create index count_attempts_shift on clinic_finance.count_attempts(shift_id, created_at);
revoke all on clinic_finance.count_check_settings, clinic_finance.count_attempts from public, anon, authenticated;

create function public.clinic_finance_count_check(p_action text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); s clinic_finance.shifts%rowtype; st clinic_finance.count_check_settings%rowtype; j record;
  total numeric := 0; n int; ok boolean; can_change boolean; v boolean;
begin
  if me is null then raise exception 'سجّل الدخول الأول'; end if;
  select * into st from clinic_finance.count_check_settings where id;
  can_change := public.has_role('super_admin') or public.has_role('financial_manager');
  if p_action = 'settings' then
    return jsonb_build_object('enabled', st.enabled, 'can_change', can_change, 'updated_at', st.updated_at,
      'updated_by', (select a.name from public.admins a where a.id = st.updated_by));
  elsif p_action = 'set' then
    if not can_change then raise exception 'تغيير الإعداد ده للسوبر أدمن أو المدير المالي بس' using errcode = '42501'; end if;
    if p_payload->>'enabled' not in ('true', 'false') then raise exception 'حدد تشغيل أو إيقاف'; end if;
    v := (p_payload->>'enabled')::boolean;
    update clinic_finance.count_check_settings set enabled = v, updated_by = me, updated_at = now() where id;
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'count_check_setting', null, jsonb_build_object('enabled', v));
    return jsonb_build_object('enabled', v);
  elsif p_action = 'check' then
    select * into s from clinic_finance.shifts where id = nullif(p_payload->>'shift_id', '')::uuid;
    if not found or s.status <> 'open' or s.ended_at is not null or s.is_main then raise exception 'اختر وردية تحصيل مفتوحة'; end if;
    if s.cashier_id <> me and not clinic_finance.allowed('review') then raise exception 'الجرد ده لصاحب الوردية' using errcode = '42501'; end if;
    if not st.enabled then return jsonb_build_object('enabled', false); end if;
    if jsonb_typeof(p_payload->'counts') is distinct from 'object' then raise exception 'أدخل جرد الفئات النقدية'; end if;
    for j in select key, value from jsonb_each_text(p_payload->'counts') loop
      if j.key not in ('200', '100', '50', '20', '10', '5', '1', '0.5', '0.25') or j.value is null or j.value !~ '^[0-9]{1,7}$' then raise exception 'فئات أو أعداد غير صالحة'; end if;
      total := total + j.key::numeric * j.value::numeric;
    end loop;
    select count(*) into n from clinic_finance.count_attempts where shift_id = s.id;
    if n >= 3 then return jsonb_build_object('enabled', true, 'limit', true); end if;
    ok := total = clinic_finance.shift_cash(s.id);
    insert into clinic_finance.count_attempts(shift_id, counted, counts, matched, created_by) values (s.id, total, p_payload->'counts', ok, me);
    return jsonb_build_object('enabled', true, 'match', ok, 'left', 2 - n);
  elsif p_action = 'attempts' then
    if not clinic_finance.allowed('review') then raise exception 'محاولات العد للمراجعين بس' using errcode = '42501'; end if;
    return coalesce((select jsonb_agg(jsonb_build_object('case_id', c.id, 'shift_id', c.shift_id, 'attempts',
        coalesce((select jsonb_agg(jsonb_build_object('counted', a.counted, 'matched', a.matched, 'at', a.created_at,
            'by', (select x.name from public.admins x where x.id = a.created_by)) order by a.created_at)
          from clinic_finance.count_attempts a where a.shift_id = c.shift_id), '[]'::jsonb)))
      from clinic_finance.cash_cases c
      where c.id in (select value::uuid from jsonb_array_elements_text(coalesce(p_payload->'case_ids', '[]'::jsonb)))), '[]'::jsonb);
  end if;
  raise exception 'إجراء غير معروف';
end $$;
revoke all on function public.clinic_finance_count_check(text, jsonb) from public, anon;
grant execute on function public.clinic_finance_count_check(text, jsonb) to authenticated;

commit;
