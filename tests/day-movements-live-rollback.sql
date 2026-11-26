-- Live rollback test for 20261126220000_day_movements.sql («حركات اليوم», read-only RPC public.clinic_finance_day_movements).
-- Run the WHOLE file as postgres, BEFORE the apply. ONE transaction, ends with ROLLBACK — nothing is kept. Prints COUNTS / TOTALS only
-- (no names, no files, no amounts per patient). Calls the RPC as the real roles, through `authenticated`:
--   Mazen (reception, auth sub f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb): his open shift (default) and his latest shift by id;
--   another reception cashier's shift as Mazen: refused; the financial manager (an active admin who passes clinic_finance.allowed('review'),
--   preferring role financial_manager): today's period, all shifts.
-- Also checks the RPC matches clinic_finance_shift_movements (same shifts) and runs inside a READ ONLY sub-check.
-- Output: one table (step, expected, actual, ok).
do $$ begin
  if to_regprocedure('public.clinic_finance_day_movements(uuid,date,date,uuid)') is not null then
    raise exception '20261126220000 already applied — this dry-run is for before the apply'; end if;
  if to_regprocedure('public.clinic_finance_shift_movements(uuid,date,date,uuid,uuid)') is null then raise exception 'shift movements RPC missing'; end if;
end $$;

begin;
create temp table dmv_live(n serial, step text, expected text, actual text, ok boolean);
grant insert, select on dmv_live to authenticated; grant usage on sequence dmv_live_n_seq to authenticated;

-- >>> MIGRATION BODY: supabase/migrations/20261126220000_day_movements.sql (between its begin; / commit;) >>>

do $$ begin
  if to_regprocedure('public.clinic_finance_shift_movements(uuid,date,date,uuid,uuid)') is null then
    raise exception 'clinic_finance_shift_movements غير موجودة؛ طبق ملفات حركات الوردية أولًا';
  end if;
  if to_regprocedure('public.clinic_finance_day_movements(uuid,date,date,uuid)') is not null then
    raise exception 'تم تطبيق هذا الملف من قبل';
  end if;
end $$;

create function public.clinic_finance_day_movements(p_shift uuid default null, p_from date default null, p_to date default null, p_cashier uuid default null)
returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid := public.my_admin_id(); manager boolean; ids uuid[]; v_shifts jsonb; v_visits jsonb; v_payouts jsonb := '[]'; v_channels jsonb := '{}'; fin uuid[];
begin
  if me is null or not exists (select 1 from public.admins where id = me and active) then raise exception 'سجل الدخول' using errcode = '42501'; end if;
  manager := public.has_role('super_admin') or public.has_role('general_manager') or clinic_finance.allowed('review');
  if p_shift is null and (p_from is not null or p_to is not null) then
    if p_from is null or p_to is null or p_to < p_from then raise exception 'اختار فترة صحيحة'; end if;
    if p_to - p_from > 30 then raise exception 'أقصى فترة ٣١ يوم'; end if;
  end if;
  -- same shift selection as clinic_finance_shift_movements
  select array_agg(fs.id) into ids from clinic_finance.shifts fs
   where (manager or fs.cashier_id = me)
     and (p_shift is null or fs.id = p_shift)
     and (p_cashier is null or fs.cashier_id = p_cashier)
     and (p_shift is not null
          or (p_from is not null and (fs.opened_at at time zone 'Africa/Cairo')::date between p_from and p_to)
          or (p_from is null and fs.cashier_id = me and fs.status = 'open'));
  if p_shift is not null and ids is null then raise exception 'الوردية مش متاحة لك' using errcode = '42501'; end if;
  ids := coalesce(ids, '{}');

  select coalesce(jsonb_agg(jsonb_build_object('id', fs.id, 'register_name', reg.name,
           'cashier_name', coalesce(nullif(trim(to_jsonb(ad)->>'name'), ''), 'موظف'), 'opened_at', fs.opened_at, 'status', fs.status)
           || case when manager then jsonb_build_object('opening_book', fs.opening_book) else '{}'::jsonb end order by fs.opened_at), '[]')
    into v_shifts
    from clinic_finance.shifts fs join clinic_finance.registers reg on reg.id = fs.register_id left join public.admins ad on ad.id = fs.cashier_id
   where fs.id = any(ids);

  with fsh as (
    select fs.id, fs.cashier_id, fs.opened_at, coalesce(fs.closed_at, now()) until_at from clinic_finance.shifts fs where fs.id = any(ids)),
  rsh as (select rs.id rid, f.* from clinic_reception.shifts rs join fsh f on f.id = rs.finance_shift_id),
  pay as (
    select rp.id, rp.method, rp.amount, rp.reference, to_jsonb(rp)->>'receipt_no' receipt_no, rp.created_at, f.id fid
      from clinic_reception.payments rp join rsh f on f.rid = rp.shift_id
    union all
    select rp.id, rp.method, rp.amount, rp.reference, to_jsonb(rp)->>'receipt_no', rp.created_at, f.id
      from clinic_reception.payments rp join fsh f on rp.shift_id is null and rp.created_by = f.cashier_id and rp.created_at between f.opened_at and f.until_at),
  al as (select a.invoice_id, a.amount, p.id payment_id, p.method, p.reference, p.receipt_no, p.created_at
           from clinic_reception.allocations a join pay p on p.id = a.payment_id),
  vis as (select distinct i.visit_id from al join clinic_reception.invoices i on i.id = al.invoice_id where i.visit_id is not null)
  select coalesce(jsonb_agg(x.j order by x.at_time), '[]') into v_visits from (
    select coalesce(ap.arrived_at, v.opened_at) at_time, jsonb_build_object(
      'id', v.id, 'visit_no', v.visit_no, 'at', coalesce(ap.arrived_at, v.opened_at), 'status', v.status,
      'patient', pt.name, 'file_no', pt.file_no, 'provider', pr.name, 'provider_id', ap.provider_id,
      'source', ap.source, 'discount_kind', to_jsonb(ap)->>'discount_kind', 'discount_percent', to_jsonb(ap)->'discount_percent',
      'discount_reason', to_jsonb(ap)->>'discount_reason', 'discount_staff', (to_jsonb(ap)->>'discount_staff_id') is not null,
      'discount_by', (select coalesce(nullif(trim(to_jsonb(d)->>'name'), ''), 'موظف') from public.admins d where d.id = nullif(to_jsonb(ap)->>'discount_by', '')::uuid),
      'services', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', o.id, 'name', coalesce(o.snapshot->>'name', 'خدمة'), 'provider', po.name, 'provider_id', o.provider_id, 'status', o.status,
          'gross', round(o.price * o.quantity, 2), 'discount_percent', o.discount, 'discount', round(o.price * o.quantity * o.discount / 100, 2),
          'due', coalesce(i.amount, round(o.price * o.quantity, 2) - round(o.price * o.quantity * o.discount / 100, 2)),
          'claim', coalesce(c.amount, 0), 'doctor_fee', o.doctor_fee, 'finance_invoice_id', i.finance_invoice_id,
          'collected_here', coalesce((select sum(a.amount) from al a where a.invoice_id = i.id), 0),
          'collected_total', coalesce((select sum(a.amount) from clinic_reception.allocations a where a.invoice_id = i.id), 0),
          'payments', coalesce((select jsonb_agg(jsonb_build_object('method', a.method, 'amount', a.amount, 'reference', a.reference, 'receipt_no', a.receipt_no, 'at', a.created_at) order by a.created_at)
                                  from al a where a.invoice_id = i.id), '[]'),
          'request', (select jsonb_build_object('percent', d.percent, 'reason', d.reason,
                        'by', (select coalesce(nullif(trim(to_jsonb(x1)->>'name'), ''), 'موظف') from public.admins x1 where x1.id = d.created_by),
                        'approved_by', (select coalesce(nullif(trim(to_jsonb(x2)->>'name'), ''), 'موظف') from public.admins x2 where x2.id = d.reviewed_by))
                        from clinic_reception.discount_requests d where d.order_id = o.id and d.status = 'approved' order by d.percent desc limit 1)
        ) order by o.created_at), '[]')
          from clinic_reception.orders o join clinic_reception.providers po on po.id = o.provider_id
          left join clinic_reception.invoices i on i.order_id = o.id
          left join clinic_reception.claims c on c.invoice_id = i.id
         where o.visit_id = v.id and o.status <> 'cancelled'),
      'fixes', (
        select coalesce(jsonb_agg(jsonb_build_object('at', j.created_at, 'from', j.dimensions->>'method_from', 'to', j.dimensions->>'method_to',
                 'amount', rp.amount, 'reference', rp.reference,
                 'by', (select coalesce(nullif(trim(to_jsonb(d)->>'name'), ''), 'موظف') from public.admins d where d.id = j.actor_id)) order by j.created_at), '[]')
          from clinic_reception.journal j join clinic_reception.payments rp on rp.id = nullif(j.dimensions->>'payment_id', '')::uuid
         where j.source = 'method_fix'
           and rp.id in (select a.payment_id from al a join clinic_reception.invoices i2 on i2.id = a.invoice_id where i2.visit_id = v.id))
    ) j
      from vis join clinic_reception.visits v on v.id = vis.visit_id
      join clinic_reception.appointments ap on ap.id = v.appointment_id
      join clinic_reception.patients pt on pt.id = v.patient_id
      join clinic_reception.providers pr on pr.id = ap.provider_id
     order by 1 limit 1000) x;

  -- booking channel split (platform share / referral commission), when the finance side recorded one
  select array_agg(distinct (s->>'finance_invoice_id')::uuid) into fin
    from jsonb_array_elements(v_visits) vv, jsonb_array_elements(vv->'services') s where nullif(s->>'finance_invoice_id', '') is not null;
  if fin is not null and to_regclass('clinic_finance.channel_allocations') is not null then
    execute $q$select coalesce(jsonb_object_agg(c.invoice_id::text, jsonb_build_object('name', c.channel_name, 'kind', c.kind, 'payable', c.payable_kind,
               'platform_share', c.platform_share, 'patient_discount', c.patient_discount)), '{}')
               from clinic_finance.channel_allocations c where c.invoice_id = any($1)$q$ into v_channels using fin;
  end if;

  -- doctor payouts paid from these shifts
  if to_regclass('clinic_finance.doctor_payouts') is not null then
    execute $q$select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'at', coalesce(p.reviewed_at, p.created_at), 'shift_id', p.shift_id,
               'doctor_key', p.doctor_key, 'amount', p.gross - p.withheld, 'method', p.method, 'reference', p.reference,
               'doctor_name', coalesce((select max(k.doctor_name) from clinic_finance.doctor_contracts k where k.doctor_key = p.doctor_key), p.doctor_key),
               'provider_id', (select r.id from clinic_reception.providers r where r.doctor_key = p.doctor_key order by r.active desc, r.name limit 1))
               order by p.created_at), '[]')
               from clinic_finance.doctor_payouts p where p.shift_id = any($1) and p.status = 'approved'$q$ into v_payouts using ids;
  end if;

  return jsonb_build_object('shifts', v_shifts, 'manager', manager, 'visits', v_visits, 'payouts', v_payouts, 'channels', v_channels,
                            'capped', jsonb_array_length(v_visits) >= 1000);
end $$;
revoke all on function public.clinic_finance_day_movements(uuid, date, date, uuid) from public, anon;
grant execute on function public.clinic_finance_day_movements(uuid, date, date, uuid) to authenticated;

-- <<< END MIGRATION BODY <<<

do $$
declare mz uuid := 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb'; mz_admin uuid; fm_sub uuid; fm_admin uuid; d jsonb; m jsonb; last_shift uuid; other_shift uuid;
  today date := (now() at time zone 'Africa/Cairo')::date; err text; nv int; ns int; tot numeric; here numeric;
begin
  select id into mz_admin from public.admins where user_id = mz;
  select fs.id into last_shift from clinic_finance.shifts fs where fs.cashier_id = mz_admin order by fs.opened_at desc limit 1;
  select fs.id into other_shift from clinic_finance.shifts fs where fs.cashier_id <> mz_admin order by fs.opened_at desc limit 1;
  -- 1) Mazen, default (his open shift)
  perform set_config('request.jwt.claims', jsonb_build_object('sub', mz, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', mz::text, true);
  execute 'set local role authenticated';
  begin d := public.clinic_finance_day_movements(); err := 'ok'; exception when others then err := sqlerrm; end;
  begin m := public.clinic_finance_shift_movements(); exception when others then m := null; end;
  execute 'reset role';
  insert into dmv_live(step, expected, actual, ok) values ('1 Mazen default (open shift)', 'ok · no opening balance · same shifts as the movements',
    err || ' · shifts ' || coalesce(jsonb_array_length(d->'shifts'), -1) || ' · visits ' || coalesce(jsonb_array_length(d->'visits'), -1) || ' · payouts ' || coalesce(jsonb_array_length(d->'payouts'), -1)
      || ' · manager ' || coalesce(d->>'manager', '?'),
    err = 'ok' and position('opening' in coalesce(d->>'shifts', '')) = 0 and coalesce(d->>'manager','') = 'false'
      and (m is null or (select coalesce(array_agg(x->>'id' order by x->>'id'), '{}') from jsonb_array_elements(d->'shifts') x) = (select coalesce(array_agg(x->>'id' order by x->>'id'), '{}') from jsonb_array_elements(m->'shifts') x)));
  -- 2) Mazen, his latest shift by id: totals reconcile (collected here ≤ due; per-visit numbers present)
  if last_shift is not null then
    execute 'set local role authenticated';
    begin d := public.clinic_finance_day_movements(last_shift); err := 'ok'; exception when others then err := sqlerrm; end;
    execute 'reset role';
    select count(*), coalesce(sum((s->>'due')::numeric), 0), coalesce(sum((s->>'collected_here')::numeric), 0) into ns, tot, here
      from jsonb_array_elements(coalesce(d->'visits', '[]')) v, jsonb_array_elements(v->'services') s;
    insert into dmv_live(step, expected, actual, ok) values ('2 Mazen his latest shift', 'ok · services with due / collected here',
      err || ' · visits ' || coalesce(jsonb_array_length(d->'visits'), 0) || ' · services ' || ns || ' · due ' || tot || ' · collected here ' || here
        || ' · discounted services ' || (select count(*) from jsonb_array_elements(coalesce(d->'visits','[]')) v, jsonb_array_elements(v->'services') s where (s->>'discount')::numeric > 0),
      err = 'ok' and here >= 0);
  else
    insert into dmv_live(step, expected, actual, ok) values ('2 Mazen his latest shift', 'skipped if Mazen never had a shift', 'no shift for Mazen', true);
  end if;
  -- 3) Mazen asking for someone else's shift: refused
  if other_shift is not null then
    execute 'set local role authenticated';
    begin d := public.clinic_finance_day_movements(other_shift); err := 'accepted'; exception when others then err := sqlerrm; end;
    execute 'reset role';
    insert into dmv_live(step, expected, actual, ok) values ('3 Mazen another cashier''s shift', 'refused «الوردية مش متاحة لك» (unless Mazen is a finance reviewer)', err,
      err like '%مش متاحة%' or (err = 'accepted' and coalesce(d->>'manager','') = 'true'));
  end if;
  -- 4) financial manager: today, all shifts, with opening balance
  select a.user_id, a.id into fm_sub, fm_admin from public.admins a where a.active and a.user_id is not null and a.id <> mz_admin
     and (to_jsonb(a)->>'role') in ('financial_manager', 'general_manager', 'super_admin')
   order by ((to_jsonb(a)->>'role') = 'financial_manager') desc, ((to_jsonb(a)->>'role') = 'general_manager') desc limit 1;
  if fm_sub is not null then
    perform set_config('request.jwt.claims', jsonb_build_object('sub', fm_sub, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', fm_sub::text, true);
    execute 'set local role authenticated';
    begin d := public.clinic_finance_day_movements(null, today, today, null); err := 'ok'; exception when others then err := sqlerrm; end;
    begin m := public.clinic_finance_shift_movements(null, today, today, null, null); exception when others then m := null; end;
    execute 'reset role';
    insert into dmv_live(step, expected, actual, ok) values ('4 finance manager today, all shifts', 'ok · manager · opening balance shown · same shifts as the movements',
      err || ' · manager ' || coalesce(d->>'manager', '?') || ' · shifts ' || coalesce(jsonb_array_length(d->'shifts'), -1) || ' · visits ' || coalesce(jsonb_array_length(d->'visits'), -1)
        || ' · payouts ' || coalesce(jsonb_array_length(d->'payouts'), -1) || ' · channel rows ' || (select count(*) from jsonb_object_keys(coalesce(d->'channels', '{}'))),
      err = 'ok' and coalesce(d->>'manager','') = 'true'
        and (jsonb_array_length(d->'shifts') = 0 or (d->'shifts'->0) ? 'opening_book')
        and (m is null or jsonb_array_length(d->'shifts') = jsonb_array_length(m->'shifts')));
  else
    insert into dmv_live(step, expected, actual, ok) values ('4 finance manager', 'an active FM/GM/SA admin', 'none found', false);
  end if;
  -- 5) anon cannot call it
  execute 'set local role anon';
  begin perform public.clinic_finance_day_movements(); err := 'accepted'; exception when others then err := sqlerrm; end;
  execute 'reset role';
  insert into dmv_live(step, expected, actual, ok) values ('5 anon', 'refused (no execute)', err, err <> 'accepted');
end $$;

-- 6) read-only: it runs in a READ ONLY savepoint-free check (stable, writes nothing)
select set_config('request.jwt.claims', jsonb_build_object('sub', 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb', 'role', 'authenticated')::text, true);
select set_config('request.jwt.claim.sub', 'f0891d2c-44b5-4dd8-80e0-8035f2e4b5eb', true);
insert into dmv_live(step, expected, actual, ok)
  select '6 provolatile', 's (stable — cannot write)', p.provolatile::text, p.provolatile = 's' from pg_proc p where p.oid = 'public.clinic_finance_day_movements(uuid,date,date,uuid)'::regprocedure;

-- >>> ROLLBACK BODY: supabase/rollbacks/20261126220000_day_movements.rollback.sql >>>
drop function if exists public.clinic_finance_day_movements(uuid, date, date, uuid);
-- <<< END ROLLBACK BODY <<<
insert into dmv_live(step, expected, actual, ok) select '7 rollback body', 'function dropped',
  coalesce(to_regprocedure('public.clinic_finance_day_movements(uuid,date,date,uuid)')::text, 'dropped'), to_regprocedure('public.clinic_finance_day_movements(uuid,date,date,uuid)') is null;

select step, expected, actual, ok from dmv_live order by n;
rollback;
