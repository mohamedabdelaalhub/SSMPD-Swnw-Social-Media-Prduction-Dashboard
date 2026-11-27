-- «راجع وعدّل قبل ما الفلوس تتحرك» (owner 2026-11-27: «عايز لما موظف يدوس زرار تحصيل من حد او صرف مستحقات لحد تظهرله تفاصيل
-- التحصيل او الصرف دا كاملة قابلة للتعديل علشان قبل ما يحصل او يصرف فلوس يقدر يراجع التفاصيل ويعدلها اذا استدعت الحاجة»;
-- mockup docs/ui-references/mockups/review-before-money.html approved «موافق على الاقتراحين، ابدأ التنفيذ»).
--   1) public.clinic_reception_collect_review(workspace, patient) — READ ONLY. The patient's visits that still owe money (or are
--      open with a service not executed yet): each service with price → discount (who asked / who approved, or pending) → payer (claim entity) → owed,
--      the totals, the patient credit and his receipts in MY open shift. Edits in the UI go through the existing card actions.
--   2) «صرف حساب الطبيب» (owner Q1 «يقدر، أقل بس، والمعتمد يشوف السبب»): action 'request' accepts payload.remove (invoice ids to
--      leave out — they stay payable for the next payout) and payload.gross (a LOWER amount) with a mandatory payload.note.
--      Never above the computed amount of the cases kept. The request still waits for the approver (maker-checker unchanged),
--      who sees the computed amount, the removed cases and the reason (reception_review in every payout JSON).
--   3) «طلب صرف من الدرج» (owner Q2 «يتلغي»): action 'pay' accepts p.amount LOWER than the approved amount with p.note; the
--      request is paid with that amount and the rest is cancelled (a new request is needed for it). Never above the approved amount.
--      The approved amount and the note are kept (clinic_finance.drawer_pay_less) and shown in every row (approved_amount).
-- Two outer wrappers (rename-and-wrap); the previous functions are kept as clinic_finance.doctor_payout_before_review and
-- clinic_finance.drawer_request_before_pay_less with the same grants. Nothing removed.
-- Rollback: supabase/rollbacks/20261127140000_review_before_money.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.clinic_reception_doctor_payout(text,jsonb,uuid)') is null or to_regclass('clinic_finance.desk_payouts') is null
     or to_regclass('clinic_finance.desk_payout_rx') is null or to_regprocedure('public.clinic_finance_drawer_request(text,jsonb)') is null
     or to_regclass('clinic_finance.drawer_requests') is null or to_regprocedure('clinic_reception.due(uuid)') is null
     or to_regprocedure('clinic_reception.access(uuid,text)') is null then
    raise exception 'مكونات التحصيل أو صرف الأطباء أو طلبات الدرج غير موجودة'; end if;
  if to_regprocedure('public.clinic_reception_collect_review(uuid,uuid)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

-- ---------------------------------------------------------------- 1) collect review (read only)
create function public.clinic_reception_collect_review(p_workspace uuid, p_patient uuid)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); pt record; v_visits jsonb; v_receipts jsonb; v_credit numeric := 0;
begin
  perform clinic_reception.access(p_workspace, 'collect');
  select p.id, p.name, p.file_no into pt from clinic_reception.patients p where p.id = p_patient and p.workspace_id = p_workspace;
  if not found then raise exception 'المريض مش موجود'; end if;
  begin v_credit := greatest(0, -clinic_reception.balance(p_workspace, '2150', 'patient_id', p_patient::text)); exception when others then v_credit := 0; end;

  select coalesce(jsonb_agg(x.j order by x.at_time desc), '[]') into v_visits from (
    select coalesce(ap.arrived_at, v.opened_at) at_time, jsonb_build_object(
      'id', v.id, 'visit_no', v.visit_no, 'status', v.status, 'appointment_id', v.appointment_id, 'at', coalesce(ap.arrived_at, v.opened_at),
      'provider', pr.name, 'payer_kind', to_jsonb(ap)->>'payer_kind',
      'discount_kind', to_jsonb(ap)->>'discount_kind', 'discount_percent', to_jsonb(ap)->'discount_percent', 'discount_reason', to_jsonb(ap)->>'discount_reason',
      'discount_by', (select coalesce(nullif(trim(to_jsonb(d)->>'name'), ''), 'موظف') from public.admins d where d.id = nullif(to_jsonb(ap)->>'discount_by', '')::uuid),
      'services', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', o.id, 'name', coalesce(o.snapshot->>'name', 'خدمة'), 'provider', po.name, 'status', o.status,
          'gross', round(o.price * o.quantity, 2), 'discount_percent', o.discount, 'discount', round(o.price * o.quantity * o.discount / 100, 2),
          'invoice_id', i.id, 'invoice_no', to_jsonb(i)->'invoice_no',
          'amount', coalesce(i.amount, round(o.price * o.quantity, 2) - round(o.price * o.quantity * o.discount / 100, 2)),
          'payer_amount', coalesce((to_jsonb(i)->>'payer_amount')::numeric, 0), 'payer', en.name,
          'paid', coalesce((select sum(a.amount) from clinic_reception.allocations a where a.invoice_id = i.id), 0),
          'owed', case when i.id is null then null else greatest(0, clinic_reception.due(i.id)) end,
          'approved', (select jsonb_build_object('percent', d.percent, 'reason', d.reason,
                         'by', (select coalesce(nullif(trim(to_jsonb(x1)->>'name'), ''), 'موظف') from public.admins x1 where x1.id = d.created_by),
                         'approved_by', (select coalesce(nullif(trim(to_jsonb(x2)->>'name'), ''), 'موظف') from public.admins x2 where x2.id = d.reviewed_by))
                         from clinic_reception.discount_requests d where d.order_id = o.id and d.status = 'approved' order by d.percent desc limit 1),
          'pending', (select jsonb_build_object('percent', d.percent, 'reason', d.reason,
                         'by', (select coalesce(nullif(trim(to_jsonb(x1)->>'name'), ''), 'موظف') from public.admins x1 where x1.id = d.created_by))
                         from clinic_reception.discount_requests d where d.order_id = o.id and d.status = 'pending' order by d.percent desc limit 1)
        ) order by o.created_at), '[]')
          from clinic_reception.orders o join clinic_reception.providers po on po.id = o.provider_id
          left join clinic_reception.invoices i on i.order_id = o.id
          left join clinic_reception.claims c on c.invoice_id = i.id
          left join clinic_reception.entities en on en.id = c.entity_id
         where o.visit_id = v.id and o.status <> 'cancelled')
    ) j
      from clinic_reception.visits v
      left join clinic_reception.appointments ap on ap.id = v.appointment_id
      left join clinic_reception.providers pr on pr.id = ap.provider_id
     where v.workspace_id = p_workspace and v.patient_id = p_patient
       and (exists (select 1 from clinic_reception.invoices i2 where i2.visit_id = v.id and clinic_reception.due(i2.id) > 0)
            or (v.status = 'open' and exists (select 1 from clinic_reception.orders o3 where o3.visit_id = v.id and o3.status not in ('cancelled', 'completed')
                                              and not exists (select 1 from clinic_reception.invoices i3 where i3.order_id = o3.id))))
     order by 1 desc limit 6) x;

  -- the patient's receipts in MY open reception shift
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'receipt_no', to_jsonb(p)->>'receipt_no', 'amount', p.amount, 'method', p.method,
           'reference', p.reference, 'at', p.created_at) order by p.created_at), '[]') into v_receipts
    from clinic_reception.payments p join clinic_reception.shifts s on s.id = p.shift_id
   where p.workspace_id = p_workspace and p.patient_id = p_patient and s.cashier_id = me and s.status = 'open';

  return jsonb_build_object('patient', jsonb_build_object('id', pt.id, 'name', pt.name, 'file_no', pt.file_no), 'credit', v_credit,
    'visits', v_visits, 'my_receipts', v_receipts,
    'totals', (select jsonb_build_object('amount', coalesce(sum((s->>'amount')::numeric), 0), 'payer', coalesce(sum((s->>'payer_amount')::numeric), 0),
                 'paid', coalesce(sum((s->>'paid')::numeric), 0), 'owed', coalesce(sum((s->>'owed')::numeric), 0))
                 from jsonb_array_elements(v_visits) vv, jsonb_array_elements(vv->'services') s));
end $$;
revoke all on function public.clinic_reception_collect_review(uuid, uuid) from public, anon;
grant execute on function public.clinic_reception_collect_review(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- 2) doctor payout: remove cases / ask lower, with a reason
create table clinic_finance.desk_payout_review (
  payout_id uuid primary key references clinic_finance.doctor_payouts(id),
  computed_full numeric(14,2) not null,
  kept numeric(14,2) not null,
  requested_gross numeric(14,2) not null check (requested_gross > 0),
  removed jsonb not null default '[]'::jsonb,
  note text not null check (length(btrim(note)) between 3 and 300),
  created_by uuid not null references public.admins(id),
  created_at timestamptz not null default now()
);
alter table clinic_finance.desk_payout_review enable row level security;
revoke all on clinic_finance.desk_payout_review from public, anon, authenticated;

create function clinic_finance.desk_review_merge(j jsonb) returns jsonb language sql stable security definer set search_path = pg_catalog, public as $$
  select case when jsonb_typeof(j) <> 'object' or nullif(j->>'id', '') is null then j else
    j || coalesce((select jsonb_build_object('reception_review', jsonb_build_object('computed_full', r.computed_full, 'kept', r.kept,
           'requested_gross', r.requested_gross, 'removed', r.removed, 'note', r.note,
           'by', (select coalesce(nullif(trim(to_jsonb(a)->>'name'), ''), 'موظف') from public.admins a where a.id = r.created_by)))
         from clinic_finance.desk_payout_review r where r.payout_id = (j->>'id')::uuid), '{}'::jsonb) end
$$;
revoke all on function clinic_finance.desk_review_merge(jsonb) from public, anon, authenticated;

alter function public.clinic_reception_doctor_payout(text, jsonb, uuid) rename to doctor_payout_before_review;
alter function public.doctor_payout_before_review(text, jsonb, uuid) set schema clinic_finance;

create function public.clinic_reception_doctor_payout(p_action text, p_payload jsonb, p_token uuid default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); out jsonb; qid uuid; rm uuid[]; note text; newg numeric; full_g numeric; kept numeric; removed jsonb; n_rm int; n_del int;
begin
  if p_action = 'request' and jsonb_typeof(p_payload) = 'object'
     and (jsonb_typeof(p_payload->'remove') = 'array' and jsonb_array_length(p_payload->'remove') > 0 or nullif(p_payload->>'gross', '') is not null) then
    -- a replayed token returns the first answer
    if me is not null and p_token is not null and exists (select 1 from clinic_finance.doctor_payouts where created_by = me and token = p_token) then
      return clinic_finance.desk_review_merge(clinic_finance.doctor_payout_before_review(p_action, p_payload, p_token));
    end if;
    note := btrim(coalesce(p_payload->>'note', ''));
    if length(note) < 3 then raise exception 'اكتب سبب التعديل (ليه شلت حالة أو طلبت أقل)'; end if;
    if length(note) > 300 then raise exception 'السبب طويل — 300 حرف بالكتير'; end if;
    begin
      select coalesce(array_agg(distinct x::uuid), '{}') into rm from jsonb_array_elements_text(coalesce(p_payload->'remove', '[]'::jsonb)) x;
      newg := nullif(p_payload->>'gross', '')::numeric;
    exception when others then raise exception 'راجع الحالات أو المبلغ'; end;
    if newg is not null and (newg <= 0 or newg <> round(newg, 2) or newg::text in ('NaN', 'Infinity', '-Infinity')) then raise exception 'المبلغ غير صالح'; end if;
    out := clinic_finance.doctor_payout_before_review(p_action, p_payload - 'remove' - 'gross' - 'note', p_token);
    qid := (out->>'id')::uuid;
    select gross into full_g from clinic_finance.doctor_payouts where id = qid;
    n_rm := coalesce(array_length(rm, 1), 0);
    removed := coalesce((select jsonb_agg(e order by e->>'created_at') from jsonb_array_elements(out->'invoices') e where (e->>'invoice_id')::uuid = any(rm)), '[]'::jsonb);
    if jsonb_array_length(removed) <> n_rm then raise exception 'في حالة مش موجودة في حساب الدكتور دلوقتي — حدّث الشاشة'; end if;
    if n_rm > 0 then
      delete from clinic_finance.doctor_payout_invoices where payout_id = qid and invoice_id = any(rm);
      get diagnostics n_del = row_count;
      delete from clinic_finance.desk_payout_rx where payout_id = qid and rx_invoice_id = any(rm);
    end if;
    kept := coalesce((select sum(fee) from clinic_finance.doctor_payout_invoices where payout_id = qid), 0)
          + coalesce((select sum(fee) from clinic_finance.desk_payout_rx where payout_id = qid), 0);
    if kept <= 0 then raise exception 'شلت كل الحالات — مفيش حاجة تتطلب'; end if;
    newg := coalesce(newg, kept);
    if newg > kept then raise exception 'مينفعش تطلب أكتر من المحسوب للحالات اللي فاضلة (%)', rtrim(to_char(kept, 'FM999999990.99'), '.'); end if;
    if newg <> full_g then
      update clinic_finance.doctor_payouts set gross = newg,
             payload = payload || jsonb_build_object('gross', newg, 'net', newg, 'reception_computed', full_g, 'reception_kept', kept,
                                                     'invoice_ids', coalesce((select jsonb_agg(e->'invoice_id') from jsonb_array_elements(out->'invoices') e
                                                                             where not ((e->>'invoice_id')::uuid = any(rm))), '[]'::jsonb))
       where id = qid;
    end if;
    insert into clinic_finance.desk_payout_review(payout_id, computed_full, kept, requested_gross, removed, note, created_by)
      values (qid, full_g, kept, newg, removed, note, me);
    insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'desk_payout_request_review', qid,
      jsonb_build_object('computed', full_g, 'kept', kept, 'requested', newg, 'removed', n_rm, 'note', note));
    return clinic_finance.desk_review_merge(clinic_finance.desk_payout_json((select q from clinic_finance.doctor_payouts q where q.id = qid)));
  end if;

  out := clinic_finance.doctor_payout_before_review(p_action, p_payload, p_token);
  if p_action = 'detail' and jsonb_typeof(out->'payouts') = 'array' then
    out := jsonb_set(out, '{payouts}', coalesce((select jsonb_agg(clinic_finance.desk_review_merge(e) order by o) from jsonb_array_elements(out->'payouts') with ordinality t(e, o)), '[]'::jsonb));
    -- per case: list price and discount of the reception order (for «راجع قبل ما تطلب الصرف»)
    if jsonb_typeof(out->'invoices') = 'array' then
      out := jsonb_set(out, '{invoices}', coalesce((select jsonb_agg(e || coalesce((
          select jsonb_build_object('gross', round(o2.price * o2.quantity, 2), 'discount', round(o2.price * o2.quantity * o2.discount / 100, 2),
                                    'payer_amount', i2.payer_amount, 'patient', pt.name)
            from clinic_reception.invoices i2 join clinic_reception.orders o2 on o2.id = i2.order_id
            left join clinic_reception.patients pt on pt.id = i2.patient_id
           where i2.id = (e->>'invoice_id')::uuid), '{}'::jsonb) order by o) from jsonb_array_elements(out->'invoices') with ordinality t(e, o)), '[]'::jsonb));
    end if;
  elsif p_action = 'pending_list' and jsonb_typeof(out->'items') = 'array' then
    out := jsonb_set(out, '{items}', coalesce((select jsonb_agg(clinic_finance.desk_review_merge(e) order by o) from jsonb_array_elements(out->'items') with ordinality t(e, o)), '[]'::jsonb));
  elsif p_action in ('request', 'approve', 'reject', 'handover', 'receipt') then
    out := clinic_finance.desk_review_merge(out);
  end if;
  return out;
end $$;

-- ---------------------------------------------------------------- 3) drawer payout: pay less, the rest is cancelled
create table clinic_finance.drawer_pay_less (
  request_id uuid primary key references clinic_finance.drawer_requests(id),
  approved_amount numeric(14,2) not null,
  paid_amount numeric(14,2) not null check (paid_amount > 0),
  note text not null check (length(btrim(note)) between 3 and 300),
  created_by uuid not null references public.admins(id),
  created_at timestamptz not null default now(),
  check (paid_amount < approved_amount)
);
alter table clinic_finance.drawer_pay_less enable row level security;
revoke all on clinic_finance.drawer_pay_less from public, anon, authenticated;

create function clinic_finance.drawer_row_merge(j jsonb) returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
begin
  return case when jsonb_typeof(j) <> 'object' or nullif(j->>'id', '') is null then j else
    j || coalesce((select jsonb_build_object('approved_amount', l.approved_amount, 'pay_less_note', l.note, 'cancelled_rest', l.approved_amount - l.paid_amount)
                     from clinic_finance.drawer_pay_less l where l.request_id = (j->>'id')::uuid), '{}'::jsonb)
      || case when j->>'kind' = 'advance' and nullif(j->>'subject', '') is not null and to_regprocedure('clinic_finance.employee_advance(text)') is not null
                   and (j->>'mine')::boolean is true and not (j ? 'employee_advance')
              then jsonb_build_object('employee_advance', clinic_finance.employee_advance(j->>'subject')) else '{}'::jsonb end end;
end $$;
revoke all on function clinic_finance.drawer_row_merge(jsonb) from public, anon, authenticated;

alter function public.clinic_finance_drawer_request(text, jsonb) rename to drawer_request_before_pay_less;
alter function public.drawer_request_before_pay_less(text, jsonb) set schema clinic_finance;

create function public.clinic_finance_drawer_request(p_action text, p jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); r clinic_finance.drawer_requests%rowtype; amt numeric; note text; out jsonb;
begin
  p := coalesce(p, '{}'::jsonb);
  if p_action = 'pay' and nullif(p->>'amount', '') is not null then
    if me is null then raise exception 'سجل الدخول تاني' using errcode = '42501'; end if;
    perform clinic_finance.lock_day();
    select * into r from clinic_finance.drawer_requests where id = (p->>'id')::uuid for update;
    if not found or r.requested_by <> me then raise exception 'الطلب مش موجود'; end if;
    if r.status = 'approved' then
      begin amt := (p->>'amount')::numeric; exception when others then raise exception 'راجع المبلغ'; end;
      if amt is null or amt <= 0 or amt <> round(amt, 2) or amt::text in ('NaN', 'Infinity', '-Infinity') then raise exception 'المبلغ غير صالح'; end if;
      if amt > r.amount then raise exception 'مينفعش تصرف أكتر من المبلغ المعتمد (%)', rtrim(to_char(r.amount, 'FM999999990.99'), '.'); end if;
      if amt < r.amount then
        note := btrim(coalesce(p->>'note', ''));
        if length(note) < 3 then raise exception 'اكتب ليه هتصرف أقل من المعتمد'; end if;
        if length(note) > 300 then raise exception 'الملاحظة طويلة — 300 حرف بالكتير'; end if;
        insert into clinic_finance.drawer_pay_less(request_id, approved_amount, paid_amount, note, created_by) values (r.id, r.amount, amt, note, me);
        update clinic_finance.drawer_requests set amount = amt where id = r.id;
        insert into clinic_finance.audit(actor, action, entity_id, detail) values (me, 'drawer_pay_less', r.id,
          jsonb_build_object('approved', r.amount, 'paid', amt, 'cancelled', r.amount - amt, 'note', note));
      end if;
    end if;
    return clinic_finance.drawer_row_merge(clinic_finance.drawer_request_before_pay_less(p_action, p - 'amount' - 'note'));
  end if;

  out := clinic_finance.drawer_request_before_pay_less(p_action, p);
  if p_action = 'status' and jsonb_typeof(out) = 'object' then
    if jsonb_typeof(out->'mine') = 'array' then
      out := jsonb_set(out, '{mine}', coalesce((select jsonb_agg(clinic_finance.drawer_row_merge(e) order by o) from jsonb_array_elements(out->'mine') with ordinality t(e, o)), '[]'::jsonb)); end if;
    if jsonb_typeof(out->'inbox') = 'array' then
      out := jsonb_set(out, '{inbox}', coalesce((select jsonb_agg(clinic_finance.drawer_row_merge(e) order by o) from jsonb_array_elements(out->'inbox') with ordinality t(e, o)), '[]'::jsonb)); end if;
  elsif p_action = 'list' and jsonb_typeof(out->'items') = 'array' then
    out := jsonb_set(out, '{items}', coalesce((select jsonb_agg(clinic_finance.drawer_row_merge(e) order by o) from jsonb_array_elements(out->'items') with ordinality t(e, o)), '[]'::jsonb));
  elsif p_action in ('request', 'review', 'cancel', 'pay') then
    out := clinic_finance.drawer_row_merge(out);
  end if;
  return out;
end $$;

-- each wrapper gets exactly the privileges of the function it wraps
do $$ declare r record; pair text[]; begin
  foreach pair slice 1 in array array[['clinic_finance.doctor_payout_before_review(text,jsonb,uuid)', 'public.clinic_reception_doctor_payout(text,jsonb,uuid)'],
                                      ['clinic_finance.drawer_request_before_pay_less(text,jsonb)', 'public.clinic_finance_drawer_request(text,jsonb)']] loop
    execute format('revoke all on function %s from public, anon, authenticated', pair[2]);
    for r in select a.grantee, a.privilege_type from pg_proc pp, aclexplode(coalesce(pp.proacl, acldefault('f', pp.proowner))) a
              where pp.oid = pair[1]::regprocedure and a.grantee <> pp.proowner loop
      execute format('grant %s on function %s to %s', r.privilege_type, pair[2], case when r.grantee = 0 then 'public' else quote_ident(pg_get_userbyid(r.grantee)) end);
    end loop;
    execute format('revoke all on function %s from public, anon, authenticated', pair[1]);
  end loop;
end $$;

commit;
