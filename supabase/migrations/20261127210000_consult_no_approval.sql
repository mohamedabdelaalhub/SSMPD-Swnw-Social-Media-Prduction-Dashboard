-- Owner 2026-11-27 (urgent, reception with a مصر هيلث كير patient at د. أحمد سمير): «الكشف في كل الاحوال لا يحتاج موافقة، الخدمات فقط هي اللي محتاجة موافقة».
-- clinic_reception.payer_contract_check required «رقم موافقة التغطية» and «صورة الموافقة» for every service on an insurance / contract payer.
-- Now a CONSULTATION (reception service whose catalog name — or own name — starts with «كشف» / «الاستشارة» / «استشارة») needs neither:
-- contract active, price list, «الخدمة في قايمة الجهة», coupon / card number and coverage % are still checked exactly as before.
-- Every other service is unchanged (calls the previous body). Outer wrapper; previous body kept as
-- clinic_reception.payer_contract_check_before_consult. Rollback: supabase/rollbacks/20261127210000_consult_no_approval.rollback.sql
begin;

do $$ begin
  if to_regprocedure('clinic_reception.payer_contract_check(jsonb,uuid,date)') is null then raise exception 'payer_contract_check غير موجودة'; end if;
  if to_regprocedure('clinic_reception.payer_contract_check_before_consult(jsonb,uuid,date)') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

alter function clinic_reception.payer_contract_check(jsonb, uuid, date) rename to payer_contract_check_before_consult;
revoke all on function clinic_reception.payer_contract_check_before_consult(jsonb, uuid, date) from public, anon, authenticated;

create function clinic_reception.is_consultation(p_service uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from clinic_reception.services s
                   left join public.pricing_services ps on ps.id = nullif(to_jsonb(s)->>'pricing_service_id', '')::uuid
                  where s.id = p_service and btrim(coalesce(ps.name, s.name)) ~ '^(كشف|الاستشارة|استشارة)')
$$;
revoke all on function clinic_reception.is_consultation(uuid) from public, anon, authenticated;

create function clinic_reception.payer_contract_check(p jsonb, p_service uuid, p_day date) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare cid uuid; ok boolean; pr jsonb; cov numeric;
begin
  if not clinic_reception.is_consultation(p_service) then
    return clinic_reception.payer_contract_check_before_consult(p, p_service, p_day);
  end if;
  -- consultation: same checks without «رقم موافقة التغطية» / «صورة الموافقة»
  begin cid := nullif(p->>'payer_contract_id', '')::uuid; exception when others then cid := null; end;
  if cid is null then raise exception 'اختار الجهة (تأمين / تعاقد)'; end if;
  execute 'select exists (select 1 from public.contracting_entity_contracts c join public.contracting_entities e on e.id = c.entity_id
             where c.id = $1 and c.status = ''active'' and e.category in (''insurance'', ''unions'', ''clubs'')
               and (c.start_date is null or c.start_date <= $2) and (c.end_date is null or c.end_date >= $2))' into ok using cid, p_day;
  if not coalesce(ok, false) then raise exception 'عقد الجهة مش متفعّل — الحسابات تفعّل العقد الأول'; end if;
  pr := clinic_reception.payer_price(cid, p_service, p_day);
  if pr is null then raise exception 'مفيش قايمة أسعار متفعّلة للجهة دي في اليوم ده'; end if;
  if (pr->>'blocked')::boolean then raise exception 'الخدمة دي مش في قايمة أسعار الجهة'; end if;
  if length(btrim(coalesce(p->>'payer_coupon_no', ''))) < 2 then raise exception 'اكتب رقم الكوبون / الكارنيه'; end if;
  begin cov := nullif(btrim(coalesce(p->>'payer_coverage_percent', '')), '')::numeric; exception when others then cov := null; end;
  if cov is null or cov < 0 or cov > 100 then raise exception 'اكتب نسبة تحمّل الجهة (من 0 لـ 100٪) من الموافقة والكارت الطبي'; end if;
  return pr || jsonb_build_object('contract_id', cid, 'coverage', cov, 'proof', nullif(btrim(coalesce(p->>'payer_proof_path', '')), ''), 'consultation', true);
end $$;
revoke all on function clinic_reception.payer_contract_check(jsonb, uuid, date) from public, anon, authenticated;

commit;
