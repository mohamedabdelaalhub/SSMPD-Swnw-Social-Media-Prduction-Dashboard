-- White Friday laser offer (Candela GentlePro) — owner 2026-11-24: prices as sent, «سعر … صالحة فترة شهر نوفمبر»,
-- full body incl. abdomen/back 2300 confirmed («ايوه دا عرض وايت فرايدي خاص»). Valid today → 2026-11-30, then the
-- normal prices return by themselves (mig 20261123160000). Single-session + pulse prices only; the «3 جلسات»
-- packages are package templates (reception chat, part B). Acts AS THE OWNER through the screen's RPCs:
-- price_lists_command save (list_kind offer) → submit → review active. Idempotent: does nothing if an offer with
-- this name already exists. Run inside BEGIN … COMMIT.
select set_config('request.jwt.claims','{"sub":"21a0b295-f4ca-472d-b48b-7be456cf0c64","role":"authenticated"}',true);
do $$
declare lid uuid;l clinic_prices.lists%rowtype;items jsonb;missing text;
 offer jsonb:='{"0001228":0.50,"0001317":450,"0001319":1350,"0001321":2200,"0001323":4300,
  "0001232":50,"0001239":140,"0001235":140,"0001230":190,"0001252":300,"0001241":220,"0001270":390,"0001294":485,
  "0001272":485,"0001292":790,"0001307":445,"0001309":780,"0001311":390,"0001314":1900,"0001333":2300}';
begin
 if public.my_admin_id() is distinct from 'bd5a528f-af8d-4ada-afe9-ce64e68b1d92'::uuid then raise exception 'wrong actor';end if;
 if exists(select 1 from clinic_prices.lists where name='عرض وايت فرايداي — ليزر كانديلا جنتل برو' and deleted_at is null) then raise notice 'offer already exists';return;end if;
 select string_agg(k,',') into missing from jsonb_object_keys(offer) k where not exists(select 1 from public.pricing_services where booking_code=k and active);
 if missing is not null then raise exception 'services not found/active: %',missing;end if;
 select jsonb_agg(jsonb_build_object('service_id',p.id,'fixed_price',(offer->>p.booking_code)::numeric,'notes','عرض وايت فرايداي')) into items
  from public.pricing_services p where p.active and p.booking_code in (select jsonb_object_keys(offer));
 lid:=public.price_lists_command('save',jsonb_build_object('id',null,'revision',null,'name','عرض وايت فرايداي — ليزر كانديلا جنتل برو','version',1,
   'issue_year',2026,'application_year',2026,'list_kind','offer','mode','fixed','fallback','base','discount_percent',0,'discount_amount',0,
   'allow_extra_discount','false','valid_from',current_date,'valid_to','2026-11-30','notes','عرض وايت فرايداي نوفمبر 2026 — جلسة واحدة ونبضات. قرار المالك 24-11.','items',items));
 select * into l from clinic_prices.lists where id=lid;
 perform public.price_lists_command('submit',jsonb_build_object('id',lid,'revision',l.revision));
 perform public.price_lists_command('review',jsonb_build_object('id',lid,'decision','active','review_note','عرض وايت فرايداي — موافقة المالك 24-11'));
end $$;
