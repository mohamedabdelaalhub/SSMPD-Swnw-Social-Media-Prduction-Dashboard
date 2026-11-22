-- Center opening hours 10:00 → 24:00 (owner 2026-11-22: «مواعيد عمل الفرق في المركز من 10 ص الي 12 منتصف الليل ... مواعيد
-- المركز هتبقي كدة كلها»). The only hard-coded clinic opening hour in the database is the website / agent fallback booking
-- check clinic_reception.fallback_slot_ok (no slot before 08:00 Cairo). It becomes 10:00. The midnight end is unchanged
-- (a slot must end by the next day's 00:00). Doctors' own hours stay in their weekly schedules / availability.
-- In-place text patch (the anchor must occur exactly once; the old body is saved for rollback).
-- Rollback: supabase/rollbacks/20261122190000_center_hours_10.rollback.sql
begin;

create table if not exists clinic_reception.center_hours_saved_defs(sig text primary key, def text not null);
revoke all on clinic_reception.center_hours_saved_defs from public, anon, authenticated;

do $$
declare r record; d text; n int;
  a1 text := '(p_start at time zone ''Africa/Cairo'')::time >= time ''08:00''';
  b1 text := '(p_start at time zone ''Africa/Cairo'')::time >= time ''10:00''';
begin
  select p.oid, p.prosrc into r from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'clinic_reception' and p.proname = 'fallback_slot_ok';
  if not found then raise exception 'fallback_slot_ok غير موجودة'; end if;
  n := (length(r.prosrc) - length(replace(r.prosrc, a1, ''))) / length(a1);
  if n <> 1 then raise exception 'fallback_slot_ok anchor found % times (expected 1) — check the live definition', n; end if;
  d := pg_get_functiondef(r.oid);
  insert into clinic_reception.center_hours_saved_defs values ('clinic_reception.fallback_slot_ok(uuid,timestamptz,timestamptz)', d)
    on conflict (sig) do update set def = excluded.def;
  execute replace(d, a1, b1);
end $$;

commit;
