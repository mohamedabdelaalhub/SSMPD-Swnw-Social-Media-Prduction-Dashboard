-- Live rollback test for 20261122160000_reception_collect_multi.sql — CASH «دفعة واحدة لأكتر من زيارة» on a real finance shift.
-- Everything runs in ONE transaction that ends with ROLLBACK: the migration body (inlined below, without its begin/commit),
-- a temporary collection register + reception shift (opens a linked finance shift), one test patient, two test invoices,
-- collect_multi cash 1,000 + note, then checks. No message is sent, no transfer is made, nothing is kept.
-- Run the whole file as one script (SQL editor / psql -1 is not needed: it has its own begin … rollback).
begin;
-- ===== migration body (20261122160000, md5 of the migration file b87937fb1856e103224c614dc9761847) =====

do $$ begin
  if to_regprocedure('public.clinic_reception_command(uuid,text,jsonb,uuid)') is null
     or to_regprocedure('clinic_reception.check_money_reference(uuid,text,text,text,uuid)') is null
     or to_regprocedure('clinic_reception.family_ids(uuid)') is null
     or to_regclass('clinic_reception.payment_proofs') is null then raise exception 'طبّق ملفات الاستقبال والإيصالات وأفراد العيلة (20261122110000) أولًا'; end if;
  if to_regprocedure('clinic_reception.command_before_collect_multi(uuid,text,jsonb,uuid)') is not null then
    raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table clinic_reception.payments add column note text check (note is null or length(note) <= 300);

create table clinic_reception.multi_receipts (
  workspace_id uuid not null references clinic_reception.workspaces(id),
  actor_id uuid not null references public.admins(id),
  token uuid not null,
  payload jsonb not null,
  payment_id uuid not null references clinic_reception.payments(id),
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, actor_id, token)
);
alter table clinic_reception.multi_receipts enable row level security;
revoke all on clinic_reception.multi_receipts from public, anon, authenticated;

do $$ begin
  alter function public.clinic_reception_command(uuid, text, jsonb, uuid) rename to command_before_collect_multi;
  alter function public.command_before_collect_multi(uuid, text, jsonb, uuid) set schema clinic_reception;
end $$;
revoke all on function clinic_reception.command_before_collect_multi(uuid, text, jsonb, uuid) from public, anon, authenticated;

create function clinic_reception.collect_multi(p_workspace uuid, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  me uuid := clinic_reception.access(p_workspace, 'collect');
  w clinic_reception.workspaces%rowtype; prev clinic_reception.multi_receipts%rowtype;
  shift clinic_reception.shifts%rowtype; reg clinic_reception.registers%rowtype; i clinic_reception.invoices%rowtype;
  payer uuid; method text := p_payload->>'method'; ref text := trim(coalesce(p_payload->>'reference', ''));
  v_note text := nullif(left(btrim(coalesce(p_payload->>'note', '')), 300), '');
  amount numeric; leftover numeric; applied numeric; account text; fam uuid[]; ids uuid[]; v uuid; alloc uuid; lines jsonb := '[]';
  dims jsonb; n int;
begin
  if p_token is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text) > 10000
     or jsonb_typeof(p_payload->'invoice_ids') is distinct from 'array' then raise exception 'راجع بيانات الدفعة'; end if;
  n := jsonb_array_length(p_payload->'invoice_ids');
  if n not between 2 and 10 then raise exception 'اختار من زيارتين لعشر زيارات للدفعة الواحدة'; end if;
  begin
    payer := (p_payload->>'patient_id')::uuid;
    select array_agg(x::uuid order by o) into ids from jsonb_array_elements_text(p_payload->'invoice_ids') with ordinality t(x, o);
  exception when others then raise exception 'راجع الزيارات المختارة'; end;
  if (select count(distinct x) from unnest(ids) x) <> n then raise exception 'نفس الزيارة متكررة في الدفعة'; end if;
  amount := clinic_reception.number(p_payload->>'amount');
  select * into w from clinic_reception.workspaces where id = p_workspace for update;
  select * into prev from clinic_reception.multi_receipts where workspace_id = p_workspace and actor_id = me and token = p_token;
  if found then
    if prev.payload is distinct from p_payload then raise exception 'مفتاح الإعادة مرتبط بدفعة تانية'; end if;
    return prev.response;
  end if;
  if not exists (select 1 from clinic_reception.patients where id = payer and workspace_id = p_workspace)
     or method is null or method not in ('cash', 'pos', 'bank', 'instapay', 'wallet') or length(ref) < 2 then
    raise exception 'راجع المريض وطريقة السداد ومرجع العملية'; end if;
  if w.mode = 'live' then perform clinic_finance.lock_day(); perform clinic_reception.sync_stock(p_workspace); end if;
  perform clinic_reception.check_money_reference(p_workspace, method, ref, 'in');
  if method in ('cash', 'pos') then
    select * into shift from clinic_reception.shifts where id = nullif(p_payload->>'shift_id', '')::uuid and workspace_id = p_workspace
       and cashier_id = me and status = 'open' for update;
    if not found then raise exception 'اختر وردية مفتوحة تخصك'; end if;
    select * into reg from clinic_reception.registers where id = shift.register_id;
    if reg.direction = 'pay' then raise exception 'الخزينة للصرف فقط'; end if;
  end if;
  account := case method when 'cash' then '1111' when 'pos' then '1114' when 'wallet' then '1115' else '1112' end;
  fam := clinic_reception.family_ids(payer);
  -- lock and check every invoice first, before any money row
  for i in select inv.* from unnest(ids) with ordinality u(id, o) join clinic_reception.invoices inv on inv.id = u.id
            where inv.workspace_id = p_workspace order by u.o for update of inv loop
    if not (i.patient_id = any(fam)) then raise exception 'زيارة في الدفعة مش للمريض ولا لحد من أفراد عيلته'; end if;
    if i.package_id is not null then raise exception 'زيارات الباكج تتحصّل من الباكج نفسه'; end if;
    if clinic_reception.due(i.id) <= 0 then raise exception 'زيارة في الدفعة مدفوعة بالكامل'; end if;
  end loop;
  if (select count(*) from clinic_reception.invoices where id = any(ids) and workspace_id = p_workspace) <> n then
    raise exception 'زيارة في الدفعة مش موجودة'; end if;
  insert into clinic_reception.payments(workspace_id, patient_id, method, shift_id, amount, reference, created_by, note)
    values (p_workspace, payer, method, shift.id, amount, ref, me, v_note) returning id into v;
  leftover := amount;
  for i in select inv.* from unnest(ids) with ordinality u(id, o) join clinic_reception.invoices inv on inv.id = u.id order by u.o loop
    exit when leftover <= 0;
    applied := least(leftover, clinic_reception.due(i.id));
    if applied > 0 then
      insert into clinic_reception.allocations(workspace_id, invoice_id, payment_id, source, amount)
        values (p_workspace, i.id, v, 'payment', applied) returning id into alloc;
      dims := jsonb_build_object('patient_id', i.patient_id, 'payment_id', v, 'invoice_id', i.id, 'shift_id', shift.id, 'payer_id', payer);
      perform clinic_reception.post(p_workspace, 'invoice_payment_multi', alloc, 'تحصيل زيارة ضمن دفعة واحدة', account, '1122', applied, dims);
      lines := lines || jsonb_build_object('invoice_id', i.id, 'patient_id', i.patient_id, 'amount', applied);
      leftover := leftover - applied;
    end if;
  end loop;
  if leftover > 0 then
    perform clinic_reception.post(p_workspace, 'patient_credit', v, 'رصيد لصالح المريض', account, '2150', leftover,
      jsonb_build_object('patient_id', payer, 'payment_id', v, 'shift_id', shift.id));
    update clinic_reception.payments set credit_amount = leftover where id = v;
  end if;
  insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id) values (p_workspace, me, 'collect_multi', v);
  insert into clinic_reception.multi_receipts(workspace_id, actor_id, token, payload, payment_id, response)
    values (p_workspace, me, p_token, p_payload, v,
      jsonb_build_object('id', v, 'lines', lines, 'credit', leftover, 'receipt_no', (select receipt_no from clinic_reception.payments where id = v)))
    returning response into prev.response;
  return prev.response;
end $$;
revoke all on function clinic_reception.collect_multi(uuid, jsonb, uuid) from public, anon, authenticated;

create function public.clinic_reception_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare out jsonb; v_note text; pid uuid; me uuid;
begin
  if p_action = 'collect_multi' then return clinic_reception.collect_multi(p_workspace, p_payload, p_token); end if;
  out := clinic_reception.command_before_collect_multi(p_workspace, p_action, p_payload, p_token);
  if p_action in ('collect', 'collect_split') and jsonb_typeof(p_payload) = 'object' then
    v_note := nullif(left(btrim(coalesce(p_payload->>'note', '')), 300), '');
    if v_note is not null then
      me := public.my_admin_id();
      if p_action = 'collect' then
        begin pid := (out->>'id')::uuid; exception when others then pid := null; end;
        update clinic_reception.payments set note = v_note where id = pid and workspace_id = p_workspace and created_by = me and payments.note is null;
      elsif jsonb_typeof(out->'payment_ids') = 'array' then
        update clinic_reception.payments set note = v_note
         where id in (select x::uuid from jsonb_array_elements_text(out->'payment_ids') x) and workspace_id = p_workspace and created_by = me and payments.note is null;
      end if;
    end if;
  end if;
  return out;
end $$;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;

-- ===== test =====
do $$
declare u uuid; me uuid; w uuid; freg uuid; rreg uuid; sh uuid; fsh uuid; pat uuid; i1 uuid; i2 uuid; r jsonb; pay clinic_reception.payments%rowtype;
  n int; ref text := 'ROLLBACK-MULTI-' || gen_random_uuid()::text; k uuid := gen_random_uuid();
begin
  select id into w from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  if w is null then raise exception 'No live reception workspace'; end if;
  select a.user_id, a.id into u, me from public.admins a where a.role = 'super_admin' and a.active and a.user_id is not null
     and not exists (select 1 from clinic_finance.shifts s where s.cashier_id = a.id and s.status <> 'reviewed')
     and not exists (select 1 from clinic_reception.shifts s where s.cashier_id = a.id and s.status = 'open') order by a.id limit 1;
  if u is null then raise exception 'Need a super admin with no open / unreviewed shift'; end if;
  perform set_config('request.jwt.claim.sub', u::text, true); execute 'set local role authenticated';
  freg := public.clinic_finance_register(ref, 100000);
  execute 'reset role';
  insert into clinic_reception.registers(workspace_id, name, direction, finance_register_id) values (w, ref, 'receive', freg) returning id into rreg;
  insert into clinic_reception.patients(workspace_id, file_no, name, phone, created_by) values (w, ref, 'مريض اختبار تراجع', '', me) returning id into pat;
  insert into clinic_reception.invoices(workspace_id, patient_id, kind, amount, description) values (w, pat, 'service', 500, 'زيارة اختبار 1') returning id into i1;
  insert into clinic_reception.invoices(workspace_id, patient_id, kind, amount, description) values (w, pat, 'service', 500, 'زيارة اختبار 2') returning id into i2;
  execute 'set local role authenticated';
  sh := (public.clinic_reception_command(w, 'shift_open', jsonb_build_object('register_id', rreg), gen_random_uuid())->>'id')::uuid;
  r := public.clinic_reception_command(w, 'collect_multi', jsonb_build_object('patient_id', pat, 'method', 'cash', 'reference', ref, 'shift_id', sh,
         'amount', '1000', 'invoice_ids', jsonb_build_array(i1, i2), 'note', 'اختبار تراجع: كاش واحد لزيارتين'), k);
  if public.clinic_reception_command(w, 'collect_multi', jsonb_build_object('patient_id', pat, 'method', 'cash', 'reference', ref, 'shift_id', sh,
         'amount', '1000', 'invoice_ids', jsonb_build_array(i1, i2), 'note', 'اختبار تراجع: كاش واحد لزيارتين'), k) <> r then raise exception 'Replay changed'; end if;
  execute 'reset role';
  select finance_shift_id into fsh from clinic_reception.shifts where id = sh;
  if fsh is null then raise exception 'Shift not linked to finance'; end if;
  select count(*) into n from clinic_reception.payments where workspace_id = w and reference = ref; if n <> 1 then raise exception 'Expected ONE payment, got %', n; end if;
  select * into pay from clinic_reception.payments where workspace_id = w and reference = ref;
  if pay.receipt_no is null or pay.receipt_no not like 'RC-%' then raise exception 'Receipt number missing: %', pay.receipt_no; end if;
  if pay.note is distinct from 'اختبار تراجع: كاش واحد لزيارتين' or pay.amount <> 1000 or pay.credit_amount <> 0 or pay.shift_id <> sh then raise exception 'Payment row wrong'; end if;
  select count(*) into n from clinic_reception.allocations where payment_id = pay.id and amount = 500 and invoice_id in (i1, i2); if n <> 2 then raise exception 'Expected 2 allocations, got %', n; end if;
  if clinic_reception.due(i1) <> 0 or clinic_reception.due(i2) <> 0 then raise exception 'Invoices not settled'; end if;
  select count(*) into n from clinic_reception.journal j where j.workspace_id = w and j.source = 'invoice_payment_multi' and j.dimensions->>'payment_id' = pay.id::text;
  if n <> 2 then raise exception 'Expected 2 reception entries, got %', n; end if;
  if exists (select 1 from clinic_reception.journal j join clinic_reception.journal_lines l on l.entry_id = j.id
              where j.source = 'invoice_payment_multi' and j.dimensions->>'payment_id' = pay.id::text
                and not ((l.account = '1111' and l.debit = 500 and l.credit = 0) or (l.account = '1122' and l.credit = 500 and l.debit = 0))) then raise exception 'Lines are not Dr 1111 / Cr 1122 500'; end if;
  select count(*) into n from clinic_finance.entries e where e.source = 'reception_invoice_payment_multi' and e.shift_id = fsh
     and e.source_id in (select j.id from clinic_reception.journal j where j.dimensions->>'payment_id' = pay.id::text);
  if n <> 2 then raise exception 'Expected 2 finance entries on the shift, got %', n; end if;
  if (select coalesce(sum(l.debit), 0) from clinic_finance.entries e join clinic_finance.lines l on l.entry_id = e.id where e.shift_id = fsh and clinic_finance.is_cash_account(l.account)) <> 1000 then raise exception 'Cash on the finance shift is not 1,000'; end if;
  if exists (select 1 from clinic_finance.lines group by entry_id having sum(debit - credit) <> 0) then raise exception 'Unbalanced finance ledger'; end if;
  if exists (select 1 from clinic_reception.journal_lines group by entry_id having sum(debit - credit) <> 0) then raise exception 'Unbalanced reception journal'; end if;
  raise notice 'collect_multi cash live rollback OK: receipt %, 2 allocations, 2 entries Dr cash / Cr 1122 on finance shift %', pay.receipt_no, fsh;
end $$;
rollback;
select jsonb_build_object('test', 'collect_multi cash live rollback passed',
  'migration_left_applied', to_regprocedure('clinic_reception.collect_multi(uuid,jsonb,uuid)') is not null,
  'remaining_test_payments', (select count(*) from clinic_reception.payments where reference like 'ROLLBACK-MULTI-%'));
