-- READ ONLY. Dr Dina, «مراجعة أسماء الجهات», 2026-11-25 ~23:47Z: «اتربط 0 سطر: ما اتنفذش في: ميد نت … — ميد شور: الخدمة لها سعر أو وحدة مختلفة
-- في نفس اللائحة». That error comes from price_service_mapping_command(source_review) (mig 20261028215551, line 315): the chosen Sono
-- service is ALREADY an item of that list (unique list_id+service_id) with a different fixed_price or unit. The refused call rolls back,
-- so nothing about it is in clinic_prices.audit. «بعدين» in that screen is browser-local only (no server state).
-- Wrap: BEGIN READ ONLY … ROLLBACK (this file does it). Paste back every 'part' row to claude/price-matcher-output (relay/34-…).
-- No patient data is read. To probe the exact services she tried, edit the two VALUES lists in probe_code / probe_text below.
begin read only;
with
probe_code(code) as (values ('__none__')),            -- e.g. ('0001239'),('0000123')  Sono booking codes she chose
probe_text(txt)  as (values ('__none__')),            -- e.g. ('كشف باطنة')            part of the entity row name
lists as (
  select l.id, l.name, l.status, l.list_kind, l.revision, l.contract_id
  from clinic_prices.lists l
  where l.deleted_at is null and l.list_kind='reference'
    and (l.name ~* 'ميد ?نت|ميدنت|med ?net' or l.name ~* 'ميد ?شور|ميدشور|med ?sure')),
items as (
  select i.list_id, i.id item_id, i.service_id, s.booking_code, s.name service_name, i.fixed_price, i.unit, i.external_name, i.external_code,
         sec.name section, i.source_ref, trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(translate(regexp_replace(regexp_replace(lower(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(i.external_name,''),'ٌ(ي)','\1','g'),'ٌ','ي','g'),'ً( |$|\))','ي\1','g'),'[\(\)]\s*غير شامل[^()]*[\(\)]',' ','g'),'[\(\)]\s*(شامل|يشمل)[^()]*[\(\)]',' شامل ','g'),'(غير شامل|لا يشمل|بدون) (ال)?مستلزمات','','g')),'[ً-ٰٟـ]','','g'),'[*"''`|+؟…]',' ','g'),'أإآٱىة٠١٢٣٤٥٦٧٨٩()[]-_/\.,،:','اااايه0123456789'),'\s+',' ','g'),'(^| )(و ?)?ال','\1','g'),'(^| )و( |$)',' ','g'),'(^| )شعه( |$)','\1اشعه\2','g')) nname
  from clinic_prices.items i join lists l on l.id=i.list_id
  join public.pricing_services s on s.id=i.service_id
  left join clinic_prices.sections sec on sec.id=i.section_id),
pending as (
  select b.list_id, b.id batch_id, b.revision batch_revision, (o.n-1)::int idx, o.x row,
         case when o.x->>'price' ~ '^[0-9]+(\.[0-9]+)?$' then (o.x->>'price')::numeric end price, coalesce(o.x->>'unit','') unit,
         trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(translate(regexp_replace(regexp_replace(lower(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(o.x->>'name',''),'ٌ(ي)','\1','g'),'ٌ','ي','g'),'ً( |$|\))','ي\1','g'),'[\(\)]\s*غير شامل[^()]*[\(\)]',' ','g'),'[\(\)]\s*(شامل|يشمل)[^()]*[\(\)]',' شامل ','g'),'(غير شامل|لا يشمل|بدون) (ال)?مستلزمات','','g')),'[ً-ٰٟـ]','','g'),'[*"''`|+؟…]',' ','g'),'أإآٱىة٠١٢٣٤٥٦٧٨٩()[]-_/\.,،:','اااايه0123456789'),'\s+',' ','g'),'(^| )(و ?)?ال','\1','g'),'(^| )و( |$)',' ','g'),'(^| )شعه( |$)','\1اشعه\2','g')) nname
  from clinic_prices.batches b join lists l on l.id=b.list_id
  cross join lateral jsonb_array_elements(b.rows) with ordinality o(x,n)
  where b.status='draft' and not coalesce((o.x->>'confirmed')::boolean,false)
    and coalesce(o.x->>'review_status','') not in ('deferred','proposed'))
-- 1. The two lists: state the screen needs (draft + revision) and sizes.
select 'lists' part, jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'status',l.status,'revision',l.revision,
  'items',(select count(*) from items i where i.list_id=l.id),
  'pending_rows',(select count(*) from pending p where p.list_id=l.id),
  'draft_batches',(select count(*) from clinic_prices.batches b where b.list_id=l.id and b.status='draft')) order by l.name) data
from lists l
union all
-- 2. AUTO: pending rows whose name equals (normalized) the entity name of an item ALREADY in the same list, with a different price or unit.
--    Linking such a row to that item's service is exactly what fails. 'hint' says which of the 3 owner fixes fits.
select 'auto_conflicts', jsonb_agg(jsonb_build_object('list',l.name,'batch',p.batch_id,'idx',p.idx,
  'row',jsonb_build_object('name',p.row->>'name','code',p.row->>'code','unit',p.unit,'price',p.row->>'price','category',p.row->>'category'),
  'existing',jsonb_build_object('code',i.booking_code,'service',i.service_name,'price',i.fixed_price,'unit',i.unit,
     'entity_name',i.external_name,'entity_code',i.external_code,'section',i.section,'src_row',i.source_ref->'row','src_sheet',i.source_ref->>'sheet'),
  'hint',case when p.price=i.fixed_price and p.unit<>i.unit then 'unit_differs'
              when coalesce(p.row->>'code','')<>'' and p.row->>'code'=i.external_code then 'same_entity_code_new_price'
              when coalesce(p.row->>'code','')<>'' and i.external_code<>'' then 'different_entity_code_variant'
              else 'price_differs' end) order by l.name, i.booking_code, p.idx)
from pending p join lists l on l.id=p.list_id
join items i on i.list_id=p.list_id and i.nname=p.nname
where p.price is distinct from i.fixed_price or p.unit<>i.unit
union all
-- 3. Same-name pending rows that appear in BOTH lists (the groups the screen merges), with each list's price, and whether a Sono
--    service with that entity name is already in either list. Summary only (counts + first 200 groups).
select 'both_lists_groups', jsonb_build_object('groups',count(*),'with_existing_item',count(*) filter (where g.has_item),
  'sample',(jsonb_agg(jsonb_build_object('name',g.name,'prices',g.prices,'existing',g.existing) order by g.name) filter (where g.has_item)))
from (select p.nname, min(p.row->>'name') name, jsonb_object_agg(l.name, p.row->>'price') prices,
             bool_or(exists(select 1 from items i where i.list_id=p.list_id and i.nname=p.nname)) has_item,
             (select jsonb_agg(distinct jsonb_build_array(i.booking_code,i.fixed_price,i.unit)) from items i where i.nname=p.nname) existing
      from pending p join lists l on l.id=p.list_id group by p.nname having count(distinct p.list_id)=2) g
union all
-- 4. PROBE by Sono code: the line that blocks the link in each list (what Dr Dina needs to see per service she tried).
select 'probe_by_code', jsonb_agg(jsonb_build_object('list',l.name,'code',i.booking_code,'service',i.service_name,'price',i.fixed_price,'unit',i.unit,
  'entity_name',i.external_name,'entity_code',i.external_code,'section',i.section,'src',i.source_ref) order by i.booking_code,l.name)
from items i join lists l on l.id=i.list_id where i.booking_code in (select code from probe_code)
union all
-- 5. PROBE by entity-name text: the pending rows she would be linking, per list.
select 'probe_by_text', jsonb_agg(jsonb_build_object('list',l.name,'batch',p.batch_id,'batch_revision',p.batch_revision,'idx',p.idx,
  'name',p.row->>'name','code',p.row->>'code','unit',p.unit,'price',p.row->>'price','category',p.row->>'category') order by l.name,p.idx)
from pending p join lists l on l.id=p.list_id
where exists(select 1 from probe_text t where t.txt<>'__none__' and p.row->>'name' like '%'||t.txt||'%')
union all
-- 6. What DID reach the server for these two lists around her attempt (successful actions only; refused ones roll back).
select 'audit_window', jsonb_agg(jsonb_build_object('at',a.created_at,'actor',a.actor_id,'action',a.action,'list',l.name,
  'rows',jsonb_array_length(coalesce(a.details->'indexes','[]')),'service',a.details->>'service_id') order by a.created_at)
from clinic_prices.audit a join lists l on l.id=a.list_id
where a.created_at between timestamptz '2026-11-25 20:00Z' and timestamptz '2026-11-26 03:00Z';
rollback;
