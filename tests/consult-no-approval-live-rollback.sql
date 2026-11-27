-- Live dry-run for 20261127210000_consult_no_approval.sql. Run as postgres with -v body=<migration without begin/commit>, BEFORE the apply.
-- ONE transaction, ends ROLLBACK. Uses the active مصر هيلث كير contract and two live reception services: a «كشف» and a non-consultation.
begin;
\i :body
create temp table o(step text, actual text, ok boolean);
do $$ declare cid uuid; cons uuid; other uuid; r jsonb; base jsonb := jsonb_build_object('payer_coupon_no','0100638812','payer_coverage_percent','100');
begin
  select c.id into cid from public.contracting_entity_contracts c join public.contracting_entities e on e.id = c.entity_id
   where e.name ~ 'مصر ?هيلث' and c.status = 'active' order by c.id limit 1;
  select s.id into cons from clinic_reception.services s join clinic_reception.workspaces w on w.id = s.workspace_id
   where w.mode = 'live' and s.active and clinic_reception.is_consultation(s.id)
     and not coalesce((clinic_reception.payer_price(cid, s.id, current_date)->>'blocked')::boolean, true) order by s.code limit 1;
  select s.id into other from clinic_reception.services s join clinic_reception.workspaces w on w.id = s.workspace_id
   where w.mode = 'live' and s.active and not clinic_reception.is_consultation(s.id)
     and not coalesce((clinic_reception.payer_price(cid, s.id, current_date)->>'blocked')::boolean, true) order by s.code limit 1;
  insert into o values ('0 fixture', format('contract %s · consultation %s · other %s', cid is not null, cons is not null, other is not null), cid is not null and cons is not null and other is not null);
  begin r := clinic_reception.payer_contract_check(base || jsonb_build_object('payer_contract_id', cid), cons, current_date);
        insert into o values ('1 كشف without approval no / image', 'ok · consultation=' || coalesce(r->>'consultation','?') || ' · price ' || coalesce(r->>'price', r->>'net', '?'), true);
  exception when others then insert into o values ('1 كشف without approval no / image', 'ERR ' || sqlerrm, false); end;
  begin r := clinic_reception.payer_contract_check(base || jsonb_build_object('payer_contract_id', cid), other, current_date);
        insert into o values ('2 service without approval → refused', 'NOT refused', false);
  exception when others then insert into o values ('2 service without approval → refused', sqlerrm, sqlerrm like '%موافقة%'); end;
  begin r := clinic_reception.payer_contract_check(jsonb_build_object('payer_contract_id', cid, 'payer_coverage_percent','100'), cons, current_date);
        insert into o values ('3 كشف without coupon → refused', 'NOT refused', false);
  exception when others then insert into o values ('3 كشف without coupon → refused', sqlerrm, sqlerrm like '%الكوبون%'); end;
end $$;
select step, left(actual, 140) actual, ok from o;
rollback;
