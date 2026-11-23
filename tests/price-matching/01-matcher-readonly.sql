-- Contract price auto-matcher — READ ONLY (SELECT only, wrap in BEGIN READ ONLY ... ROLLBACK).
-- Classifies every row of every draft batch of clinic_prices against public.pricing_services.
-- Classes (auto = safe to confirm later through price_service_mapping_command 'source_review'):
--   alias      auto  : an alias already reviewed for this list (scope 'list:<id>') with same code/name+unit
--   code       auto  : row code = booking_code / canonical_code / clinic_reception.services.code of exactly ONE
--                      active service AND names agree (exact normalized, or word-Dice >= 0.35)
--   name       auto  : normalized name equals the normalized name of exactly ONE active service
--   variant    bulk  : exact name except the «شامل/غير شامل المستلزمات» wording differs — one owner decision
--   fuzzy      review: best word-Dice similarity >= 0.6 (top 3 candidates) — never auto-confirmed
--   ambiguous  review: code/name hits >1 service, or code hits but name disagrees
--   unmatched  review: nothing above
-- held       review: an auto match blocked by a flag below (the RPC would refuse it or the price looks wrong)
-- Extra flags: price_zero (<=0 / empty), price_10x (>10x base_price), dup_target (2+ rows of one batch -> same
-- service with different price/unit), item_conflict (list already has that service at another
-- price/unit — the RPC refuses), confirmed (already done, skipped).
begin read only;
with norm_fn as (select 1),
svc as (
  select s.id, s.name, s.base_price, (s.name ~ 'شامل|مستلزمات') sup, s.booking_code, s.canonical_code,
         trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(translate(regexp_replace(regexp_replace(lower(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(s.name,''),'ٌ(ي)','\1','g'),'ٌ','ي','g'),'ً( |$|\))','ي\1','g'),'[\(\)]\s*غير شامل[^()]*[\(\)]',' ','g'),'[\(\)]\s*(شامل|يشمل)[^()]*[\(\)]',' شامل ','g'),'(غير شامل|لا يشمل|بدون) (ال)?مستلزمات','','g')),'[ً-ٰٟـ]','','g'),'[*"''`|+؟…]',' ','g'),'أإآٱىة٠١٢٣٤٥٦٧٨٩()[]-_/\.,،:','اااايه0123456789'),'\s+',' ','g'),'(^| )(و ?)?ال','\1','g'),'(^| )و( |$)',' ','g'),'(^| )شعه( |$)','\1اشعه\2','g')) nname
  from public.pricing_services s where s.active
),
codes as (  -- every code that points at an active service
  select upper(trim(booking_code)) code, id from svc where nullif(trim(booking_code),'') is not null
  union select upper(trim(canonical_code)), id from svc where nullif(trim(canonical_code),'') is not null
  union select upper(trim(r.code)), r.pricing_service_id from clinic_reception.services r join svc on svc.id=r.pricing_service_id
        where r.active and nullif(trim(r.code),'') is not null
),
code1 as (select code, min(id::text)::uuid id, count(distinct id) n from codes group by code),
name1 as (select nname, min(id::text)::uuid id, count(*) n from svc group by nname),
stok as (select distinct s.id, t from svc s, unnest(string_to_array(s.nname,' ')) t where length(t)>=2),
slen as (select id, count(*) n from stok group by id),
rws as (
  select l.id list_id, l.name list_name, l.list_kind, b.id batch_id, b.revision batch_rev, (o.i-1)::int idx, o.x,
         coalesce(o.x->>'name','') rname, upper(trim(coalesce(o.x->>'code',''))) rcode, coalesce(o.x->>'unit','') runit,
         nullif(o.x->>'price','') rprice, (coalesce(o.x->>'name','') ~ 'شامل|مستلزمات') rsup, coalesce(nullif(o.x->>'category',''),nullif(o.x->>'sheet',''),'بدون قسم') rcat, coalesce((o.x->>'confirmed')::boolean,false) done,
         trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(translate(regexp_replace(regexp_replace(lower(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(o.x->>'name',''),'ٌ(ي)','\1','g'),'ٌ','ي','g'),'ً( |$|\))','ي\1','g'),'[\(\)]\s*غير شامل[^()]*[\(\)]',' ','g'),'[\(\)]\s*(شامل|يشمل)[^()]*[\(\)]',' شامل ','g'),'(غير شامل|لا يشمل|بدون) (ال)?مستلزمات','','g')),'[ً-ٰٟـ]','','g'),'[*"''`|+؟…]',' ','g'),'أإآٱىة٠١٢٣٤٥٦٧٨٩()[]-_/\.,،:','اااايه0123456789'),'\s+',' ','g'),'(^| )(و ?)?ال','\1','g'),'(^| )و( |$)',' ','g'),'(^| )شعه( |$)','\1اشعه\2','g')) nname
  from clinic_prices.lists l join clinic_prices.batches b on b.list_id=l.id and b.status='draft'
  cross join lateral jsonb_array_elements(b.rows) with ordinality o(x,i)
  where l.deleted_at is null
),
m as (
  select r.*,
    (select a.service_id from clinic_prices.aliases a join svc on svc.id=a.service_id
      where a.scope_key='list:'||r.list_id and a.unit=r.runit
        and (a.external_name=r.rname or (r.rcode<>'' and upper(a.external_code)=r.rcode)) limit 1) alias_sid,
    c.id code_sid, c.n code_n, n1.id name_sid, n1.n name_n
  from rws r left join code1 c on c.code=r.rcode and r.rcode<>'' left join name1 n1 on n1.nname=r.nname and r.nname<>''
),
cls as (
  select m.*,
    case when done then 'confirmed'
         when alias_sid is not null then 'alias'
         when code_n=1 and (name_sid=code_sid or (select 2.0*count(*)/nullif((select n from slen where id=code_sid)+cardinality(array(select distinct t from unnest(string_to_array(m.nname,' ')) t where length(t)>=2)),0) from stok st where st.id=code_sid and st.t=any(string_to_array(m.nname,' ')))>=0.35) then 'code'
         when name_n=1 and (code_sid is null or code_sid=name_sid) and rsup=(select sup from svc where id=name_sid) then 'name'
         when name_n=1 and (code_sid is null or code_sid=name_sid) then 'variant'
         when code_n>1 or name_n>1 or code_n=1 then 'ambiguous'
         else 'nomatch' end cls0
  from m
),
fin as (
  select c.*,
    case cls0 when 'alias' then alias_sid when 'code' then code_sid when 'name' then name_sid when 'variant' then name_sid end sid,
    t.top3, t.best
  from cls c
  left join lateral (
    select jsonb_agg(jsonb_build_object('id',q.id,'name',q.name,'code',coalesce(q.booking_code,q.canonical_code),
             'base_price',q.base_price,'sim',round(q.sim,2)) order by q.sim desc) top3, max(q.sim) best
    from (select s.*, 2.0*count(*)/(sl.n+rt.n) sim
          from (select array_agg(distinct t) ts, count(distinct t) n from unnest(string_to_array(c.nname,' ')) t where length(t)>=2) rt
          join stok st on st.t=any(rt.ts) join svc s on s.id=st.id join slen sl on sl.id=s.id
          where c.cls0 in ('nomatch','ambiguous')
          group by s.id,s.name,s.base_price,s.sup,s.booking_code,s.canonical_code,s.nname,sl.n,rt.n
          order by sim desc, s.name limit 3) q
  ) t on true
),
out0 as (
  select f.*,
    case when cls0='nomatch' and best>=0.6 then 'fuzzy' when cls0='nomatch' then 'unmatched' else cls0 end k0,
    coalesce((select base_price from svc where id=f.sid),(f.top3->0->>'base_price')::numeric) ref_base,
    (rprice is null or rprice !~ '^[0-9]+(\.[0-9]+)?$' or rprice::numeric<=0) price_zero
  from fin f
),
out1 as (
  select o.*, coalesce(not price_zero and ref_base>0 and rprice::numeric>10*ref_base,false) price_10x,
    exists(select 1 from clinic_prices.items it where it.list_id=o.list_id and it.service_id=o.sid
           and (price_zero or it.fixed_price is distinct from rprice::numeric or it.unit is distinct from o.runit)) item_conflict
  from out0 o
),
dups as (  -- auto rows whose target service repeats in the same batch with a different price/unit
  select batch_id, sid from out1 where k0 in ('alias','code','name','variant')
  group by batch_id, sid having count(distinct coalesce(rprice,'')||'|'||runit)>1
),
out as (
  select o.*, coalesce((o.batch_id,o.sid) in (select * from dups),false) dup_target,
    case when k0 in ('alias','code','name','variant') and (price_zero or price_10x or item_conflict or (o.batch_id,o.sid) in (select * from dups))
         then 'held' else k0 end klass,
    k0 as matched_by
  from out1 o
)
select 'summary' part, jsonb_agg(s order by s.list_name) data from (
  select list_name, list_kind, count(*) rows_total,
    count(*) filter(where klass='confirmed') already_confirmed,
    count(*) filter(where klass='alias') auto_alias,
    count(*) filter(where klass='code') auto_code,
    count(*) filter(where klass='name') auto_name,
    count(*) filter(where klass='variant') variant_supplies,
    count(*) filter(where klass='fuzzy') fuzzy_review,
    count(*) filter(where klass='ambiguous') ambiguous_review,
    count(*) filter(where klass='unmatched') unmatched,
    count(*) filter(where price_zero) price_zero,
    count(*) filter(where price_10x) price_10x,
    count(*) filter(where dup_target) dup_target,
    count(*) filter(where item_conflict) item_conflict,
    count(*) filter(where klass='held') auto_but_held,
    count(distinct batch_id) batches
  from out o group by list_name, list_kind) s
union all
select 'samples', jsonb_agg(jsonb_build_object('l',list_name,'k',klass,'by',matched_by,'n',rname,'p',rprice,
  'why',concat_ws(',',case when price_zero then 'zero' end,case when price_10x then '10x' end,case when dup_target then 'dup' end,case when item_conflict then 'item' end),
  'c1',top3->0->>'name','s1',top3->0->>'sim','b1',coalesce(top3->0->>'base_price',(select base_price::text from svc where id=sid)),
  'c2',top3->1->>'name','s2',top3->1->>'sim') order by list_name, klass, rn)
from (select o.*, row_number() over(partition by list_id, klass order by md5(rname)) rn from out o
      where klass in ('fuzzy','ambiguous','unmatched','held','variant')) z where rn<=4
union all
select 'held_reasons', jsonb_object_agg(list_name, r) from (select list_name, jsonb_build_object(
  'zero',count(*) filter(where price_zero),'10x',count(*) filter(where price_10x),'dup',count(*) filter(where dup_target),
  'item',count(*) filter(where item_conflict)) r from out where klass='held' group by list_name) h
union all
select 'review_by_category', jsonb_object_agg(list_name, cats) from (
  select list_name, jsonb_agg(jsonb_build_array(rcat,n,f) order by n desc) filter (where rk<=12) cats from (
    select list_name, rcat, count(*) n, count(*) filter(where klass='fuzzy') f, row_number() over(partition by list_name order by count(*) desc) rk
    from out where klass in ('unmatched','fuzzy','ambiguous') group by list_name, rcat) c group by list_name) z
union all
select 'cross_list', jsonb_build_object(
  'review_rows', count(*), 'distinct_names', count(distinct nname),
  'names_in_2plus_lists', (select count(*) from (select nname from out where klass in ('unmatched','fuzzy','ambiguous') and list_kind='reference' group by nname having count(distinct list_id)>1) q))
from out where klass in ('unmatched','fuzzy','ambiguous') and list_kind='reference';
rollback;
