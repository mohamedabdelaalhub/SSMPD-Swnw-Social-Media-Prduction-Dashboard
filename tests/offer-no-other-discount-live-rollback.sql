-- Live rollback test for 20261123200000_offer_no_other_discount.sql (owner 2026-11-24 «العروض ملهاش اي خصومات تانية»). ONE transaction
-- ending in ROLLBACK, as postgres; apply the migration body at the marked spot first if it is not applied. An offer price is SIMULATED
-- inside the transaction (pricing_evidence.source = 'offer' on one live booked appointment's service and on one live ordered order's
-- snapshot); Mazen (reception) then tries every manual discount path (all refused with the reason), and the automatic paths are shown
-- to skip the offer order. Nothing is kept.
begin;
-- >>> apply supabase/migrations/20261123200000_offer_no_other_discount.sql here (without its own begin / commit) if not applied yet <<<
create temp table od_live(n serial, step text, expected text, actual text, ok boolean);
do $$
declare mazen uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; ws uuid; ap record; o record; o2 record; err text; n int;
  syn jsonb := jsonb_build_object('discount_kind', 'special', 'discount_percent', '10', 'discount_reason', 'تجربة تراجع');
begin
  select id into ws from clinic_reception.workspaces where mode = 'live' order by created_at limit 1;
  -- a booked appointment (no package) and an open ordered order (no package, no discount) on another visit
  select a.* into ap from clinic_reception.appointments a where a.workspace_id = ws and a.status = 'booked' and a.package_id is null order by a.starts_at desc limit 1;
  select x.* into o from clinic_reception.orders x join clinic_reception.visits v on v.id = x.visit_id
   where x.workspace_id = ws and x.status = 'ordered' and x.entitlement_id is null and x.discount = 0 order by x.created_at desc limit 1;
  insert into od_live(step, expected, actual, ok) values ('fixtures', 'a booked appointment + an open ordered order', coalesce(ap.id::text, 'none') || ' · ' || coalesce(o.id::text, 'none'), ap.id is not null and o.id is not null);
  update clinic_reception.services set pricing_evidence = coalesce(pricing_evidence, '{}'::jsonb) || '{"source":"offer","reason":"تجربة عرض"}' where id = ap.service_id;
  update clinic_reception.orders set snapshot = jsonb_set(coalesce(snapshot, '{}'::jsonb), '{pricing_evidence}', coalesce(snapshot->'pricing_evidence', '{}'::jsonb) || '{"source":"offer"}') where id = o.id;
  insert into od_live(step, expected, actual, ok) values ('offer detection', 'true / true', clinic_reception.service_is_offer(ap.service_id) || ' / ' || clinic_reception.order_is_offer(o.id),
    clinic_reception.service_is_offer(ap.service_id) and clinic_reception.order_is_offer(o.id));
  perform set_config('request.jwt.claims', jsonb_build_object('sub', mazen, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', mazen::text, true);
  -- manual paths as Mazen
  begin execute 'set local role authenticated'; perform public.clinic_reception_command(ws, 'booking_discount', syn || jsonb_build_object('id', ap.id), gen_random_uuid()); execute 'reset role'; err := 'accepted';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into od_live(step, expected, actual, ok) values ('Mazen «خصم» on the offer booking (booking_discount)', 'refused «السعر ده عرض»', err, err like 'السعر ده عرض%');
  begin execute 'set local role authenticated'; perform public.clinic_reception_command(ws, 'order_discount', syn || jsonb_build_object('order_id', o.id), gen_random_uuid()); execute 'reset role'; err := 'accepted';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into od_live(step, expected, actual, ok) values ('Mazen «خصم على الزيارة» on the offer order (order_discount)', 'refused «السعر ده عرض»', err, err like 'السعر ده عرض%');
  begin execute 'set local role authenticated'; perform public.clinic_reception_command(ws, 'discount', jsonb_build_object('id', o.id, 'percent', '10', 'reason', 'تجربة تراجع'), gen_random_uuid()); execute 'reset role'; err := 'accepted';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into od_live(step, expected, actual, ok) values ('Mazen generic «خصم» request on the offer order', 'refused «السعر ده عرض»', err, err like 'السعر ده عرض%');
  -- clearing a booking discount stays allowed
  begin execute 'set local role authenticated'; perform public.clinic_reception_command(ws, 'booking_discount', jsonb_build_object('id', ap.id, 'discount_kind', ''), gen_random_uuid()); execute 'reset role'; err := 'ok';
  exception when others then execute 'reset role'; err := sqlerrm; end;
  insert into od_live(step, expected, actual, ok) values ('Mazen clears a booking discount on the offer booking', 'ok', err, err = 'ok');
  -- automatic paths (as postgres): a discount row is skipped and the percent stays 0 on the offer order
  insert into clinic_reception.discount_requests(workspace_id, order_id, percent, reason, created_by, reviewed_by, status)
    select ws, o.id, 30, 'خصم الحجز: تجربة تراجع', a.id, a.id, 'approved' from public.admins a where a.user_id = mazen;
  select count(*) into n from clinic_reception.discount_requests where order_id = o.id and reason = 'خصم الحجز: تجربة تراجع';
  insert into od_live(step, expected, actual, ok) values ('automatic discount row on the offer order', 'skipped (0 rows)', n::text, n = 0);
  update clinic_reception.orders set discount = 30 where id = o.id;
  select * into o2 from clinic_reception.orders where id = o.id;
  insert into od_live(step, expected, actual, ok) values ('automatic percent on the offer order', 'stays 0', o2.discount::text, o2.discount = 0);
  -- a NON-offer order is untouched by the rule
  select x.* into o2 from clinic_reception.orders x where x.workspace_id = ws and x.status = 'ordered' and x.id <> o.id and not clinic_reception.order_is_offer(x.id) limit 1;
  insert into od_live(step, expected, actual, ok) values ('non-offer orders keep discounts', 'order_is_offer = false', coalesce(clinic_reception.order_is_offer(o2.id)::text, 'no other open order'), o2.id is null or not clinic_reception.order_is_offer(o2.id));
end $$;
select step, expected, actual, ok from od_live order by n;
rollback;
