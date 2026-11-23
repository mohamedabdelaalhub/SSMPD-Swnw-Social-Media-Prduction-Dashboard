-- «دفعة واحدة من شخص واحد لأكتر من مريض» (owner 2026-11-23, main chat 4: ONE transfer of 1000 paid two FRIENDS' visits; they are not
-- relatives, so a family link would be false; mockup docs/ui-references/mockups/collect-multi-one-payer-*).
--   * collect_multi payload one_payer = true: the visits may belong to ANY patient of the workspace (still unpaid, not package, 2..10),
--     with a mandatory note (≥ 5 letters: who paid for whom). Everything else is the 20261122160000 path: ONE payment row → one reference,
--     one proof, one receipt_no; each invoice posts to its own patient; a surplus stays the payer's credit.
--   * the payment is flagged payments.cross_patient (when a visit is outside the payer's family) and audited 'collect_multi_cross'
--     (patients + note). It appears in the reviewer inbox (public.clinic_review_inbox, source 'rx_cross_payment') for a reception
--     reviewer who did not collect it: «اطّلعت» (ok) or «عليها ملاحظة» (questioned, note required) through the new reception command
--     'cross_payment_review'. The review never moves money.
-- In-place anchors (each must match once; old bodies saved in clinic_reception.one_payer_saved_defs) + one outer command wrapper.
-- Rollback: supabase/rollbacks/20261122380000_collect_multi_one_payer.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_reception.collect_multi(uuid,jsonb,uuid)') is null then raise exception 'طبّق الدفعة لأكتر من زيارة (20261122160000) أولًا'; end if;
  if to_regprocedure('clinic_reception.command_before_cross_payment(uuid,text,jsonb,uuid)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter table clinic_reception.payments
  add column cross_patient boolean not null default false,
  add column cross_review_status text check (cross_review_status in ('ok', 'questioned')),
  add column cross_review_note text check (cross_review_note is null or length(cross_review_note) <= 300),
  add column cross_reviewed_by uuid references public.admins(id),
  add column cross_reviewed_at timestamptz;

create table clinic_reception.one_payer_saved_defs(name text primary key, def text not null);
alter table clinic_reception.one_payer_saved_defs enable row level security;
revoke all on clinic_reception.one_payer_saved_defs from public, anon, authenticated;
insert into clinic_reception.one_payer_saved_defs values ('collect_multi', pg_get_functiondef('clinic_reception.collect_multi(uuid,jsonb,uuid)'::regprocedure));
do $$ begin
  if to_regprocedure('public.clinic_review_inbox()') is not null then
    insert into clinic_reception.one_payer_saved_defs values ('clinic_review_inbox', pg_get_functiondef('public.clinic_review_inbox()'::regprocedure));
  end if;
end $$;

-- collect_multi: one payer for other patients' visits (note required), flag + audit
do $$ declare d text := pg_get_functiondef('clinic_reception.collect_multi(uuid,jsonb,uuid)'::regprocedure); i int := 1; e text[] := array[
  $a$  fam := clinic_reception.family_ids(payer);$a$,
  $a$  fam := clinic_reception.family_ids(payer);
  if coalesce((p_payload->>'one_payer')::boolean, false) then   -- one person paid for other patients' visits (20261122380000)
    if v_note is null or length(v_note) < 5 then raise exception 'اكتب في «ملاحظة» مين دفع عن مين (اسم اللي دفع والسبب)'; end if;
    fam := fam || coalesce((select array_agg(inv.patient_id) from clinic_reception.invoices inv where inv.id = any(ids) and inv.workspace_id = p_workspace), array[]::uuid[]);
  end if;$a$,
  $a$  insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id) values (p_workspace, me, 'collect_multi', v);$a$,
  $a$  insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id) values (p_workspace, me, 'collect_multi', v);
  if coalesce((p_payload->>'one_payer')::boolean, false) and exists (select 1 from clinic_reception.invoices inv where inv.id = any(ids)
       and not (inv.patient_id = any(clinic_reception.family_ids(payer)))) then
    update clinic_reception.payments set cross_patient = true where id = v;
    insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
      values (p_workspace, me, 'collect_multi_cross', v, jsonb_build_object('note', v_note, 'amount', amount,
        'patients', (select jsonb_agg(distinct inv.patient_id) from clinic_reception.invoices inv where inv.id = any(ids))));
  end if;$a$];
begin
  while i < array_length(e, 1) loop
    if (length(d) - length(replace(d, e[i], ''))) <> length(e[i]) then raise exception 'collect_multi patch % not found once', (i + 1) / 2; end if;
    d := replace(d, e[i], e[i + 1]); i := i + 2;
  end loop;
  execute d;
end $$;

-- reception command: 'cross_payment_review' {id, approve, note}
do $$ begin
  alter function public.clinic_reception_command(uuid, text, jsonb, uuid) rename to command_before_cross_payment;
  alter function public.command_before_cross_payment(uuid, text, jsonb, uuid) set schema clinic_reception;
end $$;
revoke all on function clinic_reception.command_before_cross_payment(uuid, text, jsonb, uuid) from public, anon, authenticated;

create function public.clinic_reception_command(p_workspace uuid, p_action text, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid; pay clinic_reception.payments%rowtype; ok boolean; why text;
begin
  if p_action <> 'cross_payment_review' then
    return clinic_reception.command_before_cross_payment(p_workspace, p_action, p_payload, p_token);
  end if;
  me := clinic_reception.access(p_workspace, 'review');
  select * into pay from clinic_reception.payments where id = nullif(p_payload->>'id', '')::uuid and workspace_id = p_workspace for update;
  if not found or not pay.cross_patient then raise exception 'الدفعة دي مش دفعة لأكتر من مريض'; end if;
  if pay.created_by = me then raise exception 'المراجعة لازم تكون من شخص تاني غير اللي حصّل' using errcode = '42501'; end if;
  if pay.cross_review_status is not null then raise exception 'الدفعة دي اتراجعت قبل كده'; end if;
  ok := coalesce((p_payload->>'approve')::boolean, true);
  why := nullif(left(btrim(coalesce(p_payload->>'note', '')), 300), '');
  if not ok and (why is null or length(why) < 3) then raise exception 'اكتب الملاحظة'; end if;
  update clinic_reception.payments set cross_review_status = case when ok then 'ok' else 'questioned' end, cross_review_note = why,
    cross_reviewed_by = me, cross_reviewed_at = now() where id = pay.id;
  insert into clinic_reception.audit(workspace_id, actor_id, action, entity_id, detail)
    values (p_workspace, me, 'cross_payment_review', pay.id, jsonb_build_object('ok', ok, 'note', why));
  return jsonb_build_object('id', pay.id, 'status', case when ok then 'ok' else 'questioned' end);
end $$;
revoke all on function public.clinic_reception_command(uuid, text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_reception_command(uuid, text, jsonb, uuid) to authenticated;

-- reviewer inbox: cross-patient payments waiting for a look (reception 'review' on the live workspace)
do $$ declare d text; a text := $a$ and (dr.percent <= 15 or rx_fin);
      reqs := reqs || part;
    exception when others then null; end;$a$;
begin
  if to_regprocedure('public.clinic_review_inbox()') is null then return; end if;
  d := pg_get_functiondef('public.clinic_review_inbox()'::regprocedure);
  if (length(d) - length(replace(d, a, ''))) <> length(a) then raise exception 'clinic_review_inbox anchor not found once'; end if;
  execute replace(d, a, a || $b$
    begin
      select coalesce(jsonb_agg(jsonb_build_object('source', 'rx_cross_payment', 'id', p.id, 'kind', 'cross_payment', 'amount', p.amount,
          'reason', p.note, 'by', coalesce(nullif(trim(ad.name), ''), ad.email), 'at', p.created_at, 'mine', p.created_by = me,
          'patient', pt.name, 'method', p.method, 'reference', p.reference, 'receipt_no', p.receipt_no,
          'patients', (select jsonb_agg(distinct x.name) from clinic_reception.allocations al join clinic_reception.invoices iv on iv.id = al.invoice_id
                        join clinic_reception.patients x on x.id = iv.patient_id where al.payment_id = p.id),
          'rpc', 'clinic_reception_command', 'action', 'cross_payment_review', 'workspace_id', p.workspace_id) order by p.created_at), '[]'::jsonb)
        into part
        from clinic_reception.payments p
        left join public.admins ad on ad.id = p.created_by
        left join clinic_reception.patients pt on pt.id = p.patient_id
       where p.workspace_id = ws and p.cross_patient and p.cross_review_status is null;
      reqs := reqs || part;
    exception when others then null; end;$b$);
end $$;

commit;
