-- «تسليم» choice (owner 2026-11-24, PR #801): the choice must show «تسليم التحصيل لزميل» DISABLED while a handover to the main treasury
-- is pending on the shift — the peer request is refused then («فيه تسليم للخزينة الرئيسية معلّق على ورديتك», 20261118160000).
-- public.clinic_finance_peer_handover('options') now also returns `main_pending`: {id, amount, reference} of the pending treasury transfer
-- from the caller's open shift (null when none). READ-ONLY addition; every other action passes through unchanged.
-- (The reverse needs no flag: a pending peer handover does not block a main transfer; it is already listed by 'inbox' → outgoing.)
-- ADDITIVE: one outer wrapper; the 20261122010000 body is kept as clinic_finance.peer_handover_pre_pending.
-- Rollback: supabase/rollbacks/20261123180000_handover_options_pending.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_finance.peer_handover_pre_main(text,jsonb,uuid)') is null then raise exception 'طبّق 20261122010000 أولًا'; end if;
  if to_regprocedure('clinic_finance.peer_handover_pre_pending(text,jsonb,uuid)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter function public.clinic_finance_peer_handover(text, jsonb, uuid) set schema clinic_finance;
alter function clinic_finance.clinic_finance_peer_handover(text, jsonb, uuid) rename to peer_handover_pre_pending;
revoke all on function clinic_finance.peer_handover_pre_pending(text, jsonb, uuid) from public, anon, authenticated;

create function public.clinic_finance_peer_handover(p_action text, p_payload jsonb, p_token uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v jsonb; pend jsonb;
begin
  v := clinic_finance.peer_handover_pre_pending(p_action, p_payload, p_token);
  if p_action = 'options' and v->'shift' is not null and jsonb_typeof(v->'shift') = 'object' then
    select jsonb_build_object('id', t.id, 'amount', t.amount, 'reference', t.reference) into pend
      from clinic_finance.treasury_transfers t where t.from_shift = (v->'shift'->>'id')::uuid and t.status = 'pending'
     order by t.created_at desc limit 1;
    v := v || jsonb_build_object('main_pending', pend);
  end if;
  return v;
end $$;
revoke all on function public.clinic_finance_peer_handover(text, jsonb, uuid) from public, anon;
grant execute on function public.clinic_finance_peer_handover(text, jsonb, uuid) to authenticated;

commit;
