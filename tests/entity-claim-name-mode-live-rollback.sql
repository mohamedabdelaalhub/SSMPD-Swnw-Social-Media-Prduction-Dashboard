-- Rule 9 live check for 20261126080000 (claims «اسم الخدمة في المطالبة») — one transaction, ends in ROLLBACK.
-- Before the mig is live: sed '/^begin;$/d;/^commit;$/d' supabase/migrations/20261126080000_entity_claim_name_mode.sql > /tmp/cnm_body.sql
--   psql -v ON_ERROR_STOP=1 -v body=/tmp/cnm_body.sql -v auth=<auth.users id> -f tests/entity-claim-name-mode-live-rollback.sql
-- After it is live: -v body=/dev/null. Run once per role that sees the claims screen (financial manager / contracts / owner,
-- and one finance user WITHOUT review rights: can_save must be false and the save must be refused).
begin;
\i :body
select set_config('request.jwt.claims',json_build_object('sub',:'auth','role','authenticated')::text,true);
create temp table cnm_pick on commit drop as select id, name from public.contracting_entities order by name limit 1;
grant select on cnm_pick to authenticated;
set local role authenticated;
select 'actor' part, json_build_object('admin',public.my_admin_id(),'role',public.my_role())::text;
select 'get_default' part, (select public.entity_claim_name_mode(id)::text from cnm_pick);
do $$declare r jsonb;begin
 begin r:=public.entity_claim_name_mode_save((select id from cnm_pick),'entity');raise notice 'save entity → %',r;
 r:=public.entity_claim_name_mode((select id from cnm_pick));if r->>'mode'<>'entity' then raise exception 'saved mode not read back: %',r;end if;raise notice 'read back → %',r;
 exception when insufficient_privilege then raise notice 'save refused (expected only when can_save=false): %',sqlerrm;end;
 begin perform public.entity_claim_name_mode_save((select id from cnm_pick),'bogus');raise exception 'bad mode accepted';
 exception when raise_exception then if sqlerrm like 'bad mode accepted%' then raise; end if; raise notice 'bad mode refused: %',sqlerrm;
 when insufficient_privilege then raise notice 'bad mode refused by permission: %',sqlerrm;end;
end $$;
reset role;
select 'anon_can_execute' part, json_build_object('get',has_function_privilege('anon','public.entity_claim_name_mode(uuid)','execute'),
  'save',has_function_privilege('anon','public.entity_claim_name_mode_save(uuid,text)','execute'))::text;
select 'audit_rows' part, count(*)::text from clinic_finance.audit where action='entity_claim_name_mode' and entity_id=(select id from cnm_pick);
rollback;
