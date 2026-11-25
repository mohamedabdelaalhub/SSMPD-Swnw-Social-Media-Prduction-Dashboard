-- Live rollback dry-run for 20261126030000_finance_display_names.sql (rule 9). ONE transaction ending with ROLLBACK; nothing kept. READ-ONLY.
-- As the financial manager: snapshot employee_balances rows carry name/pending; a doctor statement's patient_ref objects carry
-- patient_name; main treasury last_move carries source (+ from_register on a handover). Prints counts only (no names).
begin;
-- Plain-language finance screens (owner approvals relayed by UI&UX 4, 2026-11-25): three READ-ONLY display fields, no logic change.
--  1) Payroll tab: every clinic_finance_snapshot.employee_balances row gets `name` (clinic_people.people.full_name by code /
--     finance_subject, else the latest approved employment request's employee_name) and `pending` (count of pending payroll /
--     advance requests for that subject) so a 0/0 row with a pending request stays visible.
--  2) Doctor statement (owner «موافق»): every object that carries `patient_ref` in clinic_finance_doctor_statement / _detail gets
--     `patient_name` (public.patients.full_name by patient_code, else the reception file's name). Screen only — the UI keeps print /
--     export on the file number.
--  3) Main treasury «آخر حركة» (owner «عايز اسم الخزنة»): last_move gets `source` and, for a handover receipt, `from_register`
--     (treasury_transfers.from_shift → registers.name).
-- Outer wrappers only: the current public functions move to clinic_finance.*_pre_names (not granted); the new public functions call
-- them and add the fields. Same signatures, same gates (the inner function still checks access first). Nothing writes.
-- Rollback: supabase/rollbacks/20261126030000_finance_display_names.rollback.sql

do $$ begin
  if to_regprocedure('clinic_finance.snapshot_pre_names(date,date,integer)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if to_regprocedure('public.clinic_finance_snapshot(date,date,integer)') is null or to_regprocedure('public.clinic_finance_doctor_statement(text,date,date)') is null
     or to_regprocedure('public.clinic_finance_doctor_statement_detail(text,date,date)') is null or to_regprocedure('public.clinic_finance_main_treasury_balance()') is null then
    raise exception 'دوال الحسابات المطلوبة مش موجودة';
  end if;
end $$;

alter function public.clinic_finance_snapshot(date, date, integer) set schema clinic_finance;
alter function clinic_finance.clinic_finance_snapshot(date, date, integer) rename to snapshot_pre_names;
alter function public.clinic_finance_doctor_statement(text, date, date) set schema clinic_finance;
alter function clinic_finance.clinic_finance_doctor_statement(text, date, date) rename to doctor_statement_pre_names;
alter function public.clinic_finance_doctor_statement_detail(text, date, date) set schema clinic_finance;
alter function clinic_finance.clinic_finance_doctor_statement_detail(text, date, date) rename to doctor_statement_detail_pre_names;
alter function public.clinic_finance_main_treasury_balance() set schema clinic_finance;
alter function clinic_finance.clinic_finance_main_treasury_balance() rename to main_treasury_balance_pre_names;
revoke all on function clinic_finance.snapshot_pre_names(date, date, integer), clinic_finance.doctor_statement_pre_names(text, date, date),
  clinic_finance.doctor_statement_detail_pre_names(text, date, date), clinic_finance.main_treasury_balance_pre_names() from public, anon, authenticated;

-- patient name for a finance patient_ref (P-… code or reception file number)
create function clinic_finance.patient_name_for_ref(p_ref text) returns text language sql stable security definer set search_path = pg_catalog, public as $$
  select coalesce((select p.full_name from public.patients p where p.patient_code = p_ref limit 1),
                  (select rp.name from clinic_reception.patients rp join clinic_reception.workspaces w on w.id = rp.workspace_id and w.mode = 'live'
                    where rp.file_no = p_ref order by rp.created_at desc limit 1))
$$;
-- add patient_name next to every patient_ref, at any depth
create function clinic_finance.with_patient_names(v jsonb) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare k text; x jsonb; o jsonb;
begin
  if jsonb_typeof(v) = 'array' then
    return coalesce((select jsonb_agg(clinic_finance.with_patient_names(e) order by n) from jsonb_array_elements(v) with ordinality t(e, n)), '[]'::jsonb);
  elsif jsonb_typeof(v) = 'object' then
    o := '{}'::jsonb;
    for k, x in select key, value from jsonb_each(v) loop o := o || jsonb_build_object(k, clinic_finance.with_patient_names(x)); end loop;
    if jsonb_typeof(v->'patient_ref') = 'string' and not (v ? 'patient_name') then
      o := o || jsonb_build_object('patient_name', clinic_finance.patient_name_for_ref(v->>'patient_ref'));
    end if;
    return o;
  end if;
  return v;
end $$;
revoke all on function clinic_finance.patient_name_for_ref(text), clinic_finance.with_patient_names(jsonb) from public, anon, authenticated;

create function public.clinic_finance_doctor_statement(p_doctor_key text, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin return clinic_finance.with_patient_names(clinic_finance.doctor_statement_pre_names(p_doctor_key, p_from, p_to)); end $$;
create function public.clinic_finance_doctor_statement_detail(p_doctor_key text, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin return clinic_finance.with_patient_names(clinic_finance.doctor_statement_detail_pre_names(p_doctor_key, p_from, p_to)); end $$;

create function public.clinic_finance_snapshot(p_from date, p_to date, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb := clinic_finance.snapshot_pre_names(p_from, p_to, p_offset);
begin
  if jsonb_typeof(v->'employee_balances') = 'array' then
    v := jsonb_set(v, '{employee_balances}', coalesce((select jsonb_agg(e || jsonb_build_object(
        'name', coalesce(
          (select nullif(trim(pp.full_name), '') from clinic_people.people pp where pp.code = e->>'subject' or pp.finance_subject = e->>'subject' limit 1),
          (select nullif(trim(b.payload->>'employee_name'), '') from clinic_finance.business_requests b
            where b.subject = e->>'subject' and b.kind = 'employment' and b.status = 'approved' order by b.created_at desc limit 1)),
        'pending', (select count(*) from clinic_finance.business_requests b where b.subject = e->>'subject' and b.kind in ('payroll', 'advance') and b.status = 'pending'))
      order by n) from jsonb_array_elements(v->'employee_balances') with ordinality t(e, n)), '[]'::jsonb));
  end if;
  return v;
end $$;

create function public.clinic_finance_main_treasury_balance() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v jsonb := clinic_finance.main_treasury_balance_pre_names(); e clinic_finance.entries%rowtype;
begin
  if jsonb_typeof(v->'last_move') = 'object' and (v#>>'{last_move,event_no}') is not null then
    select * into e from clinic_finance.entries where event_no = (v#>>'{last_move,event_no}')::bigint;
    if found then
      v := jsonb_set(v, '{last_move}', (v->'last_move') || jsonb_build_object('source', e.source, 'from_register',
        case when e.source = 'treasury_transfer_in' then (select r.name from clinic_finance.treasury_transfers t join clinic_finance.shifts s on s.id = t.from_shift
                                                           join clinic_finance.registers r on r.id = s.register_id where t.id = e.source_id) end));
    end if;
  end if;
  return v;
end $$;

revoke all on function public.clinic_finance_snapshot(date, date, integer), public.clinic_finance_doctor_statement(text, date, date),
  public.clinic_finance_doctor_statement_detail(text, date, date), public.clinic_finance_main_treasury_balance() from public, anon;
grant execute on function public.clinic_finance_snapshot(date, date, integer), public.clinic_finance_doctor_statement(text, date, date),
  public.clinic_finance_doctor_statement_detail(text, date, date), public.clinic_finance_main_treasury_balance() to authenticated;

do $$
declare fm uuid; v jsonb; dk text; n_emp int; n_named int; n_pref int; n_pname int; f date := date_trunc('month', now())::date; t date := now()::date;
begin
  select user_id into fm from public.admins where active and user_id is not null and role = 'financial_manager' order by id limit 1;
  if fm is null then raise exception 'need a financial manager with a login'; end if;
  perform set_config('request.jwt.claim.sub', fm::text, true); execute 'set local role authenticated';
  v := public.clinic_finance_snapshot(f, t, 0);
  select count(*), count(*) filter (where e ? 'name' and e ? 'pending'), count(*) filter (where nullif(e->>'name', '') is not null)
    into n_emp, n_pref, n_named from jsonb_array_elements(coalesce(v->'employee_balances', '[]'::jsonb)) e;
  if n_emp <> n_pref then raise exception 'employee_balances rows without name/pending: % of %', n_emp - n_pref, n_emp; end if;
  raise notice 'employee_balances: % rows, % with a name', n_emp, n_named;
  execute 'reset role';
  select doctor_key into dk from clinic_finance.doctor_accruals group by doctor_key order by count(*) desc limit 1;
  execute 'set local role authenticated';
  if dk is not null then
    v := public.clinic_finance_doctor_statement(dk, f - 60, t);
    select count(*) filter (where o ? 'patient_ref'), count(*) filter (where o ? 'patient_ref' and o ? 'patient_name')
      into n_pref, n_pname from jsonb_path_query(v, 'strict $.**') o where jsonb_typeof(o) = 'object';
    if n_pref <> n_pname then raise exception 'statement objects without patient_name: %', n_pref - n_pname; end if;
    raise notice 'doctor statement: % rows with patient_ref, all with patient_name', n_pref;
    v := public.clinic_finance_doctor_statement_detail(dk, f - 60, t);
  end if;
  v := public.clinic_finance_main_treasury_balance();
  if jsonb_typeof(v->'last_move') = 'object' and not (v->'last_move' ? 'source') then raise exception 'last_move without source: %', v->'last_move'; end if;
  raise notice 'main treasury last_move: source %, from_register present %', v#>>'{last_move,source}', (v#>>'{last_move,from_register}') is not null;
  execute 'reset role';
  raise notice 'finance display names dry-run OK';
end $$;
rollback;
