-- «تشغيل اليوم» reviewer inbox (owner 2026-11-22 «طبق يلا», mockup docs/ui-references/mockups/today-reviewer-inbox.*):
-- «تشغيل اليوم للمحاسب يظهرله الخزينة الرئيسية، والورديات المفتوحة علشان يستلمها والطلبات زي الإلغاء أو الصرف للمستحقات وهكذا، واللي
-- يخلصه يختفي، ولما يجيله طلبات تظهرله تاني».
-- public.clinic_review_inbox() is READ-ONLY. It only collects what already waits for a second person, and every section is included only
-- when the caller passes that source's OWN existing permission check:
--   * treasury        clinic_finance.allowed('view')  → clinic_finance_main_treasury_balance() + clinic_finance_main_count_status()
--   * finance shifts  clinic_finance.shifts 'submitted' → clinic_finance.allowed('review') (clinic_finance_review_shift)
--                     — a shift opened from reception (clinic_reception.shifts.finance_shift_id) is reviewed through the reception path
--                       (clinic_reception_command 'shift_review') and needs the reception 'review' access on the live workspace
--   * handovers       clinic_finance.treasury_transfers 'pending' → allowed('review') (clinic_finance_treasury_command 'transfer_review')
--   * reception requests / discounts (live workspace) → clinic_reception.access(ws,'review') (+ 'finance_review' for a discount > 15%)
--   * finance requests, doctor payouts (non-desk), business requests, booking advances, supplier actions → allowed('review')
--   * desk doctor payouts (صرف من الاستقبال) → clinic_finance.desk_approver()
-- Each item carries the EXISTING RPC + action the screen calls to approve / reject (no new write path) and mine=true when the caller
-- created it (maker ≠ checker: the screen hides «اعتماد»; the RPCs refuse it anyway). Open shifts are listed read-only.
-- Optional sources that do not exist on a given database are skipped (each section is its own exception block).
-- Rollback: supabase/rollbacks/20261122250000_review_inbox.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.clinic_review_inbox()') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if to_regprocedure('clinic_finance.allowed(text)') is null or to_regclass('clinic_reception.requests') is null then
    raise exception 'مكونات الحسابات أو الاستقبال غير موجودة'; end if;
end $$;

create function public.clinic_review_inbox() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare
  me uuid := public.my_admin_id();
  fin_view boolean := false; fin_review boolean := false; desk boolean := false; rx boolean := false; rx_fin boolean := false;
  ws uuid; treasury jsonb; submitted jsonb := '[]'::jsonb; open_shifts jsonb := '[]'::jsonb; handovers jsonb := '[]'::jsonb;
  reqs jsonb := '[]'::jsonb; part jsonb;
begin
  if me is null or not exists (select 1 from public.admins where id = me and active) then raise exception 'سجل الدخول' using errcode = '42501'; end if;
  fin_view := clinic_finance.allowed('view');
  fin_review := clinic_finance.allowed('review');
  begin desk := clinic_finance.desk_approver(); exception when others then desk := false; end;
  select id into ws from clinic_reception.workspaces where mode = 'live' order by id limit 1;
  if ws is not null then
    begin perform clinic_reception.access(ws, 'review'); rx := true; exception when others then rx := false; end;
    if rx then begin perform clinic_reception.access(ws, 'finance_review'); rx_fin := true; exception when others then rx_fin := false; end; end if;
  end if;
  if not (fin_view or fin_review or desk or rx) then
    return jsonb_build_object('visible', false, 'requests', '[]'::jsonb, 'shifts', '[]'::jsonb, 'handovers', '[]'::jsonb,
                              'open_shifts', '[]'::jsonb, 'counts', jsonb_build_object('total', 0));
  end if;

  -- main treasury
  if fin_view then
    begin
      treasury := public.clinic_finance_main_treasury_balance();
      begin treasury := treasury || jsonb_build_object('count', public.clinic_finance_main_count_status());
      exception when others then null; end;
    exception when others then treasury := null; end;
  end if;

  -- closed shifts waiting for review (+ open ones, read-only)
  if fin_review or rx then
    begin
      select coalesce(jsonb_agg(jsonb_build_object(
          'id', s.id, 'register', r.name, 'cashier', coalesce(nullif(trim(a.name), ''), a.email), 'closed_at', s.closed_at,
          'counted', s.counted, 'expected', round(clinic_finance.shift_cash(s.id), 2),
          'difference', round(coalesce(s.counted, 0) - clinic_finance.shift_cash(s.id), 2), 'mine', s.cashier_id = me,
          'rpc', case when rs.id is not null then 'clinic_reception_command' else 'clinic_finance_review_shift' end,
          'action', case when rs.id is not null then 'shift_review' else null end,
          'target_id', coalesce(rs.id, s.id), 'workspace_id', rs.workspace_id) order by s.closed_at), '[]'::jsonb)
        into submitted
        from clinic_finance.shifts s join clinic_finance.registers r on r.id = s.register_id
        left join public.admins a on a.id = s.cashier_id
        left join clinic_reception.shifts rs on rs.finance_shift_id = s.id
       where s.status = 'submitted' and ((rs.id is null and fin_review) or (rs.id is not null and rx and rs.workspace_id = ws));
      select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'register', r.name, 'cashier', coalesce(nullif(trim(a.name), ''), a.email),
          'opened_at', s.opened_at, 'expected', round(clinic_finance.shift_cash(s.id), 2), 'mine', s.cashier_id = me) order by s.opened_at), '[]'::jsonb)
        into open_shifts
        from clinic_finance.shifts s join clinic_finance.registers r on r.id = s.register_id
        left join public.admins a on a.id = s.cashier_id
       where s.status = 'open' and coalesce(to_jsonb(r)->>'treasury_kind', '') <> 'main';
    exception when others then null; end;
  end if;

  -- cash handovers to the main treasury
  if fin_review then
    begin
      select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'amount', t.amount, 'reference', t.reference, 'reason', t.reason,
          'by', coalesce(nullif(trim(a.name), ''), a.email), 'at', t.created_at, 'mine', t.created_by = me,
          'rpc', 'clinic_finance_treasury_command', 'action', 'transfer_review') order by t.created_at), '[]'::jsonb)
        into handovers
        from clinic_finance.treasury_transfers t left join public.admins a on a.id = t.created_by
       where t.status = 'pending';
    exception when others then null; end;
  end if;

  -- reception correction requests (service void, visit void, method fix, refund, credit note, payouts …)
  if rx then
    begin
      select coalesce(jsonb_agg(jsonb_build_object('source', 'rx_request', 'id', q.id, 'kind', q.kind, 'amount', q.amount,
          'reason', q.reason, 'by', coalesce(nullif(trim(a.name), ''), a.email), 'at', q.created_at, 'mine', q.created_by = me,
          'visit_void', coalesce((q.payload->>'visit_void')::boolean, false), 'visit_no', v.visit_no, 'patient', pt.name,
          'rpc', 'clinic_reception_command', 'action', 'request_review', 'workspace_id', q.workspace_id) order by q.created_at), '[]'::jsonb)
        into part
        from clinic_reception.requests q
        left join public.admins a on a.id = q.created_by
        left join clinic_reception.invoices i on i.id = q.subject_id
        left join clinic_reception.orders o on o.id = i.order_id
        left join clinic_reception.visits v on v.id = coalesce(case when q.payload->>'visit_id' ~* '^[0-9a-f-]{36}$' then (q.payload->>'visit_id')::uuid end, o.visit_id)
        left join clinic_reception.patients pt on pt.id = v.patient_id
       where q.workspace_id = ws and q.status = 'pending';
      reqs := reqs || part;
    exception when others then null; end;
    begin
      select coalesce(jsonb_agg(jsonb_build_object('source', 'rx_discount', 'id', dr.id, 'kind', 'discount', 'percent', dr.percent,
          'amount', round(coalesce(o.price, 0) * coalesce(o.quantity, 1) * dr.percent / 100, 2), 'service', o.snapshot->>'name',
          'reason', dr.reason, 'by', coalesce(nullif(trim(a.name), ''), a.email), 'mine', dr.created_by = me, 'patient', pt.name,
          'visit_no', v.visit_no, 'rpc', 'clinic_reception_command', 'action', 'discount_review', 'workspace_id', dr.workspace_id)), '[]'::jsonb)
        into part
        from clinic_reception.discount_requests dr
        left join public.admins a on a.id = dr.created_by
        left join clinic_reception.orders o on o.id = dr.order_id
        left join clinic_reception.visits v on v.id = o.visit_id
        left join clinic_reception.patients pt on pt.id = v.patient_id
       where dr.workspace_id = ws and dr.status = 'pending' and (dr.percent <= 15 or rx_fin);
      reqs := reqs || part;
    exception when others then null; end;
  end if;

  if fin_review then
    begin
      select coalesce(jsonb_agg(jsonb_build_object('source', 'fin_request', 'id', q.id, 'kind', q.kind, 'amount', q.amount, 'reason', q.reason,
          'by', coalesce(nullif(trim(a.name), ''), a.email), 'at', q.created_at, 'mine', q.created_by = me,
          'rpc', 'clinic_finance_review_request') order by q.created_at), '[]'::jsonb)
        into part from clinic_finance.requests q left join public.admins a on a.id = q.created_by where q.status = 'pending';
      reqs := reqs || part;
    exception when others then null; end;
    begin
      select coalesce(jsonb_agg(jsonb_build_object('source', 'doctor_payout', 'id', p.id, 'kind', 'doctor_payout', 'amount', p.gross - p.withheld,
          'reason', p.reference, 'doctor', coalesce(p.payload->>'doctor_name', p.doctor_key), 'by', coalesce(nullif(trim(a.name), ''), a.email),
          'at', p.created_at, 'mine', p.created_by = me, 'rpc', 'clinic_finance_doctor_command', 'action', 'payout_review') order by p.created_at), '[]'::jsonb)
        into part from clinic_finance.doctor_payouts p left join public.admins a on a.id = p.created_by
       where p.status = 'pending' and not exists (select 1 from clinic_finance.desk_payouts d where d.payout_id = p.id);
      reqs := reqs || part;
    exception when undefined_table then
      select coalesce(jsonb_agg(jsonb_build_object('source', 'doctor_payout', 'id', p.id, 'kind', 'doctor_payout', 'amount', p.gross - p.withheld,
          'reason', p.reference, 'doctor', coalesce(p.payload->>'doctor_name', p.doctor_key), 'by', coalesce(nullif(trim(a.name), ''), a.email),
          'at', p.created_at, 'mine', p.created_by = me, 'rpc', 'clinic_finance_doctor_command', 'action', 'payout_review') order by p.created_at), '[]'::jsonb)
        into part from clinic_finance.doctor_payouts p left join public.admins a on a.id = p.created_by where p.status = 'pending';
      reqs := reqs || part;
    when others then null; end;
    begin
      select coalesce(jsonb_agg(jsonb_build_object('source', 'business', 'id', b.id, 'kind', b.kind, 'amount', b.amount, 'reason', b.subject,
          'by', coalesce(nullif(trim(a.name), ''), a.email), 'at', b.created_at, 'mine', b.created_by = me,
          'rpc', 'clinic_finance_business_command', 'action', 'review') order by b.created_at), '[]'::jsonb)
        into part from clinic_finance.business_requests b left join public.admins a on a.id = b.created_by where b.status = 'pending';
      reqs := reqs || part;
    exception when others then null; end;
    begin
      select coalesce(jsonb_agg(jsonb_build_object('source', 'booking_advance', 'id', x.id, 'kind', 'booking_advance', 'amount', x.amount,
          'reason', x.reference, 'patient', x.patient_ref, 'method', x.method, 'by', coalesce(nullif(trim(a.name), ''), a.email), 'at', x.created_at,
          'mine', x.created_by = me, 'rpc', 'clinic_booking_command', 'action', 'verify') order by x.created_at), '[]'::jsonb)
        into part from clinic_finance.advances x left join public.admins a on a.id = x.created_by where x.status = 'pending';
      reqs := reqs || part;
    exception when others then null; end;
    begin
      select coalesce(jsonb_agg(jsonb_build_object('source', 'supplier', 'id', s.id, 'kind', s.kind, 'amount', s.amount, 'reason', s.note,
          'supplier', su.name, 'by', coalesce(nullif(trim(a.name), ''), a.email), 'at', s.created_at, 'mine', s.created_by = me,
          'rpc', 'clinic_finance_supplier_command', 'action', 'review') order by s.created_at), '[]'::jsonb)
        into part from clinic_finance.supplier_actions s left join public.admins a on a.id = s.created_by
        left join public.inventory_suppliers su on su.id = s.supplier_id where s.status = 'pending';
      reqs := reqs || part;
    exception when others then null; end;
  end if;

  -- doctor payouts requested at the reception desk
  if desk then
    begin
      select coalesce(jsonb_agg(jsonb_build_object('source', 'desk_payout', 'id', p.id, 'kind', 'desk_payout', 'amount', p.gross - p.withheld,
          'reason', p.reference, 'doctor', pr.name, 'by', coalesce(nullif(trim(a.name), ''), a.email), 'at', p.created_at, 'mine', p.created_by = me,
          'rpc', 'clinic_reception_doctor_payout') order by p.created_at), '[]'::jsonb)
        into part from clinic_finance.doctor_payouts p join clinic_finance.desk_payouts d on d.payout_id = p.id
        left join clinic_reception.providers pr on pr.id = d.provider_id
        left join public.admins a on a.id = p.created_by where p.status = 'pending';
      reqs := reqs || part;
    exception when others then null; end;
  end if;

  return jsonb_build_object('visible', true, 'can_review', fin_review or rx or desk, 'treasury', treasury,
    'shifts', submitted, 'open_shifts', open_shifts, 'handovers', handovers, 'requests', reqs,
    'counts', jsonb_build_object(
      'shifts', (select count(*) from jsonb_array_elements(submitted) e where not coalesce((e->>'mine')::boolean, false)),
      'handovers', (select count(*) from jsonb_array_elements(handovers) e where not coalesce((e->>'mine')::boolean, false)),
      'requests', (select count(*) from jsonb_array_elements(reqs) e where not coalesce((e->>'mine')::boolean, false)),
      'total', (select count(*) from jsonb_array_elements(submitted || handovers || reqs) e where not coalesce((e->>'mine')::boolean, false))));
end $$;
revoke all on function public.clinic_review_inbox() from public, anon;
grant execute on function public.clinic_review_inbox() to authenticated;

notify pgrst, 'reload schema';
commit;
