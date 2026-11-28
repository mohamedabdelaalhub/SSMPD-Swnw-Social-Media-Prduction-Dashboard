-- «رقم العملية من الصورة» (owner 2026-11-28 «الله عليك. وعايز الكلام دا يتسجل اوتوماتيك بعد كدة في وسايل الدفع دي», mockup
-- docs/ui-references/mockups/receipt-ocr.html on claude/receipt-ocr-mockup). When the receipt photo has no transaction number the
-- screen suggests a reference: wallets VF-<sender mobile>-<dd-mm>, any method <letter>-<file no>-<dd-mm>. It must never repeat:
-- public.clinic_reception_reference_free(p_method, p_base) returns p_base, or p_base-2, -3 … — the first one no reception payment
-- of the same method group already uses (the same grouping as the existing unique index payments(workspace_id, bank|instapay → bank,
-- reference), checked across workspaces). Read-only; any signed-in user; no table access. The server's existing duplicate refusal
-- stays the final guard.
-- Rollback: supabase/rollbacks/20261128020000_payment_reference_free.rollback.sql
do $$ begin
  if to_regprocedure('public.clinic_reception_reference_free(text,text)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if to_regclass('clinic_reception.payments') is null then raise exception 'جدول التحصيلات غير موجود'; end if;
end $$;
begin;
create function public.clinic_reception_reference_free(p_method text, p_base text) returns text
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare base text := btrim(coalesce(p_base, '')); grp text := case when p_method in ('bank', 'instapay') then 'bank' else coalesce(p_method, '') end;
  cand text; n int := 1;
begin
  if public.my_admin_id() is null then raise exception 'سجّل دخولك الأول'; end if;
  if length(base) < 3 or length(base) > 55 or base !~ '^[A-Za-z0-9-]+$' then raise exception 'مرجع غير صالح'; end if;
  loop
    cand := case when n = 1 then base else base || '-' || n end;
    exit when not exists (select 1 from clinic_reception.payments p
      where (case when p.method in ('bank', 'instapay') then 'bank' else p.method end) = grp and p.reference = cand);
    n := n + 1;
    if n > 99 then raise exception 'المرجع ده متكرر كتير — اكتبه بإيدك'; end if;
  end loop;
  return cand;
end $$;
revoke all on function public.clinic_reception_reference_free(text, text) from public, anon;
grant execute on function public.clinic_reception_reference_free(text, text) to authenticated;
commit;
