-- Partner monthly settlement: compute on the server, never overwrite an approved/paid settlement.
-- Before: contracting-partnerships.js computed amounts in the browser from ALL-TIME transactions and
-- upserted contracting_settlements with status='under_review'. Pressing the button again overwrote an
-- approved or paid settlement and reset it to under_review.
-- After:
--   1. contracting_create_settlement(p_entity, p_month): same permission as creating in the contracting
--      module; amounts for THAT calendar month only (transactions by transaction_date, referrals by
--      created_at in Africa/Cairo); progressive tiers (entity tiers, else the default 5/7.5/10/12.5 %);
--      refuses a month that is approved/paid or has not started; writes the activity log.
--   2. Trigger contracting_settlement_guard: nobody except super admin can edit or delete an approved/paid
--      settlement; approved -> paid is allowed with amounts unchanged.
-- Additive (new function + new trigger). Rollback: supabase/rollbacks/20261107200000_contracting_settlement_server_calc.rollback.sql
begin;

-- ON CONFLICT below needs the (entity_id, period_start, period_end) unique key; stop (and roll back) if it is missing.
do $chk$ begin
  if not exists (
    select 1 from pg_index i
    where i.indrelid = 'public.contracting_settlements'::regclass and i.indisunique
      and (select array_agg(a.attname::text order by a.attname)
             from pg_attribute a where a.attrelid = i.indrelid and a.attnum = any(i.indkey))
          = array['entity_id','period_end','period_start']) then
    raise exception 'contracting_settlements unique (entity_id, period_start, period_end) is missing - nothing applied';
  end if;
end $chk$;

create or replace function public.contracting_settlement_guard()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if public.is_super() then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.status in ('approved', 'paid') then
      raise exception 'لا يمكن حذف تسوية معتمدة أو مدفوعة';
    end if;
    return old;
  end if;
  if old.status in ('approved', 'paid') then
    if old.status = 'approved' and new.status = 'paid'
       and new.entity_id = old.entity_id and new.period_start = old.period_start and new.period_end = old.period_end
       and new.eligible_revenue = old.eligible_revenue and new.incentive_amount = old.incentive_amount
       and new.adjustments = old.adjustments and new.referral_count = old.referral_count
       and new.completed_count = old.completed_count then
      return new;
    end if;
    raise exception 'التسوية معتمدة أو مدفوعة ولا يمكن تعديلها';
  end if;
  return new;
end $$;
revoke all on function public.contracting_settlement_guard() from public, anon, authenticated;

drop trigger if exists contracting_settlement_guard on public.contracting_settlements;
create trigger contracting_settlement_guard before update or delete on public.contracting_settlements
  for each row execute function public.contracting_settlement_guard();

create or replace function public.contracting_create_settlement(p_entity uuid, p_month date default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_start date := date_trunc('month', coalesce(p_month, v_today))::date;
  v_end date := (date_trunc('month', coalesce(p_month, v_today)) + interval '1 month - 1 day')::date;
  v_status text;
  v_eligible numeric(14,2);
  v_referrals integer;
  v_completed integer;
  v_incentive numeric(14,2) := 0;
  v_tiers jsonb;
  t jsonb;
  v_min numeric; v_max numeric; v_top numeric;
  v_row public.contracting_settlements%rowtype;
begin
  if not ((public.is_controlled_finance() and public.finance_module_allowed('contracting_entities', 'create'))
          or (not public.is_controlled_finance()
              and (public.has_role('contract_manager') or public.has_role('general_manager') or public.has_role('super_admin')))) then
    raise exception 'ليس لديك صلاحية إنشاء تسوية';
  end if;
  if p_entity is null or not exists (select 1 from public.contracting_entities where id = p_entity) then
    raise exception 'الجهة غير موجودة';
  end if;
  if v_start > v_today then
    raise exception 'لا يمكن إنشاء تسوية لشهر لم يبدأ بعد';
  end if;

  perform pg_advisory_xact_lock(hashtext('contracting_settlement:' || p_entity::text || ':' || v_start::text));
  select status into v_status from public.contracting_settlements
   where entity_id = p_entity and period_start = v_start and period_end = v_end for update;
  if v_status in ('approved', 'paid') then
    raise exception 'تسوية هذا الشهر معتمدة أو مدفوعة بالفعل ولا يمكن إعادة حسابها';
  end if;

  select coalesce(sum(greatest(coalesce(collected_amount, 0) - coalesce(refunded_amount, 0), 0)), 0)
    into v_eligible
    from public.contracting_partner_transactions
   where entity_id = p_entity and eligible is not false
     and transaction_date between v_start and v_end;

  select count(*), count(*) filter (where status in ('completed', 'collected'))
    into v_referrals, v_completed
    from public.contracting_referrals
   where entity_id = p_entity
     and (created_at at time zone 'Africa/Cairo')::date between v_start and v_end;

  select jsonb_agg(jsonb_build_object('min', min_amount, 'max', max_amount, 'rate', rate_percent) order by sort_order, min_amount)
    into v_tiers
    from public.contracting_incentive_tiers
   where entity_id = p_entity and active is not false;
  if v_tiers is null then
    v_tiers := '[{"min":0,"max":10000,"rate":5},{"min":10000,"max":25000,"rate":7.5},{"min":25000,"max":50000,"rate":10},{"min":50000,"max":null,"rate":12.5}]'::jsonb;
  end if;
  for t in select * from jsonb_array_elements(v_tiers) loop
    v_min := (t->>'min')::numeric;
    v_max := nullif(t->>'max', '')::numeric;
    if v_eligible > v_min then
      v_top := case when v_max is null then v_eligible else least(v_eligible, v_max) end;
      v_incentive := v_incentive + greatest(v_top - v_min, 0) * (t->>'rate')::numeric / 100;
    end if;
  end loop;
  v_incentive := round(v_incentive, 2);

  insert into public.contracting_settlements
    (entity_id, period_start, period_end, eligible_revenue, referral_count, completed_count, incentive_amount, status)
  values (p_entity, v_start, v_end, v_eligible, v_referrals, v_completed, v_incentive, 'under_review')
  on conflict (entity_id, period_start, period_end) do update
    set eligible_revenue = excluded.eligible_revenue,
        referral_count = excluded.referral_count,
        completed_count = excluded.completed_count,
        incentive_amount = excluded.incentive_amount
  returning * into v_row;

  insert into public.contracting_activity_log (entity_id, action_key, summary, metadata, created_by)
  values (p_entity, 'settlement_created',
          'تسوية شهر ' || to_char(v_start, 'YYYY-MM') || ': حافز ' || v_incentive::text || ' على تحصيل ' || v_eligible::text,
          jsonb_build_object('settlement_id', v_row.id, 'period_start', v_start, 'eligible', v_eligible,
                             'incentive', v_incentive, 'recalculated', v_status is not null),
          public.my_admin_id());

  return to_jsonb(v_row);
end $$;
revoke all on function public.contracting_create_settlement(uuid, date) from public, anon;
grant execute on function public.contracting_create_settlement(uuid, date) to authenticated;

commit;
