-- Insurer/union price lists: apply the OWNER's link decisions of 23-11 through the dashboard's own RPC
-- public.price_service_mapping_command (action 'source_review' = link + confirm, 'source_defer' = exclude with a reason).
-- Acts AS THE OWNER (creator of every list). Reference lists in draft only; the expired «نقابة الاطباء 2023» is skipped.
-- Decisions (owner, 23-11, chat «ربط أسعار التعاقدات»):
--   * exact matches (alias / code / normalized name) and the 14 «شامل/غير شامل» variants → link
--   * MRI, CT, nuclear, endoscopy, cardiac cath / major operations → defer «مش عندنا»
--   * labs, x-ray/US, simple procedures, dental, neuro/audio, physio/speech, casts → link only STRONG suggestions
--     (word-Dice ≥ 0.80, strictly better than the 2nd candidate, and every differing word is noise such as ELISA/total/
--     «غير شامل المستلزمات»; an extra qualifier like «وضعين»/«ملون»/«الغدة الدرقية» sends it to review); the rest stays for review
--   * «متنوع» → nothing automatic
--   * catalogue twins (same name in الطوارئ and العظام): casts/splints/braces/slabs/wire → العظام; dressings/sutures/
--     catheter → الطوارئ; تقويم → الاسنان
--   * نقابة التجاريين duplicates: Troponine I / تركيب كانيولا / تعليق محلول وريدي (أقل من ساعتين) / فك جبيرة تمريض = 140; the
--     other-price row is deferred («تقدر تحذف الخدمات التانية اللي سعرها مختلف»)
--   * odd prices (0, or >10× the base) → NOT linked, left flagged for his review
-- Rows the RPC would refuse (alias conflict, list already holds that service at another price/unit, two rows → one
-- service at different prices) are left for review, never forced. Every call is its own sub-transaction: a refusal is
-- recorded in lk_log and the run continues. Idempotent: confirmed / already-deferred rows are skipped.
-- Run inside BEGIN … COMMIT (temp tables are ON COMMIT DROP). Dry-run: 20-link-decisions-dryrun.sql.
select set_config('request.jwt.claims','{"sub":"21a0b295-f4ca-472d-b48b-7be456cf0c64","role":"authenticated"}',true);
create temp table lk_rows on commit drop as
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
  where l.deleted_at is null and l.list_kind='reference' and l.status='draft' and l.name not like '%2023%'
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
, grp as (
  select o.*,
    case when nname ~ 'رنين|\mmri\M|m r i' then 'mri'
         when nname ~ 'مقطع|\mct\M|t c\M|multi ?slice' then 'ct'
         when nname ~ 'مسح ذر|ذري|نووي|\mscan\M|\mpet\M|يود مشع|isotope' then 'nuc'
         when nname ~ 'منظار|مناظير|endoscop|colonoscop|scopy' then 'endo'
         when nname ~ 'قسطره (قلب|شريان|تشخيص)|دعام|عمليه|استئصال|مخدر كلي|تخدير كلي|ولاده|قيصري|غسيل كلوي|ديال' then 'cath'
         when nname ~ 'اشع|سونار|موجات|دوبلر|دوبلكس|ماموجرام|mammo|x ?ray|بانوراما|echo|ايكو' then 'xray'
         when nname ~ 'رسم|هولتر|holter|سمع|قوقع|اتزان|emg|eeg|ecg|vep|tymp|audio|مجهود' then 'neuro'
         when nname ~ 'سن|ضرس|اسنان|عصب|حشو|تركيبه|طربوش|تقويم|لثه|فك' then 'dent'
         when nname ~ 'جبس|جبير|مشد|رباط|مفصل' then 'ortho'
         when nname ~ 'جلسه|تخاطب|تاهيل|علاج طبيعي|نفسي|ذكاء|تمرين|تدليك' then 'pt'
         when nname ~ 'غيار|حقن|خياط|غرز|فتح|كي|كانيولا|قسطره|بذل|تركيب|ازاله|قياس|كشف|عينه' then 'proc'
         when rname ~ '^[ -~]+$' or nname ~ '[a-z]{3}' then 'lab'
         else 'misc' end topic,
    (select jsonb_agg(s.id) from svc s where s.nname=o.nname) twins
  from out o
)
select g.list_id,g.list_name,g.batch_id,g.idx,g.rname,g.rcode,g.runit,g.rprice,g.nname,g.klass,g.matched_by,g.topic,g.sid,g.top3,g.best,
       g.price_zero,g.price_10x,g.item_conflict,g.dup_target,g.twins
from grp g where not g.done and coalesce(g.x->>'review_status','') not in ('deferred','proposed');

-- owner prices for the نقابة التجاريين duplicates (normalized names)
create temp table lk_owner_price on commit drop as
select * from (values ('^troponine i$',140::numeric),('^تركيب كانيولا',140),('^تعليق محلول وريدي.*اقل من ساعتين',140),('^فك جبيره.*تمريض',140)) v(key,price);

-- normalized catalogue names (same normalization as the matcher) and words that never change the service
create temp table lk_svcn on commit drop as
select s.id,
         trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(translate(regexp_replace(regexp_replace(lower(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(s.name,''),'ٌ(ي)','\1','g'),'ٌ','ي','g'),'ً( |$|\))','ي\1','g'),'[\(\)]\s*غير شامل[^()]*[\(\)]',' ','g'),'[\(\)]\s*(شامل|يشمل)[^()]*[\(\)]',' شامل ','g'),'(غير شامل|لا يشمل|بدون) (ال)?مستلزمات','','g')),'[ً-ٰٟـ]','','g'),'[*"''`|+؟…]',' ','g'),'أإآٱىة٠١٢٣٤٥٦٧٨٩()[]-_/\.,،:','اااايه0123456789'),'\s+',' ','g'),'(^| )(و ?)?ال','\1','g'),'(^| )و( |$)',' ','g'),'(^| )شعه( |$)','\1اشعه\2','g')) nname2
  from public.pricing_services s where s.active;
create temp table lk_noise(w text) on commit drop;
insert into lk_noise values ('elisa'),('centure'),('level'),('serum'),('test'),('quantitative'),('qualitative'),('ab'),('abs'),('antibody'),('antibodies'),('2026'),('شامل'),('شامله'),('غير'),('مستلزمات'),('ادويه'),('بواسطه'),('عدد'),('total');

create temp table lk_plan on commit drop as
with r as (
 select l.*,
  (select op.price from lk_owner_price op where l.list_name like '%التجاريين%' and l.nname ~ op.key limit 1) owner_price,
  -- twin resolution by the owner's rule
  (select s.id from public.pricing_services s
    where s.active and s.id in (select jsonb_array_elements_text(l.twins)::uuid)
      and s.category = case when l.nname ~ 'جبس|جبير|مشد|سلاب|سلك' then 'العظام'
                            when l.nname ~ 'غيار|غرز|قسطره' then 'الطوارئ'
                            when l.nname ~ 'تقويم' then 'الاسنان' end
    limit 1) twin_sid,
  (select count(*) from public.pricing_services s where s.active and s.id in (select jsonb_array_elements_text(l.twins)::uuid)
      and s.category = case when l.nname ~ 'جبس|جبير|مشد|سلاب|سلك' then 'العظام'
                            when l.nname ~ 'غيار|غرز|قسطره' then 'الطوارئ'
                            when l.nname ~ 'تقويم' then 'الاسنان' end) twin_n
 from lk_rows l),
d as (
 select r.*,
  case
   when owner_price is not null and (rprice is null or rprice !~ '^[0-9]+(\.[0-9]+)?$' or rprice::numeric<>owner_price) then 'defer_price'
   when klass in ('alias','code','name','variant') then 'link'
   when owner_price is not null and matched_by in ('alias','code','name','variant') and not price_zero and not price_10x and not item_conflict then 'link'
   when klass='ambiguous' and jsonb_array_length(coalesce(twins,'[]'))>1 and twin_n=1 then 'link_twin'
   when klass in ('fuzzy','unmatched','ambiguous') and topic in ('mri','ct','nuc','endo','cath') then 'defer_absent'
   when klass='fuzzy' and topic not in ('misc') and best>=0.8 and best>coalesce((top3->1->>'sim')::numeric,0)
        and not exists(  -- every word that differs between the two names must be noise (no extra qualifier like «وضعين»، «ملون»، «الغدة الدرقية»)
          select 1 from (
            (select t from unnest(string_to_array(r.nname,' ')) t where length(t)>=2
             except select t from unnest(string_to_array((select nname2 from lk_svcn where id=(r.top3->0->>'id')::uuid),' ')) t)
            union
            (select t from unnest(string_to_array((select nname2 from lk_svcn where id=(r.top3->0->>'id')::uuid),' ')) t where length(t)>=2
             except select t from unnest(string_to_array(r.nname,' ')) t)) diff(t)
          where t not in (select w from lk_noise)) then 'link_fuzzy'
   when klass='fuzzy' and topic not in ('misc') and best>=0.8 then 'review_fuzzy_extra_words'
   else 'review' end act0,
  case when klass='ambiguous' and twin_n=1 then twin_sid
       when klass='fuzzy' then (top3->0->>'id')::uuid else sid end target
 from r),
e as (  -- safety: never send what the RPC would refuse; never link odd prices
 select d.*,
  case when act0 like 'link%' and (price_zero or rprice !~ '^[0-9]+(\.[0-9]+)?$') then 'review_price_zero'
       when act0 like 'link%' and (price_10x or rprice::numeric>10*nullif((select base_price from public.pricing_services where id=d.target),0)) then 'review_price_10x'
       when act0 like 'link%' and exists(select 1 from clinic_prices.items i where i.list_id=d.list_id and i.service_id=d.target
              and (i.fixed_price is distinct from d.rprice::numeric or i.unit is distinct from d.runit)) then 'review_item_conflict'
       when act0 like 'link%' and exists(select 1 from clinic_prices.aliases a where a.scope_key='list:'||d.list_id and a.unit=d.runit
              and (a.external_name=d.rname or (d.rcode<>'' and upper(a.external_code)=d.rcode)) and a.service_id<>d.target) then 'review_alias_conflict'
       else act0 end act
 from d),
dup as (select list_id,target from e where act like 'link%' group by 1,2 having count(distinct rprice||'|'||runit)>1)
select e.*, case when e.act like 'link%' and (e.list_id,e.target) in (select * from dup) then 'review_dup_target' else e.act end action
from e;

create temp table lk_log(list_name text,batch_id uuid,idx int,action text,ok boolean,err text) on commit drop;
do $$
declare p record;lrev int;brev int;res jsonb;
begin
 if public.my_admin_id() is distinct from 'bd5a528f-af8d-4ada-afe9-ce64e68b1d92'::uuid then raise exception 'wrong actor: expected the owner admin';end if;
 for p in select * from lk_plan where action in ('link','link_twin','link_fuzzy','defer_absent','defer_price') order by list_name,batch_id,idx loop
  begin
   select revision into lrev from clinic_prices.lists where id=p.list_id;
   select revision into brev from clinic_prices.batches where id=p.batch_id;
   if p.action like 'link%' then
    res:=public.price_service_mapping_command(jsonb_build_object('action','source_review','list_id',p.list_id,'list_revision',lrev,
      'batch_id',p.batch_id,'batch_revision',brev,'indexes',jsonb_build_array(p.idx),'service_id',p.target,'details_confirmed',true,
      'note',case p.action when 'link' then 'ربط تلقائي بالاسم/الكود — قرار المالك 23-11 ('||p.matched_by||')'
                           when 'link_twin' then 'ربط بالنسخة حسب قاعدة المالك (عظام/طوارئ/أسنان) 23-11'
                           else 'اقتراح قوي '||round(p.best*100)||'% — قرار المالك 23-11' end));
   else
    res:=public.price_service_mapping_command(jsonb_build_object('action','source_defer','list_id',p.list_id,'list_revision',lrev,
      'batch_id',p.batch_id,'batch_revision',brev,'indexes',jsonb_build_array(p.idx),
      'note',case p.action when 'defer_absent' then 'مش عندنا — استبعاد بقرار المالك 23-11 ('||p.topic||')'
                           else 'سعر مكرر مخالف للسعر المعتمد '||(select price from lk_owner_price where p.nname ~ key limit 1)||' — قرار المالك 23-11' end));
   end if;
   insert into lk_log values(p.list_name,p.batch_id,p.idx,p.action,true,null);
  exception when others then
   insert into lk_log values(p.list_name,p.batch_id,p.idx,p.action,false,sqlerrm);
  end;
 end loop;
end $$;
