-- REFERRAL COMMISSION FIX (owner decision 2026-11-09): 10% to the referring doctor, ALL doctors, only on lab/radiology performed OUTSIDE the center,
-- computed AFTER the partner (outside) cost and AFTER supplies. Dr. Elham's special 200 EGP is cancelled (she is treated like every other doctor).
-- REPORT-ONLY: the amount is stored in clinic_reception.order_ext.priced (referral_commission, plus referral_base / referral_supplies). Nothing is posted to any balance here;
-- posting is the separate migration 20261109111000_referral_commission_posting.sql (needs the owner's approval).
-- Changes in public.clinic_reception_so_attach (the ONLY object touched; replaced in place, grants kept):
--   1. rate lookup + commission only when mode='external' and kind in (lab, radiology)   [was: also internal service/radiology/lab]
--   2. base = greatest(0, net - provider_payable - supplies)  [was: net]; when the PROVIDER bills the patient (billing_party='provider') the base is center_receivable - supplies
--      supplies = clinic_reception.orders.cost (0 until the order is executed; the posting step recomputes at completion)
-- Data (referral_rates rows for all doctors) is NOT in this file: see docs/referral-rates-seed.sql (not executed).
-- Pinned to the PRODUCTION definition read 2026-11-09: md5 9d6dfad2a03938e9cfb17185898c6bf4. Rollback: supabase/rollbacks/20261109110000_referral_commission_external.rollback.sql
begin;
do $mig$
declare d text; n text; o text; a text[] := array[
 E' if kind in (''service'',''radiology'',''lab'') and ref is not null then',
 E'   commission:=round(net*coalesce(rate,0)/100,2);\n',
 E'share numeric; priced jsonb;',
 E' priced:=jsonb_build_object(''net'',net,''category'',cat,''referral_rate'',coalesce(rate,0),''referral_commission'',commission,'];
 b text[] := array[
 E' if mode=''external'' and kind in (''lab'',''radiology'') and ref is not null then',
 '',
 E'share numeric; priced jsonb; refbase numeric:=0;',
 E' refbase:=greatest(0,case when bp=''provider'' then receivable else net-payable end-coalesce(o.cost,0));\n commission:=round(refbase*coalesce(rate,0)/100,2);\n priced:=jsonb_build_object(''net'',net,''category'',cat,''referral_rate'',coalesce(rate,0),''referral_commission'',commission,''referral_base'',refbase,''referral_supplies'',coalesce(o.cost,0),'];
 i int; ok boolean := true;
begin
  d := pg_get_functiondef('public.clinic_reception_so_attach(uuid,uuid,jsonb)'::regprocedure);
  if position('refbase' in d) > 0 then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  if md5(d) <> '9d6dfad2a03938e9cfb17185898c6bf4' then
    -- structural fallback: every anchor must occur exactly once (the function drifted in a way that does not touch what we change)
    for i in 1..4 loop
      if (length(d) - length(replace(d, a[i], ''))) <> length(a[i]) then ok := false; end if;
    end loop;
    if not ok then raise exception 'clinic_reception_so_attach تغيّرت عن نص الإنتاج المتوقع؛ راجع الفرق قبل التطبيق'; end if;
    raise notice 'so_attach md5 differs from the pinned production text; structural anchors matched';
  end if;
  for i in 1..4 loop
    if (length(d) - length(replace(d, a[i], ''))) <> length(a[i]) then raise exception 'anchor % not found exactly once', i; end if;
    d := replace(d, a[i], b[i]);
  end loop;
  execute d;
end $mig$;
commit;
