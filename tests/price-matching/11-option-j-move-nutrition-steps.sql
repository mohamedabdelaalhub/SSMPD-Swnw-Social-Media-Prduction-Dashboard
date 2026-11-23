-- OPTION ج (only if the owner picks it): keep the section «التغذية والتخسيس» in the center list and move the matching
-- catalogue services from category «الجلدية والتجميل» to «التغذية والتخسيس», so the list and the catalogue agree.
-- Scope = names that appear in the center list section «التغذية والتخسيس» AND exist active under «الجلدية والتجميل»
-- (11 per preflight 04). Category only: booking department, codes, prices and reception links do not change.
-- Same write as the pricing screen (pricing_services update under RLS, as the owner). Idempotent.
-- Undo = set category back to «الجلدية والتجميل» for the ids listed in the NOTICE.
select set_config('request.jwt.claims','{"sub":"21a0b295-f4ca-472d-b48b-7be456cf0c64","role":"authenticated"}',true);
create temp table j_ids on commit drop as
 select p.id,p.name from public.pricing_services p
 where p.active and p.category='الجلدية والتجميل'
   and p.name in (select trim(x->>'name') from clinic_prices.batches b join clinic_prices.sections s on s.id=b.section_id
                  cross join lateral jsonb_array_elements(b.rows) x
                  where b.list_id='12289346-917a-40e6-bd74-9b9696f844f4' and s.name='التغذية والتخسيس')
   and not exists(select 1 from public.pricing_services q where q.active and q.category='التغذية والتخسيس' and q.name=p.name and q.canonical_unit=p.canonical_unit);
do $$begin if (select count(*) from j_ids)>12 then raise exception 'unexpected scope: % services',(select count(*) from j_ids);end if;
 raise notice 'moving % services: %',(select count(*) from j_ids),(select string_agg(id::text,',') from j_ids);end $$;
grant select on j_ids to authenticated;
set local role authenticated;
update public.pricing_services set category='التغذية والتخسيس' where id in (select id from j_ids);
reset role;
do $$begin if exists(select 1 from public.pricing_services p join j_ids j on j.id=p.id where p.category<>'التغذية والتخسيس') then raise exception 'move did not apply (RLS refused?)';end if;end $$;
