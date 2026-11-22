-- Reception correction requests visible to the financial reviewer (owner 2026-11-22: Manar filed two «إلغاء خدمة اتدخلت بالغلط»
-- requests and the financial manager saw nothing). Approving already works by role: clinic_reception_command('request_review')
-- → access(ws,'review') → on the live workspace clinic_finance.allowed('review') (super_admin / general_manager / financial_manager
-- with the accounting update permission). But clinic_reception.controls_snapshot only listed the requests — and set can_review,
-- which shows «مراجعة مستقلة» — for workspace managers or members holding the 'review' capability.
-- Change (in-place text patch on controls_snapshot, each anchor exactly once, old body saved for rollback):
--   * reviewer also = clinic_finance.allowed('review') on the LIVE workspace;
--   * the 'requests' rows are returned to (manager or reviewer or the creator).
-- Nothing else changes: maker ≠ checker, the review rules and the postings stay as they are.
-- Rollback: supabase/rollbacks/20261122240000_reception_requests_finance_reviewer.rollback.sql
begin;

create table if not exists clinic_reception.requests_reviewer_saved_defs(sig text primary key, def text not null);
revoke all on clinic_reception.requests_reviewer_saved_defs from public, anon, authenticated;

do $$
declare d text; n int;
  a1 text := 'reviewer:=manager or exists(select 1 from clinic_reception.members where workspace_id=p_workspace and admin_id=me and ''review''=any(capabilities));';
  b1 text := 'reviewer:=manager or exists(select 1 from clinic_reception.members where workspace_id=p_workspace and admin_id=me and ''review''=any(capabilities)) or (clinic_finance.allowed(''review'') and exists(select 1 from clinic_reception.workspaces where id=p_workspace and mode=''live''));';
  a2 text := '(manager or created_by=me or exists(select 1 from clinic_reception.members where workspace_id=p_workspace and admin_id=me and ''review''=any(capabilities)))';
  b2 text := '(manager or reviewer or created_by=me)';
begin
  if to_regprocedure('clinic_reception.controls_snapshot(uuid,date,date)') is null then raise exception 'controls_snapshot غير موجودة'; end if;
  d := pg_get_functiondef('clinic_reception.controls_snapshot(uuid,date,date)'::regprocedure);
  n := (length(d) - length(replace(d, a1, ''))) / length(a1);
  if n <> 1 then raise exception 'controls_snapshot reviewer anchor found % times (expected 1)', n; end if;
  n := (length(d) - length(replace(d, a2, ''))) / length(a2);
  if n <> 1 then raise exception 'controls_snapshot requests anchor found % times (expected 1)', n; end if;
  insert into clinic_reception.requests_reviewer_saved_defs values ('clinic_reception.controls_snapshot(uuid,date,date)', d)
    on conflict (sig) do update set def = excluded.def;
  execute replace(replace(d, a1, b1), a2, b2);
end $$;

notify pgrst, 'reload schema';
commit;
