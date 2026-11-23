-- Live rollback test for 20261123130000_visit_discount_all_services.sql on the owner's case: visit 53 (نعمه, c5f2fa9a…): consult with an
-- approved 30% request (4259b0b1…) + a 2nd ordered service. ONE transaction ending in ROLLBACK, as postgres; apply the migration body at the
-- marked spot first if it is not applied. Acts as Mazen (reception). Last output = one result table. Nothing is kept.
begin;
-- >>> apply supabase/migrations/20261123130000_visit_discount_all_services.sql here (without its own begin / commit) if not applied yet <<<
create temp table vd_live(n serial, step text, expected text, actual text, ok boolean);
do $$
declare sub uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; v record; r jsonb; err text; dup uuid;
begin
  select vi.* into v from clinic_reception.visits vi where vi.id::text like 'c5f2fa9a%' limit 1;
  if v.id is null then raise exception 'visit c5f2fa9a… not found'; end if;
  insert into vd_live(step, expected, actual, ok) select 'before: services', 'consult 30% + one ordered at 0%',
    string_agg(coalesce(o.snapshot->>'name', '?') || ' ' || o.price || ' / ' || o.discount || '% ' || o.status, ' · '), true
    from clinic_reception.orders o where o.visit_id = v.id and o.status <> 'cancelled';
  -- the pending duplicate generic request (e6dea07b…) does not count; the approved one is the visit discount
  insert into vd_live(step, expected, actual, ok) values ('visit discount', '30 (approved 4259b0b1…)', clinic_reception.visit_discount(v.id)::text,
    (clinic_reception.visit_discount(v.id)->>'percent')::numeric = 30);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', sub, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', sub::text, true);
  -- a duplicate generic request on the consult is refused
  begin
    execute 'set local role authenticated';
    perform public.clinic_reception_command(v.workspace_id, 'discount', jsonb_build_object('id', (select dr.order_id from clinic_reception.discount_requests dr where dr.id::text like '4259b0b1%'), 'percent', '30', 'reason', 'تجربة تراجع'), gen_random_uuid());
    execute 'reset role'; err := 'accepted';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into vd_live(step, expected, actual, ok) values ('duplicate generic request refused', 'عليها طلب خصم بالفعل', err, err like '%عليها طلب خصم بالفعل%');
  -- «نفس خصم الزيارة»
  begin
    execute 'set local role authenticated'; r := public.clinic_reception_command(v.workspace_id, 'visit_same_discount', jsonb_build_object('visit_id', v.id), gen_random_uuid()); execute 'reset role';
    insert into vd_live(step, expected, actual, ok) values ('visit_same_discount', '30% on the other service(s)', r::text, (r->>'percent')::numeric = 30 and (r->>'services')::int >= 1);
  exception when others then execute 'reset role'; insert into vd_live(step, expected, actual, ok) values ('visit_same_discount', 'works', sqlerrm, false); end;
  insert into vd_live(step, expected, actual, ok) select 'after: patient total', '700 (500+500 at 30%)',
    sum(round(o.price * o.quantity * (1 - o.discount / 100), 2))::text, sum(round(o.price * o.quantity * (1 - o.discount / 100), 2)) = 700
    from clinic_reception.orders o where o.visit_id = v.id and o.status <> 'cancelled';
end $$;
select step, expected, actual, ok from vd_live order by n;
rollback;
