-- Owner 2026-11-17: a reviewed «إنهاء عقد» (end a doctor contract) action.
-- Before this, an approved doctor contract could only be revised (same scope, from tomorrow), never ended. So after moving a doctor
-- from «كشف الأخصائي» (0001371) to «كشف الاستشاري» (0001372), the old row stayed active and reception could still pick the wrong price.
-- Flow (maker-checker, same as contracts):
--   * request: an account with finance «create» asks to end an ACTIVE contract, giving its last day (today or later, Cairo) and a reason.
--   * review: a DIFFERENT account with finance «review» approves or rejects. On approval the contract's valid_to becomes that last day.
--     If the last day falls before the contract ever started, it becomes 'superseded' (it never applied).
--   * Nothing retroactive: the last day can't be in the past, at request or at approval. Accrued fees and allocations are untouched.
-- ADDITIVE: 8 nullable columns on clinic_finance.doctor_contracts (they appear in the existing overview's to_jsonb rows) and 1 new public function.
-- Rollback: supabase/rollbacks/20261117170000_doctor_contract_end.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_finance.doctor_contracts') is null then raise exception 'doctor_contracts غير موجود'; end if;
  if to_regprocedure('clinic_finance.require_access(text)') is null then raise exception 'clinic_finance.require_access غير موجودة'; end if;
  if to_regprocedure('public.clinic_finance_doctor_contract_end(text,jsonb,uuid)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table clinic_finance.doctor_contracts
  add column end_request_last_day date,
  add column end_request_reason text,
  add column end_requested_by uuid,
  add column end_requested_at timestamptz,
  add column end_request_token uuid,
  add column ended_by uuid,
  add column ended_at timestamptz,
  add column end_reason text;

create function public.clinic_finance_doctor_contract_end(p_action text, p_payload jsonb, p_token uuid)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  me uuid;
  c clinic_finance.doctor_contracts%rowtype;
  today date := (now() at time zone 'Africa/Cairo')::date;
  v_last date;
  v_reason text;
  v_ok boolean;
begin
  if p_action = 'request' then
    me := clinic_finance.require_access('create');
    select * into c from clinic_finance.doctor_contracts where id = nullif(p_payload->>'id','')::uuid for update;
    if not found then raise exception 'العقد غير موجود'; end if;
    if c.end_request_token = p_token and c.end_requested_by = me then return c.id; end if;
    if c.status <> 'active' then raise exception 'يمكن إنهاء عقد معتمد فقط'; end if;
    if c.end_request_last_day is not null then raise exception 'فيه طلب إنهاء للعقد ده مستني المراجعة'; end if;
    if exists (select 1 from clinic_finance.doctor_contracts r where r.supersedes = c.id and r.status = 'pending') then
      raise exception 'فيه تعديل للعقد ده مستني المراجعة؛ راجعه الأول';
    end if;
    v_last := nullif(p_payload->>'last_day','')::date;
    v_reason := trim(coalesce(p_payload->>'reason',''));
    if v_last is null then raise exception 'اختار آخر يوم يسري فيه العقد'; end if;
    if v_last < today then raise exception 'آخر يوم لازم يكون النهارده أو بعده؛ مفيش إنهاء بأثر رجعي'; end if;
    if v_last >= c.valid_to then raise exception 'العقد بينتهي أصلًا يوم %؛ اختار يوم قبله', c.valid_to; end if;
    if length(v_reason) < 5 then raise exception 'اكتب سبب الإنهاء (٥ حروف على الأقل)'; end if;
    update clinic_finance.doctor_contracts
       set end_request_last_day = v_last, end_request_reason = v_reason, end_requested_by = me, end_requested_at = now(), end_request_token = p_token
     where id = c.id;
    return c.id;

  elsif p_action = 'review' then
    me := clinic_finance.require_access('review');
    select * into c from clinic_finance.doctor_contracts where id = nullif(p_payload->>'id','')::uuid for update;
    if not found then raise exception 'العقد غير موجود'; end if;
    if c.end_request_last_day is null then raise exception 'مفيش طلب إنهاء مستني للعقد ده'; end if;
    if c.end_requested_by = me then raise exception 'منشئ طلب الإنهاء لا يعتمد طلبه؛ لازم حساب تاني'; end if;
    v_ok := (p_payload->>'approve')::boolean;
    if v_ok is null then raise exception 'حدد القرار'; end if;
    if v_ok then
      if c.status <> 'active' then raise exception 'العقد لم يعد معتمدًا؛ ارفض الطلب'; end if;
      if c.end_request_last_day < today then raise exception 'آخر يوم في الطلب مضى؛ ارفضه وسجّل طلب جديد'; end if;
      if exists (select 1 from clinic_finance.doctor_contracts r where r.supersedes = c.id and r.status = 'pending') then
        raise exception 'فيه تعديل للعقد ده مستني المراجعة؛ راجعه الأول';
      end if;
      update clinic_finance.doctor_contracts
         set valid_to = case when c.end_request_last_day >= c.valid_from then c.end_request_last_day else c.valid_to end,
             status = case when c.end_request_last_day < c.valid_from then 'superseded' else c.status end,
             ended_by = me, ended_at = now(), end_reason = c.end_request_reason || coalesce(' — ' || nullif(trim(p_payload->>'note'),''), ''),
             end_request_last_day = null, end_request_reason = null, end_requested_by = null, end_requested_at = null, end_request_token = null
       where id = c.id;
    else
      update clinic_finance.doctor_contracts
         set end_request_last_day = null, end_request_reason = null, end_requested_by = null, end_requested_at = null, end_request_token = null
       where id = c.id;
    end if;
    return c.id;
  end if;
  raise exception 'إجراء غير معروف';
end $$;

revoke all on function public.clinic_finance_doctor_contract_end(text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_finance_doctor_contract_end(text, jsonb, uuid) to authenticated;

commit;
