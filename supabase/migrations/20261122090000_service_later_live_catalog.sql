-- Fix for «الخدمة تتحدد عند الحضور» (20261122060000) on the live workspace (owner screenshot 2026-11-22: booking refused
-- with «الخدمة تغيرت أو غير مفعلة في التسعير؛ حدّث قائمة الخدمات»). In live mode every 'book' first runs
-- clinic_reception.sync_catalog (which turns off any service without a pricing link) and then requires the booked service
-- to have a pricing link. The department placeholder has neither, by design (price 0, never ordered or invoiced).
-- In-place text patches (each anchor must occur exactly once; old bodies saved for rollback):
--   * sync_catalog: the "no pricing link → inactive" sweep skips placeholder rows;
--   * the live 'book' / 'order_add' pricing check accepts a placeholder (order_add still never sees one: placeholders
--     stay inactive outside the service-later wrapper's own call, and the check also requires active).
-- Rollback: supabase/rollbacks/20261122090000_service_later_live_catalog.rollback.sql
begin;

create table if not exists clinic_reception.service_later_saved_defs(sig text primary key, def text not null);
revoke all on clinic_reception.service_later_saved_defs from public, anon, authenticated;

do $$
declare r record; d text; n int;
  a1 text := 'update clinic_reception.services r set active=false where r.workspace_id=p_workspace and (r.pricing_service_id is null or';
  b1 text := 'update clinic_reception.services r set active=false where r.workspace_id=p_workspace and not r.placeholder and (r.pricing_service_id is null or';
  a2 text := 'and active and pricing_service_id is not null) then raise exception ''الخدمة تغيرت أو غير مفعلة في التسعير';
  b2 text := 'and active and (pricing_service_id is not null or placeholder)) then raise exception ''الخدمة تغيرت أو غير مفعلة في التسعير';
begin
  if to_regclass('clinic_reception.services') is null or not exists (select 1 from information_schema.columns
       where table_schema = 'clinic_reception' and table_name = 'services' and column_name = 'placeholder') then
    raise exception 'طبّق 20261122060000 الأول'; end if;
  -- 1) sync_catalog
  select p.oid, p.prosrc into r from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'clinic_reception' and p.proname = 'sync_catalog';
  if not found then raise exception 'sync_catalog غير موجودة'; end if;
  n := (length(r.prosrc) - length(replace(r.prosrc, a1, ''))) / length(a1);
  if n <> 1 then raise exception 'sync_catalog anchor found % times (expected 1) — check the live definition', n; end if;
  d := pg_get_functiondef(r.oid);
  insert into clinic_reception.service_later_saved_defs values ('clinic_reception.sync_catalog(uuid)', d)
    on conflict (sig) do update set def = excluded.def;
  execute replace(d, a1, b1);
  -- 2) the live pricing check on book / order_add
  n := 0;
  for r in select p.oid, s.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' sig
             from pg_proc p join pg_namespace s on s.oid = p.pronamespace
            where s.nspname in ('public', 'clinic_reception') and p.prokind = 'f' and position(a2 in p.prosrc) > 0 loop
    d := pg_get_functiondef(r.oid);
    if (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 then raise exception 'pricing check anchor repeated in %', r.sig; end if;
    insert into clinic_reception.service_later_saved_defs values (r.sig, d) on conflict (sig) do update set def = excluded.def;
    execute replace(d, a2, b2);
    n := n + 1;
  end loop;
  if n <> 1 then raise exception 'pricing check found in % functions (expected 1) — check the live definitions', n; end if;
end $$;

commit;
