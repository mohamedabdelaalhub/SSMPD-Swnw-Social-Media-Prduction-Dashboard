-- «تفعيل العقد» refuses an expired or rejected contract, or one whose end date has passed (owner screenshot 2026-11-27:
-- the button showed on a 2023 expired contract; the screen now hides it there, #921). Server guard so a direct call
-- cannot activate it either. Messages in plain Arabic; nothing changes when refused.
-- Anchored in-place patch of the LIVE definition (after the «العقد غير موجود» check). Safe to run twice.
-- Rollback: supabase/rollbacks/20261127070000_contract_activate_refuse_terminal.rollback.sql
begin;
do $mig$
declare
 fn regprocedure := to_regprocedure('public.contracting_contract_activate(uuid)');
 def text; n int;
 a constant text := $qa$ if not found then raise exception 'العقد غير موجود';end if;$qa$;
 b constant text := $qb$ if not found then raise exception 'العقد غير موجود';end if;
 -- 20261127070000: an expired / rejected contract, or one whose end date has passed, is never activated
 if c.status in ('expired','rejected') then raise exception 'العقد ده «%» ومينفعش يتفعل؛ اعمل عقد جديد للجهة',case c.status when 'expired' then 'منتهي' else 'مرفوض' end;end if;
 if c.end_date is not null and c.end_date < (now() at time zone 'Africa/Cairo')::date then raise exception 'تاريخ نهاية العقد (%) عدّى؛ عدّل تاريخ النهاية من «تعديل العقد» الأول وبعدين فعّله',c.end_date;end if;$qb$;
begin
 if fn is null then raise exception 'contracting_contract_activate is missing'; end if;
 def := pg_get_functiondef(fn);
 if position(b in def) > 0 then raise notice 'nothing to do (already in the wanted state)'; return; end if;
 n := (length(def) - length(replace(def, a, ''))) / length(a);
 if n <> 1 then raise exception 'anchor found % times (md5 %); refusing', n, (select md5(prosrc) from pg_proc where oid = fn); end if;
 execute replace(def, a, b);
end $mig$;
revoke all on function public.contracting_contract_activate(uuid) from public, anon;
grant execute on function public.contracting_contract_activate(uuid) to authenticated;
commit;
