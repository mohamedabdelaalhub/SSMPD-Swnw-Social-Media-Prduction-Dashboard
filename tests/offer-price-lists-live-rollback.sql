-- Rule 9 live check for «العروض» (mig 20261123160000) — AS THE OWNER, the payloads the screen sends, then ROLLBACK.
-- «إنشاء قائمة» (offers tab) → price_lists_command save {list_kind:'offer', mode fixed, dates, items}
-- «إرسال للاعتماد» → price_lists_command submit; «اعتماد» → price_lists_command review decision active.
-- Then clinic_prices.resolve(): offer price inside the window, normal price the day after, contract path untouched.
-- Needs the migration applied first (or run it inside this transaction before \i-ing this file).
-- Run: psql -v ON_ERROR_STOP=1 -f tests/offer-price-lists-live-rollback.sql
begin;
select set_config('request.jwt.claims','{"sub":"21a0b295-f4ca-472d-b48b-7be456cf0c64","role":"authenticated"}',true);
create temp table of_result(step text,detail jsonb) on commit drop;
do $$
declare sid uuid;base numeric;lid uuid;l clinic_prices.lists%rowtype;q jsonb;d1 date:=current_date+3;d2 date:=current_date+9;
begin
 if public.my_admin_id() is distinct from 'bd5a528f-af8d-4ada-afe9-ce64e68b1d92'::uuid then raise exception 'wrong actor';end if;
 select id,base_price into sid,base from public.pricing_services where booking_code='0001239' and active;  -- ليزر الوجه كانديلا
 lid:=public.price_lists_command('save',jsonb_build_object('id',null,'revision',null,'name','عرض اختبار (يرجع)','version',1,'issue_year',2026,'application_year',2026,
   'list_kind','offer','mode','fixed','fallback','base','discount_percent',0,'discount_amount',0,'allow_extra_discount','false','valid_from',d1,'valid_to',d2,'notes','',
   'items',jsonb_build_array(jsonb_build_object('service_id',sid,'fixed_price',140))));
 select * into l from clinic_prices.lists where id=lid;
 insert into of_result values('save',jsonb_build_object('list_kind',l.list_kind,'mode',l.mode,'status',l.status,'from',l.valid_from,'to',l.valid_to,'items',(select count(*) from clinic_prices.items where list_id=lid)));
 perform public.price_lists_command('submit',jsonb_build_object('id',lid,'revision',l.revision));
 insert into of_result values('submit',jsonb_build_object('status',(select status from clinic_prices.lists where id=lid)));
 perform public.price_lists_command('review',jsonb_build_object('id',lid,'decision','active','review_note','اعتماد عرض اختبار'));
 insert into of_result values('review',jsonb_build_object('status',(select status from clinic_prices.lists where id=lid)));
 insert into of_result values('resolve inside',clinic_prices.resolve(sid,base,d1+1));
 insert into of_result values('resolve day after',clinic_prices.resolve(sid,base,d2+1));
 insert into of_result values('resolve before',clinic_prices.resolve(sid,base,d1-1));
 insert into of_result values('center list still active',(select jsonb_build_object('name',name,'status',status) from clinic_prices.lists where list_kind='center' and status='active' and deleted_at is null));
 insert into of_result values('audit',(select jsonb_agg(action order by id) from clinic_prices.audit where list_id=lid));
end $$;
select step,detail from of_result;
rollback;
