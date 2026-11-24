-- Dated OFFER price lists (owner 2026-11-24): «الاسعار ف العروض او الباكيدجات يحكمها سيزون وكمان عروض منافسين …
-- يفضل ان الباكيدج او العرض يبقي فيه فعلا تاريخ انتهاء وبداية». Generic: any season, any services.
--
-- * clinic_prices.lists.list_kind gains 'offer'. An offer is a center-scope list (no contract) with fixed prices and
--   valid_from/valid_to. It is created, imported, submitted and approved through the SAME price-list RPCs and rules
--   (price_lists_command save/submit/review, price_import_command). The center-overlap rule only looks at
--   list_kind='center', so offers live on top of the active center list.
-- * Two ACTIVE offers may not price the same service on overlapping dates (trigger below): one price per day.
-- * clinic_prices.resolve() is wrapped (original kept as clinic_prices.resolve_before_offer). For the center price
--   (p_contract is null): if an active offer covers p_date and has a fixed price for the service, that price is
--   returned (source 'offer', list id, offer end date); otherwise the original resolve runs unchanged. Contract
--   pricing (p_contract given) is never touched. Reception copies follow through clinic_reception.sync_catalog's
--   existing price-evidence fingerprint, so the offer starts on valid_from and the normal price returns the day
--   after valid_to by itself.
-- Rollback: supabase/rollbacks/20261123160000_offer_price_lists.rollback.sql
begin;

do $$declare c record;begin
 for c in select conname from pg_constraint where conrelid='clinic_prices.lists'::regclass and contype='c' and pg_get_constraintdef(oid) ~ 'list_kind' loop
  execute format('alter table clinic_prices.lists drop constraint %I',c.conname);
 end loop;
end $$;
alter table clinic_prices.lists add constraint lists_list_kind_check check (list_kind in ('center','reference','offer'));

-- An offer is always center scope with real dates and fixed prices.
create or replace function clinic_prices.guard_offer_list() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.list_kind='offer' then
  if new.contract_id is not null then raise exception 'العرض لأسعار سونو / دار النقاهة فقط؛ ما ينفعش يتربط بعقد جهة';end if;
  if new.mode<>'fixed' then raise exception 'العرض لازم يكون بأسعار ثابتة';end if;
  if new.valid_to<new.valid_from then raise exception 'تاريخ نهاية العرض قبل بدايته';end if;
  if new.status='active' and (tg_op='INSERT' or old.status is distinct from 'active') then
   if exists(select 1 from clinic_prices.lists o
              join clinic_prices.items oi on oi.list_id=o.id
              join clinic_prices.items ni on ni.list_id=new.id and ni.service_id=oi.service_id
              where o.id<>new.id and o.list_kind='offer' and o.status='active' and o.deleted_at is null
                and daterange(o.valid_from,o.valid_to,'[]') && daterange(new.valid_from,new.valid_to,'[]')) then
    raise exception 'فيه عرض تاني معتمد بيسعّر نفس الخدمة في نفس الأيام؛ عدّل التواريخ أو شيل الخدمة من أحد العرضين';
   end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function clinic_prices.guard_offer_list() from public,anon,authenticated;
drop trigger if exists offer_list_guard on clinic_prices.lists;
create trigger offer_list_guard before insert or update of list_kind,contract_id,mode,valid_from,valid_to,status on clinic_prices.lists
 for each row execute function clinic_prices.guard_offer_list();

-- Keep the current resolve body; the public behaviour gains the offer layer.
do $$begin
 if to_regprocedure('clinic_prices.resolve_before_offer(uuid,numeric,date,uuid)') is null then
  alter function clinic_prices.resolve(uuid,numeric,date,uuid) rename to resolve_before_offer;
 end if;
end $$;
revoke all on function clinic_prices.resolve_before_offer(uuid,numeric,date,uuid) from public,anon,authenticated;

create or replace function clinic_prices.resolve(p_service uuid,p_base numeric,p_date date,p_contract uuid default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare o record;
begin
 if p_contract is null then
  select l.id,l.name,l.version,l.valid_from,l.valid_to,i.fixed_price into o
   from clinic_prices.lists l join clinic_prices.items i on i.list_id=l.id and i.service_id=p_service
   where l.list_kind='offer' and l.status='active' and l.deleted_at is null and p_date between l.valid_from and l.valid_to
     and i.fixed_price is not null and i.fixed_price>0
   order by l.valid_from desc,l.id limit 1;
  if found then
   return jsonb_build_object('price',round(o.fixed_price,2),'source','offer','reason','عرض: '||o.name||' — لحد '||to_char(o.valid_to,'YYYY-MM-DD'),
     'list_id',o.id,'version',o.version,'offer_from',o.valid_from,'offer_until',o.valid_to);
  end if;
 end if;
 return clinic_prices.resolve_before_offer(p_service,p_base,p_date,p_contract);
end $$;
revoke all on function clinic_prices.resolve(uuid,numeric,date,uuid) from public,anon,authenticated;

commit;
