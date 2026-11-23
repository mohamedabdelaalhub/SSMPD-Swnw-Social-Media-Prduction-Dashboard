-- «الملاحظة جنب الدفعة اللي غطّت أكتر من زيارة» (owner 2026-11-23 «طبقه», mockup docs/ui-references/mockups/multi-payment-note-everywhere.*):
-- wherever payments are listed or counted, a payment that covers more than one visit shows «دفعة واحدة لـN زيارات» + its note, and the
-- counts say why receipts ≠ visits. Read-only; no money logic changes.
--   * fix: the reception snapshot «allocations» never carried payment_id, so the receipt detail / print could not list the visits of a
--     collect_multi payment. The function that builds that list is found by its body (the snapshot is a chain of wrappers) and patched once.
--   * public.clinic_reception_shared_records payments: + note, cross_patient; each allocation + the visit's patient name; in a patient
--     file a payment made by someone else that paid one of this patient's visits is listed too (with the payer's name).
--   * public.clinic_reception_invoice_print payments: + note, total (the whole payment), visits (visits it covered).
--   * public.clinic_finance_shift_movements rows: + source_id (the payment id), so the shift movements screen can add the note.
--   * new public.clinic_reception_multi_payments(p jsonb) — {from,to,ids,finance_shift}: receipts in scope, how many covered more than
--     one visit, and those payments with their note. Finance 'view' or reception 'view' on the live workspace sees all; anyone else only
--     their own collections.
-- In-place anchors (each must match once; old bodies saved in clinic_reception.multi_note_saved_defs).
-- Rollback: supabase/rollbacks/20261122390000_multi_payment_note.rollback.sql
begin;

do $$ begin
  if to_regclass('clinic_reception.one_payer_saved_defs') is null then raise exception 'طبّق الدفعة من شخص واحد لأكتر من مريض (20261122380000) أولًا'; end if;
  if to_regclass('clinic_reception.multi_note_saved_defs') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_reception.multi_note_saved_defs(name text primary key, def text not null);
alter table clinic_reception.multi_note_saved_defs enable row level security;
revoke all on clinic_reception.multi_note_saved_defs from public, anon, authenticated;

-- 1) snapshot allocations: + payment_id
do $$ declare fn regprocedure; n int; d text; a text := $a$'payment_reference',p.reference$a$; begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname in ('public', 'clinic_reception') and p.prosrc like '%' || a || '%';
  if n <> 1 then raise exception 'snapshot allocations anchor found % times', n; end if;
  select p.oid::regprocedure into fn from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname in ('public', 'clinic_reception') and p.prosrc like '%' || a || '%';
  d := pg_get_functiondef(fn);
  if (length(d) - length(replace(d, a, ''))) <> length(a) then raise exception 'snapshot allocations anchor not found once'; end if;
  insert into clinic_reception.multi_note_saved_defs values ('snapshot', d);
  execute replace(d, a, $b$'payment_id',a.payment_id,$b$ || a);
end $$;

-- 2) shared records payments: + note, cross_patient
do $$ declare d text := pg_get_functiondef('public.clinic_reception_shared_records(text,uuid,date,date,integer)'::regprocedure);
  a text := $a$'has_proof', y.proof_path is not null)$a$; begin
  if (length(d) - length(replace(d, a, ''))) <> length(a) then raise exception 'shared records anchor not found once'; end if;
  insert into clinic_reception.multi_note_saved_defs values ('shared_records', d);
  execute replace(d, a, $b$'has_proof', y.proof_path is not null, 'note', y.note, 'cross_patient', y.cross_patient)$b$);
end $$;

-- 2b) shared records base (the payments part, found by its body): visit patient on each allocation; a patient file also lists payments
--     made by someone else for this patient's visits
do $$ declare fn regprocedure; n int; d text; i int := 1; e text[] := array[
  $a$'visit_no',v.visit_no,'amount',a.amount)$a$,
  $a$'visit_no',v.visit_no,'amount',a.amount,'patient',(select x.name from clinic_reception.patients x where x.id=i.patient_id))$a$,
  $a$(p_context<>'patient' or p.patient_id=pid)
 and (pay.created_at$a$,
  $a$(p_context<>'patient' or p.patient_id=pid or exists(select 1 from clinic_reception.allocations a3 join clinic_reception.invoices i3 on i3.id=a3.invoice_id join clinic_reception.patients p3 on p3.id=i3.patient_id where a3.payment_id=pay.id and p3.patient_id=pid))
 and (pay.created_at$a$]; begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname in ('public', 'clinic_reception') and p.prosrc like '%' || e[1] || '%';
  if n <> 1 then raise exception 'shared records payments anchor found % times', n; end if;
  select p.oid::regprocedure into fn from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname in ('public', 'clinic_reception') and p.prosrc like '%' || e[1] || '%';
  d := pg_get_functiondef(fn);
  insert into clinic_reception.multi_note_saved_defs values ('shared_base', d);
  while i < array_length(e, 1) loop
    if (length(d) - length(replace(d, e[i], ''))) <> length(e[i]) then raise exception 'shared records base patch % not found once', (i + 1) / 2; end if;
    d := replace(d, e[i], e[i + 1]); i := i + 2;
  end loop;
  execute d;
end $$;

-- 3) visit invoice print payments: + note, total, visits
do $$ declare d text := pg_get_functiondef('public.clinic_reception_invoice_print(uuid,uuid)'::regprocedure); i int := 1; e text[] := array[
  $a$'proof', y.proof_path is not null)$a$,
  $a$'proof', y.proof_path is not null, 'note', y.note, 'total', y.total, 'visits', y.visits)$a$,
  $a$select p.receipt_no, p.method, p.reference, p.proof_path, p.created_at, sum(a.amount) amount$a$,
  $a$select p.receipt_no, p.method, p.reference, p.proof_path, p.created_at, sum(a.amount) amount, p.note, p.amount total,
             (select count(distinct coalesce(i2.visit_id, i2.id)) from clinic_reception.allocations a2
                join clinic_reception.invoices i2 on i2.id = a2.invoice_id where a2.payment_id = p.id) visits$a$,
  $a$group by p.id, p.receipt_no, p.method, p.reference, p.proof_path, p.created_at) y;$a$,
  $a$group by p.id, p.receipt_no, p.method, p.reference, p.proof_path, p.created_at, p.note, p.amount) y;$a$];
begin
  while i < array_length(e, 1) loop
    if (length(d) - length(replace(d, e[i], ''))) <> length(e[i]) then raise exception 'invoice print patch % not found once', (i + 1) / 2; end if;
    d := replace(d, e[i], e[i + 1]); i := i + 2;
  end loop;
  insert into clinic_reception.multi_note_saved_defs values ('invoice_print', pg_get_functiondef('public.clinic_reception_invoice_print(uuid,uuid)'::regprocedure));
  execute d;
end $$;

-- 3b) shift movements: + source_id on each row
do $$ declare d text; a text := $a$'insurance',a.insurance) order by a.at_time$a$; begin
  if to_regprocedure('public.clinic_finance_shift_movements(uuid,date,date,uuid,uuid)') is null then return; end if;
  d := pg_get_functiondef('public.clinic_finance_shift_movements(uuid,date,date,uuid,uuid)'::regprocedure);
  if (length(d) - length(replace(d, a, ''))) <> length(a) then raise exception 'shift movements anchor not found once'; end if;
  insert into clinic_reception.multi_note_saved_defs values ('shift_movements', d);
  execute replace(d, a, $b$'insurance',a.insurance,'source_id',a.source_id) order by a.at_time$b$);
end $$;

-- 4) counts / lists: which payments covered more than one visit, with their note
create function public.clinic_reception_multi_payments(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  me uuid := public.my_admin_id(); ws uuid; wide boolean := false;
  v_from date := nullif(p->>'from', '')::date; v_to date := nullif(p->>'to', '')::date;
  v_shift uuid := nullif(p->>'finance_shift', '')::uuid;
  v_ids uuid[] := case when jsonb_typeof(p->'ids') = 'array' then (select array_agg(x::uuid) from jsonb_array_elements_text(p->'ids') x) end;
  res jsonb;
begin
  if me is null or not exists (select 1 from public.admins where id = me and active) then raise exception 'سجل الدخول' using errcode = '42501'; end if;
  select id into ws from clinic_reception.workspaces where mode = 'live' order by id limit 1;
  if ws is null then return jsonb_build_object('receipts', 0, 'multi', 0, 'multi_visits', 0, 'rows', '[]'::jsonb); end if;
  begin wide := clinic_finance.allowed('view'); exception when others then wide := false; end;
  if not wide then begin perform clinic_reception.access(ws, 'view'); wide := true; exception when others then wide := false; end; end if;
  if v_ids is null and v_from is null and v_to is null and v_shift is null then v_from := (now() at time zone 'Africa/Cairo')::date; v_to := v_from; end if;
  with base as (
    select y.* from clinic_reception.payments y
     where y.workspace_id = ws
       and (v_ids is null or y.id = any(v_ids))
       and (v_from is null or (y.created_at at time zone 'Africa/Cairo')::date >= v_from)
       and (v_to is null or (y.created_at at time zone 'Africa/Cairo')::date <= v_to)
       and (v_shift is null or y.shift_id in (select rs.id from clinic_reception.shifts rs where rs.finance_shift_id = v_shift))
       and (wide or y.created_by = me)),
  cov as (
    select b.id, count(distinct coalesce(i.visit_id, i.id)) visits
      from base b join clinic_reception.allocations a on a.payment_id = b.id join clinic_reception.invoices i on i.id = a.invoice_id
     group by b.id),
  multi as (
    select b.*, c.visits from base b join cov c on c.id = b.id where c.visits > 1)
  select jsonb_build_object(
    'receipts', (select count(*) from base),
    'multi', (select count(*) from multi),
    'multi_visits', (select coalesce(sum(visits), 0) from multi),
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'receipt_no', m.receipt_no, 'reference', m.reference, 'method', m.method,
        'amount', m.amount, 'at', m.created_at, 'visits', m.visits, 'note', m.note, 'cross_patient', m.cross_patient,
        'patient', pt.name, 'by', coalesce(nullif(trim(ad.name), ''), 'موظف'),
        'lines', (select jsonb_agg(jsonb_build_object('patient', x.name, 'no', coalesce(v.visit_no::text, i.invoice_no::text), 'applied', a.amount) order by a.created_at)
                    from clinic_reception.allocations a join clinic_reception.invoices i on i.id = a.invoice_id
                    left join clinic_reception.visits v on v.id = i.visit_id left join clinic_reception.patients x on x.id = i.patient_id
                   where a.payment_id = m.id)) order by m.created_at desc)
      from (select * from multi order by created_at desc limit 200) m
      left join clinic_reception.patients pt on pt.id = m.patient_id left join public.admins ad on ad.id = m.created_by), '[]'::jsonb))
    into res;
  return res;
end $$;
revoke all on function public.clinic_reception_multi_payments(jsonb) from public, anon;
grant execute on function public.clinic_reception_multi_payments(jsonb) to authenticated;

commit;
