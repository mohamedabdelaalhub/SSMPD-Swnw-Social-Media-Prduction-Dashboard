-- Live rollback test for 20261123150000_provider_scope_from_contracts.sql on the owner's case (24-11): د. شادي حسام has an active laser
-- contract for 0001316 but no scope row. ONE transaction ending in ROLLBACK, as postgres; apply the migration body at the marked spot
-- first if it is not applied (read its NOTICE: rows added / gap left). Acts as Mazen (reception) on the real open visit 081478e8…
-- (the owner's 24-11 case): «إلغاء الطلب» on the uncollected order 60975e13… + «إضافة خدمة» 0001316 with Shady. Nothing is kept.
begin;
create temp table sc_live(n serial, step text, expected text, actual text, ok boolean);
insert into sc_live(step, expected, actual, ok)
  select 'gap BEFORE (contracts valid today, no scope row)', '>0 before the migration', count(*)::text, true
    from clinic_reception.providers p join clinic_finance.doctor_contracts c on c.doctor_key = p.doctor_key
   where p.active and c.status = 'active' and (now() at time zone 'Africa/Cairo')::date between c.valid_from and c.valid_to and c.basis = 'performed'
     and c.base_scope = 'service' and c.deduction in ('none', 'cost')
     and not exists (select 1 from clinic_reception.provider_service_scopes sc where sc.provider_id = p.id and sc.service_code = c.service_scope);
-- >>> apply supabase/migrations/20261123150000_provider_scope_from_contracts.sql here (without its own begin / commit) if not applied yet <<<
do $$
declare mazen uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; d date := (now() at time zone 'Africa/Cairo')::date; shady uuid; v record; svc uuid; o1 uuid;
  r jsonb; gap int; err text; n int;
begin
  select count(*) into gap from clinic_reception.providers p join clinic_finance.doctor_contracts c on c.doctor_key = p.doctor_key
   where p.active and c.status = 'active' and d between c.valid_from and c.valid_to and c.basis = 'performed' and c.base_scope = 'service'
     and c.deduction in ('none', 'cost')
     and not exists (select 1 from clinic_reception.provider_service_scopes sc where sc.provider_id = p.id and sc.service_code = c.service_scope);
  insert into sc_live(step, expected, actual, ok) values ('gap AFTER', '0', gap::text, gap = 0);
  select count(*) into n from clinic_reception.provider_scope_autofill;
  insert into sc_live(step, expected, actual, ok) values ('auto-filled scope rows (logged)', '> 0', n::text, n > 0);
  select id into shady from clinic_reception.providers where active and name like '%شادي حسام%' limit 1;
  insert into sc_live(step, expected, actual, ok) values ('gate Shady × 0001316 / 0001317', 'true / true',
    clinic_reception.has_provider_service_scope(shady, '0001316', d) || ' / ' || clinic_reception.has_provider_service_scope(shady, '0001317', d),
    clinic_reception.has_provider_service_scope(shady, '0001316', d) and clinic_reception.has_provider_service_scope(shady, '0001317', d));
  insert into sc_live(step, expected, actual, ok) select 'other laser-contract doctors now pass 0001316', 'all true',
    string_agg(p.name || '=' || clinic_reception.has_provider_service_scope(p.id, '0001316', d), ', '), coalesce(bool_and(clinic_reception.has_provider_service_scope(p.id, '0001316', d)), true)
    from clinic_reception.providers p join clinic_finance.doctor_contracts c on c.doctor_key = p.doctor_key and c.service_scope = '0001316'
   where p.active and c.status = 'active' and d between c.valid_from and c.valid_to and c.basis = 'performed' and c.base_scope = 'service' and c.deduction in ('none', 'cost');
  -- the real visit, as Mazen (reception)
  select vi.* into v from clinic_reception.visits vi where vi.id::text like '081478e8%' limit 1;
  select id into o1 from clinic_reception.orders where id::text like '60975e13%' limit 1;
  select id into svc from clinic_reception.services where workspace_id = v.workspace_id and code = '0001316' and active limit 1;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', mazen, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', mazen::text, true);
  begin
    execute 'set local role authenticated';
    r := public.clinic_reception_command(v.workspace_id, 'order_cancel', jsonb_build_object('id', o1, 'reason', 'تجربة تراجع: باقة 1000 نبضة بدل الإبر'), gen_random_uuid());
    execute 'reset role'; err := 'ok';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into sc_live(step, expected, actual, ok) values ('Mazen «إلغاء الطلب» 60975e13 (uncollected)', 'ok', err, err = 'ok');
  begin
    execute 'set local role authenticated';
    r := public.clinic_reception_command(v.workspace_id, 'order_add', jsonb_build_object('visit_id', v.id, 'service_id', svc, 'provider_id', shady, 'quantity', 1), gen_random_uuid());
    execute 'reset role'; err := 'ok';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into sc_live(step, expected, actual, ok) values ('Mazen «+ إضافة خدمة» 0001316 with Shady', 'ok', err, err = 'ok');
  insert into sc_live(step, expected, actual, ok) select 'visit orders after', '0001316 ordered (Shady) + 60975e13 cancelled',
    string_agg(s.code || ' ' || o.status || ' ' || o.price, ' · ' order by o.created_at),
    bool_or(s.code = '0001316' and o.status = 'ordered' and o.provider_id = shady) and bool_or(o.id = o1 and o.status = 'cancelled')
    from clinic_reception.orders o join clinic_reception.services s on s.id = o.service_id where o.visit_id = v.id;
end $$;
select step, expected, actual, ok from sc_live order by n;
rollback;
