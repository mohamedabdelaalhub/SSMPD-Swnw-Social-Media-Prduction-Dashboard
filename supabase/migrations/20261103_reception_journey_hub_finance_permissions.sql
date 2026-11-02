create or replace function public.clinic_reception_journey_hub_snapshot(p_workspace uuid, p_day date default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, clinic_reception
as $$
declare
  v_base jsonb;
  v_rows jsonb;
  v_can_finance boolean;
begin
  v_base := public.clinic_reception_journey_snapshot(p_workspace, p_day);
  v_can_finance := public.has_role('super_admin')
    or public.has_role('general_manager')
    or public.has_role('reception')
    or public.has_role('accountant')
    or public.has_role('financial_manager');

  select coalesce(jsonb_agg(
    a || jsonb_build_object(
      'booking_source', ap.source,
      'package_id', ap.package_id,
      'payment_required', coalesce(fin.patient_due,0) > 0,
      'can_view_finance', v_can_finance,
      'patient_payable_total', case when v_can_finance then coalesce(fin.patient_payable_total,0) else null end,
      'patient_due', case when v_can_finance then coalesce(fin.patient_due,0) else null end,
      'patient_paid', case when v_can_finance then greatest(coalesce(fin.patient_payable_total,0)-coalesce(fin.patient_due,0),0) else null end,
      'due_invoices', case when v_can_finance then coalesce(fin.due_invoices,'[]'::jsonb) else '[]'::jsonb end
    )
  ), '[]'::jsonb)
  into v_rows
  from jsonb_array_elements(coalesce(v_base->'appointments','[]'::jsonb)) a
  left join clinic_reception.appointments ap on ap.id=(a->>'id')::uuid
  left join lateral (
    select
      coalesce(sum(greatest(i.amount-i.payer_amount-i.credit_amount,0)),0) as patient_payable_total,
      coalesce(sum(clinic_reception.due(i.id)),0) as patient_due,
      coalesce(jsonb_agg(
        jsonb_build_object(
          'id',i.id,
          'invoice_no',i.invoice_no,
          'amount',i.amount,
          'payer_amount',i.payer_amount,
          'credit_amount',i.credit_amount,
          'due',clinic_reception.due(i.id),
          'description',i.description,
          'patient_id',i.patient_id,
          'visit_id',i.visit_id,
          'workspace_id',i.workspace_id
        ) order by i.created_at
      ) filter (where clinic_reception.due(i.id)>0), '[]'::jsonb) as due_invoices
    from clinic_reception.invoices i
    where nullif(a->>'visit_id','') is not null
      and i.visit_id=(a->>'visit_id')::uuid
  ) fin on true;

  return jsonb_set(v_base,'{appointments}',v_rows,true)
    || jsonb_build_object('can_view_finance',v_can_finance);
end;
$$;

grant execute on function public.clinic_reception_journey_hub_snapshot(uuid,date) to authenticated;