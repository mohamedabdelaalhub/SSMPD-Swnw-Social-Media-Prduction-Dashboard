-- Doctor contract REVISIONS: an approved contract is never edited. A revision is a NEW pending contract that points at the contract it replaces (supersedes).
-- When a second account approves the revision, the old contract stops applying from the revision's start date, in the same transaction:
--   * revision starts after the old one started  -> the old contract is shortened (valid_to = revision start - 1); services performed before that date keep the old terms
--   * revision starts on the old one's first day -> the old contract becomes 'superseded' (it never started to apply; only possible while it lies in the future)
-- Already accrued fees are untouched (allocations keep their contract id). Maker-checker is unchanged: the creator of the revision cannot approve it.
-- Retroactive revisions are refused: the revision must start AFTER today (Cairo).
-- ADDITIVE: 2 columns + 1 partial unique index (one pending revision per contract) + status 'superseded' allowed.
-- The command function clinic_finance.doctor_command_before_departments is PATCHED IN PLACE by exact text anchors (each anchor must occur exactly once, otherwise the migration stops):
--   declare line, the review overlap check, and the payout branch (where the new contract_revise action is inserted before it). No other line of the function changes.
-- Rollback: supabase/rollbacks/20261108240000_contract_revisions.rollback.sql (refused once a revision has been approved).
begin;

do $$
declare f text;
begin
  if to_regprocedure('clinic_finance.doctor_command_before_departments(text,jsonb,uuid)') is null then
    raise exception 'doctor_command_before_departments غير موجودة؛ طبّق ملف عقود الأقسام أولًا';
  end if;
  f := pg_get_functiondef('clinic_finance.doctor_command_before_departments(text,jsonb,uuid)'::regprocedure);
  if position('supersedes' in f) > 0 then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if (length(f) - length(replace(f, 'declare me uuid;v_id uuid;', ''))) <> length('declare me uuid;v_id uuid;')
     or (length(f) - length(replace(f, 'if approval and exists(select 1 from clinic_finance.doctor_contracts where doctor_key=c.doctor_key', ''))) <> length('if approval and exists(select 1 from clinic_finance.doctor_contracts where doctor_key=c.doctor_key')
     or (length(f) - length(replace(f, 'elsif p_action=''payout'' then me:=clinic_finance.require_access(''create'');', ''))) <> length('elsif p_action=''payout'' then me:=clinic_finance.require_access(''create'');') then
    raise exception 'doctor_command_before_departments تغيّرت عن النص المتوقع؛ راجع الفرق قبل التطبيق';
  end if;
  if to_regclass('clinic_finance.doctor_contracts') is null then raise exception 'doctor_contracts غير موجود'; end if;
end $$;

alter table clinic_finance.doctor_contracts add column supersedes uuid references clinic_finance.doctor_contracts(id);
alter table clinic_finance.doctor_contracts add column superseded_valid_to date;
alter table clinic_finance.doctor_contracts drop constraint doctor_contracts_status_check;
alter table clinic_finance.doctor_contracts add constraint doctor_contracts_status_check check (status = any (array['pending','active','rejected','superseded']));
create unique index doctor_contracts_one_pending_revision on clinic_finance.doctor_contracts(supersedes) where supersedes is not null and status = 'pending';

do $mig$
declare f text;
  rev text := $r$ elsif p_action='contract_revise' then me:=clinic_finance.require_access('create');select * into c from clinic_finance.doctor_contracts where created_by=me and token=p_token;if found then if c.payload is distinct from p_payload then raise exception 'مفتاح طلب مختلف';end if;return c.id;end if;
 select * into o from clinic_finance.doctor_contracts where id=nullif(p_payload->>'supersedes','')::uuid for update;
 if not found or o.status<>'active' then raise exception 'يمكن تعديل عقد معتمد فقط';end if;
 if length(trim(coalesce(p_payload->>'reference','')))<2 or (p_payload->>'rate')::numeric::text in ('NaN','Infinity','-Infinity') then raise exception 'راجع النسبة ومرجع التعديل';end if;
 if (p_payload->>'from')::date<=(now() at time zone 'Africa/Cairo')::date then raise exception 'تاريخ سريان التعديل لازم يكون بعد النهارده';end if;
 if (p_payload->>'from')::date<o.valid_from or (p_payload->>'from')::date>o.valid_to then raise exception 'تاريخ سريان التعديل لازم يقع داخل فترة العقد الحالي';end if;
 insert into clinic_finance.doctor_contracts(doctor_key,doctor_name,service_scope,valid_from,valid_to,rate,basis,base_scope,deduction,refund_policy,reference,payload,created_by,token,supersedes) values(o.doctor_key,o.doctor_name,o.service_scope,(p_payload->>'from')::date,(p_payload->>'to')::date,(p_payload->>'rate')::numeric,p_payload->>'basis',p_payload->>'base_scope',p_payload->>'deduction','proportional_revenue',trim(p_payload->>'reference'),p_payload,me,p_token,o.id) returning id into v_id;
$r$;
  sup text := $s$ if approval and c.supersedes is not null then
  select * into o from clinic_finance.doctor_contracts where id=c.supersedes for update;
  if o.status<>'active' then raise exception 'العقد الأصلي لم يعد معتمدًا؛ ارفض هذا التعديل وسجّل تعديلًا جديدًا';end if;
  if c.valid_from<=(now() at time zone 'Africa/Cairo')::date then raise exception 'تاريخ سريان التعديل مضى؛ ارفضه وسجّل تعديلًا بتاريخ لاحق';end if;
  if o.valid_to>=c.valid_from then
   update clinic_finance.doctor_contracts set superseded_valid_to=o.valid_to where id=c.id;
   if c.valid_from>o.valid_from then update clinic_finance.doctor_contracts set valid_to=c.valid_from-1 where id=o.id;
   else update clinic_finance.doctor_contracts set status='superseded' where id=o.id;end if;
  end if;
 end if;
 $s$;
begin
  f := pg_get_functiondef('clinic_finance.doctor_command_before_departments(text,jsonb,uuid)'::regprocedure);
  f := replace(f, 'declare me uuid;v_id uuid;', 'declare o clinic_finance.doctor_contracts%rowtype;me uuid;v_id uuid;');
  f := replace(f, 'if approval and exists(select 1 from clinic_finance.doctor_contracts where doctor_key=c.doctor_key', sup || 'if approval and exists(select 1 from clinic_finance.doctor_contracts where doctor_key=c.doctor_key');
  f := replace(f, 'elsif p_action=''payout'' then me:=clinic_finance.require_access(''create'');', rev || 'elsif p_action=''payout'' then me:=clinic_finance.require_access(''create'');');
  execute f;
end $mig$;

commit;
