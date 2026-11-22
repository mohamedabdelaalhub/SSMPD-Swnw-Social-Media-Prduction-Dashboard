-- «دفعة واحدة لأكتر من زيارة» + «ملاحظة» on every collection (Manar's case 2026-11-22: ONE e-wallet transfer of 1,000 paid two
-- visits of 500 each, for the payer and a family member). Before this the second visit could not use the same reference
-- (unique per method family) nor the same transfer proof (one proof → one payment).
--   action 'collect_multi' (public.clinic_reception_command, wrapped → clinic_reception.command_before_collect_multi):
--     payload {patient_id (payer), method, reference, shift_id (cash / pos), amount, invoice_ids [2..10], note}
--     * ONE clinic_reception.payments row → one reference, one proof, one receipt_no (existing triggers);
--     * invoices: the payer's or a family member's (clinic_reception.family_ids), unpaid, not package invoices, in the given
--       order; each gets its allocation (payment_id = the one payment) and its OWN posting line
--       Dr account(method) / Cr 1122 with dims patient_id = that invoice's patient, payment_id, invoice_id, shift_id
--       (journal source 'invoice_payment_multi', source_id = the allocation id → unique per line);
--     * the amount is applied in the given order up to each due; anything left after all invoices → the payer's credit 2150
--       (same as collect); an amount below the total due leaves the rest due on the later invoices.
--     * same checks as collect: access 'collect', own open shift for cash / pos, collection register, reference never used
--       before (clinic_reception.check_money_reference), finance day lock and stock sync in live mode; idempotent per token.
--   payments.note (≤ 300): optional free note, stored for 'collect', 'collect_split' parts and 'collect_multi'; shown on the
--     receipt. A note never changes amounts.
-- Nothing is deleted; reversal stays the existing refund / review path per payment.
-- Rollback: supabase/rollbacks/20261122160000_reception_collect_multi.rollback.sql
begin;

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

commit;
