-- «مرجع السداد» clear message (owner 2026-11-24, accountant: a doctor payout with reference «1» was refused with
-- «راجع مبالغ التسوية ومرجع السداد», which blames the amounts). The base doctor command (20261017010341, renamed under later
-- wrappers) checked the amounts AND the reference length in ONE condition. Now two checks, same rules:
--   amounts wrong   → «راجع مبالغ التسوية» (unchanged rule);
--   reference < 2   → «مرجع السداد لازم يكون حرفين على الأقل (مثلاً رقم الإيصال أو التحويل)».
-- Message-only change; no rule, payout or posting changes. In-place anchor patch of the ONE function whose body holds the combined
-- check (found by its text, whatever it is named now); its body is saved for rollback.
-- Rollback: supabase/rollbacks/20261125070000_payout_reference_message.rollback.sql
begin;

do $$
declare a constant text := $a$ or length(trim(coalesce(p_payload->>'reference','')))<2 then raise exception 'راجع مبالغ التسوية ومرجع السداد';end if;$a$;
  b constant text := $b$ then raise exception 'راجع مبالغ التسوية';end if;
 if length(trim(coalesce(p_payload->>'reference','')))<2 then raise exception 'مرجع السداد لازم يكون حرفين على الأقل (مثلاً رقم الإيصال أو التحويل)';end if;$b$;
  f record; n int := 0; d text;
begin
  if exists (select 1 from pg_proc where position('مرجع السداد لازم يكون حرفين' in prosrc) > 0) then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  create table clinic_finance.payout_ref_saved_defs(oid_name text primary key, def text not null);
  revoke all on clinic_finance.payout_ref_saved_defs from public, anon, authenticated;
  for f in select p.oid, p.oid::regprocedure::text as sig from pg_proc p join pg_namespace s on s.oid = p.pronamespace
           where s.nspname in ('public', 'clinic_finance') and position(a in p.prosrc) > 0 loop
    n := n + 1;
    d := pg_get_functiondef(f.oid);
    if (length(d) - length(replace(d, a, ''))) <> length(a) then raise exception 'نقطة الربط مش موجودة مرة واحدة في % (md5 %)', f.sig, md5(d); end if;
    insert into clinic_finance.payout_ref_saved_defs values (f.sig, d);
    execute replace(d, a, b);
  end loop;
  if n = 0 then raise exception 'شرط مرجع السداد في أمر الطبيب مش موجود — راجع آخر نسخة'; end if;
  if n > 1 then raise exception 'لقيت % دوال فيها نفس الشرط — راجعها قبل التطبيق', n; end if;
end $$;

commit;
