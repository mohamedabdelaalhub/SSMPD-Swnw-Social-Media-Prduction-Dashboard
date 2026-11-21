-- Handover to the MAIN treasury from where staff actually look (owner «طبقه» 2026-11-21, main chat 4):
--  1) «تسليم تحصيل لزميل» (public.clinic_finance_peer_handover 'options') now also returns `main`: the open main-treasury shift and its custodian, so the
--     modal can offer «الخزينة الرئيسية — <الاسم>». The money path is NOT new: the screen then calls the existing public.clinic_finance_treasury_command
--     ('end_shift' with the count, or 'transfer_request' for a part) — the same rules as before (own open shift, amount <= available cash, the main
--     custodian with an open main shift approves, never the requester). The peer path itself is unchanged (main shifts are still not a peer target).
--  2) public.clinic_finance_open_drawers(): READ-ONLY list for finance reviewers (clinic_finance review right) of every open collection shift with its cash,
--     its count (if ended) and its pending / last rejected handover to the main treasury, plus whether the caller has an open main shift.
-- ADDITIVE: one wrapper (the 20261118160000 body is kept untouched as clinic_finance.peer_handover_pre_main) + one new function. No table change, nothing posted.
-- Rollback: supabase/rollbacks/20261122010000_treasury_handover_main_target.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.clinic_finance_peer_handover(text,jsonb,uuid)') is null then raise exception 'طبّق ملف التسليم بين الزملاء (20261118160000) أولًا'; end if;
  if to_regprocedure('clinic_finance.peer_handover_pre_main(text,jsonb,uuid)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter function public.clinic_finance_peer_handover(text, jsonb, uuid) set schema clinic_finance;
alter function clinic_finance.clinic_finance_peer_handover(text, jsonb, uuid) rename to peer_handover_pre_main;

create function public.clinic_finance_peer_handover(p_action text, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v jsonb; m jsonb;
begin
  v := clinic_finance.peer_handover_pre_main(p_action, p_payload, p_token);
  if p_action = 'options' and v->'shift' is not null and jsonb_typeof(v->'shift') = 'object' then
    select jsonb_build_object('shift_id', x.id, 'register_id', r.id, 'register', r.name, 'name', coalesce(nullif(trim(a.name), ''), 'المسؤول'))
      into m
      from clinic_finance.shifts x join clinic_finance.registers r on r.id = x.register_id and r.treasury_kind = 'main'
      join public.admins a on a.id = x.cashier_id
     where x.status = 'open' and x.is_main and x.ended_at is null and x.cashier_id <> public.my_admin_id()
       and r.id <> (select register_id from clinic_finance.shifts where id = (v->'shift'->>'id')::uuid)
     order by x.opened_at desc limit 1;
    v := v || jsonb_build_object('main', m);   -- null when no main shift is open: the modal then says so
  end if;
  return v;
end $$;

create function public.clinic_finance_open_drawers() returns jsonb language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare me uuid;
begin
  me := clinic_finance.require_access('review');
  return jsonb_build_object(
    'main_register', (select jsonb_build_object('id', r.id, 'name', r.name) from clinic_finance.registers r where r.treasury_kind = 'main' order by r.created_at limit 1),
    'my_main_shift', (select x.id from clinic_finance.shifts x join clinic_finance.registers r on r.id = x.register_id and r.treasury_kind = 'main'
                       where x.status = 'open' and x.is_main and x.cashier_id = me order by x.opened_at desc limit 1),
    'drawers', coalesce((select jsonb_agg(jsonb_build_object(
        'shift_id', x.id, 'register', r.name, 'cashier_id', x.cashier_id, 'cashier', coalesce(nullif(trim(a.name), ''), 'موظف'), 'opened_at', x.opened_at,
        'ended_at', x.ended_at, 'end_counted', x.end_counted, 'cash', clinic_finance.shift_cash(x.id),
        'pending', (select jsonb_build_object('id', t.id, 'amount', t.amount, 'reference', t.reference, 'created_by', t.created_by)
                      from clinic_finance.treasury_transfers t where t.from_shift = x.id and t.status = 'pending' order by t.created_at desc limit 1),
        'rejected', exists(select 1 from clinic_finance.treasury_transfers t where t.from_shift = x.id and t.status = 'rejected') and x.ended_at is not null
                    and not exists(select 1 from clinic_finance.treasury_transfers t where t.from_shift = x.id and t.status = 'pending'))
      order by r.name)
      from clinic_finance.shifts x join clinic_finance.registers r on r.id = x.register_id left join public.admins a on a.id = x.cashier_id
     where x.status = 'open' and not x.is_main
       and (clinic_finance.shift_cash(x.id) <> 0 or x.ended_at is not null
            or exists(select 1 from clinic_finance.treasury_transfers t where t.from_shift = x.id and t.status = 'pending'))), '[]'::jsonb));
end $$;

revoke all on function public.clinic_finance_peer_handover(text, jsonb, uuid), public.clinic_finance_open_drawers() from public, anon;
grant execute on function public.clinic_finance_peer_handover(text, jsonb, uuid), public.clinic_finance_open_drawers() to authenticated;
revoke all on function clinic_finance.peer_handover_pre_main(text, jsonb, uuid) from public, anon, authenticated;

commit;
