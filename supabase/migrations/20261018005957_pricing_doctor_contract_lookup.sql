begin;

-- A narrow, read-only source for the service editor. No balances, patients,
-- pending contracts or mutable copies of approved financial terms.
create or replace function public.pricing_doctor_contracts()
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public as $$
begin
  perform clinic_finance.require_access('view');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'doctor_key', c.doctor_key, 'doctor_name', c.doctor_name,
      'service_scope', c.service_scope, 'valid_from', c.valid_from,
      'valid_to', c.valid_to, 'rate', c.rate, 'basis', c.basis,
      'base_scope', c.base_scope, 'deduction', c.deduction,
      'reference', c.reference
    ) order by c.doctor_name, c.service_scope, c.valid_from, c.id)
    from clinic_finance.doctor_contracts c
    where c.status = 'active'
      and (now() at time zone 'Africa/Cairo')::date between c.valid_from and c.valid_to
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.pricing_doctor_contracts() from public, anon, authenticated;
grant execute on function public.pricing_doctor_contracts() to authenticated;

commit;
