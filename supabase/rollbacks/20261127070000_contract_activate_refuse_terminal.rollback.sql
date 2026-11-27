-- Rollback of 20261127070000: remove the terminal-contract checks. Safe to run twice.
begin;
do $rb$
declare
 fn regprocedure := to_regprocedure('public.contracting_contract_activate(uuid)');
 def text;
 a constant text := $qa$ if not found then raise exception 'العقد غير موجود';end if;$qa$;
 b constant text := $qb$ if not found then raise exception 'العقد غير موجود';end if;
 -- 20261127070000: an expired / rejected contract, or one whose end date has passed, is never activated
 if c.status in ('expired','rejected') then raise exception 'العقد ده «%» ومينفعش يتفعل؛ اعمل عقد جديد للجهة',case c.status when 'expired' then 'منتهي' else 'مرفوض' end;end if;
 if c.end_date is not null and c.end_date < (now() at time zone 'Africa/Cairo')::date then raise exception 'تاريخ نهاية العقد (%) عدّى؛ عدّل تاريخ النهاية من «تعديل العقد» الأول وبعدين فعّله',c.end_date;end if;$qb$;
begin
 def := pg_get_functiondef(fn);
 if position(b in def) = 0 then raise notice 'not patched, nothing to roll back'; return; end if;
 execute replace(def, b, a);
end $rb$;
revoke all on function public.contracting_contract_activate(uuid) from public, anon;
grant execute on function public.contracting_contract_activate(uuid) to authenticated;
commit;
