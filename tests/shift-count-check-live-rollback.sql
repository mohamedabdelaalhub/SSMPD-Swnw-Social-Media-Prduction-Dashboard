-- Live rollback dry-run for 20261125110000_shift_count_check.sql (rule 9). ONE transaction ending with ROLLBACK.
-- As the cashier of a REAL open collection shift (or, at night, one opened inside the rolled-back transaction): a count equal to the recorded collection → match; +200 → no match; the answers
-- carry no amount. As the FM: settings can_change, turn off → the cashier gets {enabled:false}, attempts visible. As the cashier:
-- cannot change the setting, cannot read attempts. Nothing kept.
begin;
-- ===== migration body (20261125110000) =====

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

-- ===== test =====
do $$
declare fm uuid; sa uuid; cu uuid; sid uuid; rg uuid; ex numeric; r jsonb; ok boolean; i int;
begin
  select a.user_id into fm from public.admins a where a.active and a.user_id is not null and a.role = 'financial_manager' order by a.id limit 1;
  select a.user_id into sa from public.admins a where a.active and a.user_id is not null and a.role = 'super_admin' order by a.id limit 1;
  select s.id, a.user_id into sid, cu from clinic_finance.shifts s join public.admins a on a.id = s.cashier_id
   where s.status = 'open' and s.ended_at is null and not s.is_main and a.active and a.user_id is not null order by s.opened_at desc limit 1;
  if sid is null then
    -- no collection shift open right now (night): open one INSIDE this rolled-back transaction, as postgres, for a real reception
    -- cashier with a login who has no unreviewed shift (the one-shift rules still hold)
    -- every collection register is busy at night, so use a THROWAWAY register created inside this rolled-back transaction
    insert into clinic_finance.registers(name, petty_limit, created_by, treasury_kind)
    values ('تجربة جرد — تتلغي ' || left(gen_random_uuid()::text, 8), 0, (select id from public.admins where user_id = fm), 'unconfigured')
    returning id into rg;
    insert into clinic_finance.shifts(register_id, cashier_id, token, opening_book)
    select rg, a.id, gen_random_uuid(), 0 from public.admins a
     where a.active and a.user_id is not null and a.role = 'reception'
       and not exists (select 1 from clinic_finance.shifts x where x.cashier_id = a.id and x.status <> 'reviewed')
     order by a.id limit 1
    returning id into sid;
    select a.user_id into cu from clinic_finance.shifts s join public.admins a on a.id = s.cashier_id where s.id = sid;
  end if;
  if fm is null or sid is null then raise exception 'need an FM and an open (or openable) collection shift with a login'; end if;
  ex := clinic_finance.shift_cash(sid);
  perform set_config('request.jwt.claim.sub', cu::text, true); execute 'set local role authenticated';
  if ex >= 0 and ex * 4 = floor(ex * 4) then
    r := public.clinic_finance_count_check('check', jsonb_build_object('shift_id', sid, 'counts', jsonb_build_object('0.25', (ex * 4)::bigint::text)));
    if not (r->>'match')::boolean then raise exception 'equal count not matched: %', r; end if;
  end if;
  r := public.clinic_finance_count_check('check', jsonb_build_object('shift_id', sid, 'counts', jsonb_build_object('200', '1', '0.25', (greatest(ex, 0) * 4)::bigint::text)));
  if (r->>'match')::boolean then raise exception '+200 matched: %', r; end if;
  if exists (select 1 from jsonb_object_keys(r) k where k not in ('enabled', 'match', 'left', 'limit')) then raise exception 'unexpected keys (amount leak?): %', r; end if;
  -- keep checking until the 3-per-shift limit: the next check is refused with {limit:true} and nothing more is logged
  for i in 1..3 loop r := public.clinic_finance_count_check('check', jsonb_build_object('shift_id', sid, 'counts', '{"50":"1"}'::jsonb)); exit when (r->>'limit')::boolean; end loop;
  if not coalesce((r->>'limit')::boolean, false) then raise exception '4th check not refused: %', r; end if;
  ok := false; begin perform public.clinic_finance_count_check('set', '{"enabled":false}'::jsonb); exception when others then ok := sqlerrm like '%للسوبر أدمن أو المدير المالي%'; end;
  if not ok then raise exception 'cashier changed the setting'; end if;
  perform set_config('request.jwt.claim.sub', fm::text, true);
  r := public.clinic_finance_count_check('settings', '{}'::jsonb);
  if not (r->>'can_change')::boolean then raise exception 'FM cannot change the setting'; end if;
  perform public.clinic_finance_count_check('set', '{"enabled":false}'::jsonb);
  perform set_config('request.jwt.claim.sub', cu::text, true);
  r := public.clinic_finance_count_check('check', jsonb_build_object('shift_id', sid, 'counts', '{"50":"1"}'::jsonb));
  if (r->>'enabled')::boolean then raise exception 'alert off but still checking: %', r; end if;
  if sa is not null then
    perform set_config('request.jwt.claim.sub', sa::text, true);
    perform public.clinic_finance_count_check('set', '{"enabled":true}'::jsonb);
    r := public.clinic_finance_count_check('settings', '{}'::jsonb);
    if not (r->>'enabled')::boolean then raise exception 'super admin could not turn it back on'; end if;
  end if;
  execute 'reset role';
  raise notice 'count check dry-run OK on shift % (cashier: match/no-match, 4th refused, cannot set; FM off; super admin on), no amount leaked', sid;
end $$;
rollback;
