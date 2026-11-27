-- Live check for 20261127020000 (clinic_knowledge_feed for the WhatsApp agent). One transaction, ends in ROLLBACK.
-- Before the migration is live:
--   sed '/^begin;$/d;/^commit;$/d' supabase/migrations/20261127020000_clinic_knowledge_entity_prices.sql > /tmp/ckf_body.sql
--   psql -v ON_ERROR_STOP=1 -v body=/tmp/ckf_body.sql -f tests/clinic-knowledge-entity-prices-live-rollback.sql
-- After it is live: -v body=/dev/null. No patient data: entity names are aliased, and only counts and one 3-line price sample.
begin;
\i :body
set local role service_role;
create temp table ckf as select public.clinic_knowledge_feed() f;
reset role;
select 'summary' part, json_build_object('as_of', f->>'as_of', 'entities', jsonb_array_length(f->'entities'),
  'with_price_lines', (select count(*) from jsonb_array_elements(f->'entities') e where (e->>'has_list')::boolean),
  'percent_only', (select count(*) from jsonb_array_elements(f->'entities') e where not (e->>'has_list')::boolean),
  'offers', jsonb_array_length(f->'offers'),
  'offer_lines', (select coalesce(sum(jsonb_array_length(o->'lines')), 0) from jsonb_array_elements(f->'offers') o),
  'max_lines_per_entity', (select coalesce(max(jsonb_array_length(e->'lines')), 0) from jsonb_array_elements(f->'entities') e))::text from ckf;
select 'offer_sample' part, (select jsonb_build_object('name', o->>'name', 'valid_to', o->>'valid_to', 'first3', jsonb_path_query_array(o->'lines', '$[0 to 2]'), 'more', o->'more')
  from jsonb_array_elements(f->'offers') o limit 1)::text from ckf;
select 'entity_sample' part, (select jsonb_build_object('entity', 'E-sample', 'first3', jsonb_path_query_array(e->'lines', '$[0 to 2]'), 'more', e->'more')
  from jsonb_array_elements(f->'entities') e where (e->>'has_list')::boolean limit 1)::text from ckf;
select 'can_execute' part, json_build_object('anon', has_function_privilege('anon', 'public.clinic_knowledge_feed()', 'execute'),
  'authenticated', has_function_privilege('authenticated', 'public.clinic_knowledge_feed()', 'execute'),
  'service_role', has_function_privilege('service_role', 'public.clinic_knowledge_feed()', 'execute'))::text;
do $$ begin
  if has_function_privilege('anon', 'public.clinic_knowledge_feed()', 'execute') or has_function_privilege('authenticated', 'public.clinic_knowledge_feed()', 'execute')
    then raise exception 'FAIL: feed is callable by anon/authenticated'; end if;
  if (select f->'entities' from ckf) is null then raise exception 'FAIL: no entities array'; end if;
end $$;
select 'verdict' part, 'PASS (rolled back)';
rollback;
