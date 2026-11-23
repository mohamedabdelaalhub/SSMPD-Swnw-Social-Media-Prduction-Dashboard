-- Live rollback test for 20261123120000_referring_doctor.sql. ONE transaction ending in ROLLBACK, as postgres; apply the migration body at the
-- marked spot first if it is not applied. Acts as Mazen (reception). Last output = one result table. Nothing is kept.
begin;
-- >>> apply supabase/migrations/20261123120000_referring_doctor.sql here (without its own begin / commit) if not applied yet <<<
create temp table ref_live(n serial, step text, expected text, actual text, ok boolean);
do $$
declare sub uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; w uuid; ap record; prov uuid; a record; v uuid; r jsonb; err text;
begin
  select id into w from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  select x.* into ap from clinic_reception.appointments x where x.workspace_id = w and x.status = 'booked' and x.starts_at > now() order by x.starts_at limit 1;
  select id into prov from clinic_reception.providers where workspace_id = w and active and id <> ap.provider_id order by name limit 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', sub::text, true);
  execute 'set local role authenticated';
  perform public.clinic_reception_command(w, 'set_referrer', jsonb_build_object('id', ap.id, 'referrer_kind', 'external', 'referrer_name', 'د. اختبار تراجع',
    'referrer_specialty', 'عظام', 'referrer_clinic', 'عيادة خاصة'), gen_random_uuid());
  execute 'reset role';
  select * into a from clinic_reception.appointments where id = ap.id;
  insert into ref_live(step, expected, actual, ok) values ('1 set_referrer external', 'external د. اختبار تراجع / عظام', a.referrer_kind || ' ' || a.referrer_name || ' / ' || a.referrer_specialty,
    a.referrer_kind = 'external' and a.referrer_name = 'د. اختبار تراجع');
  execute 'set local role authenticated';
  perform public.clinic_reception_command(w, 'set_referrer', jsonb_build_object('id', ap.id, 'referrer_kind', 'internal', 'referrer_provider_id', prov), gen_random_uuid());
  execute 'reset role';
  select * into a from clinic_reception.appointments where id = ap.id;
  insert into ref_live(step, expected, actual, ok) values ('2 set_referrer internal', 'internal + provider name', a.referrer_kind || ' ' || coalesce(a.referrer_name, '-'), a.referrer_kind = 'internal' and a.referrer_provider_id = prov);
  execute 'set local role authenticated';
  perform public.clinic_reception_command(w, 'set_referrer', jsonb_build_object('id', ap.id, 'referrer_kind', ''), gen_random_uuid());
  execute 'reset role';
  select * into a from clinic_reception.appointments where id = ap.id;
  insert into ref_live(step, expected, actual, ok) values ('3 clear', 'null', coalesce(a.referrer_kind, 'null'), a.referrer_kind is null);
  -- the print of a recent visit carries it (set directly here, rolled back)
  select vi.id, vi.appointment_id into v, prov from clinic_reception.visits vi join clinic_reception.invoices i on i.visit_id = vi.id
   where vi.workspace_id = w order by vi.opened_at desc limit 1;
  update clinic_reception.appointments set referrer_kind = 'external', referrer_name = 'د. اختبار تراجع', referrer_specialty = 'عظام' where id = prov;
  begin
    execute 'set local role authenticated'; r := public.clinic_reception_invoice_print(w, v); execute 'reset role';
    insert into ref_live(step, expected, actual, ok) values ('4 invoice_print referrer', 'external د. اختبار تراجع', (r->'referrer')::text, r->'referrer'->>'name' = 'د. اختبار تراجع' and r ? 'invoice_no');
  exception when others then execute 'reset role'; insert into ref_live(step, expected, actual, ok) values ('4 invoice_print', 'works', sqlerrm, false); end;
end $$;
select step, expected, actual, ok from ref_live order by n;
rollback;
