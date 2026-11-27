-- Live dry run of 20261127120000_clinic_knowledge_entity_full_list. Ends in ROLLBACK: nothing is kept.
-- Run: psql -v ON_ERROR_STOP=1 -v body="$(sed '/^begin;$/d;/^commit;$/d' supabase/migrations/20261127120000_clinic_knowledge_entity_full_list.sql)" -f tests/clinic-knowledge-entity-full-list-live-rollback.sql
-- Shows per entity: lines sent, unpriceable count, complete_list, consultations; total payload size and run time.
-- Service names and prices only; no patient data.
begin;
:body
\timing on
create temp table f as select public.clinic_knowledge_feed() j;
\timing off
select e->>'entity' entity, jsonb_array_length(e->'lines') lines, (e->>'more')::int unpriced, e->'complete_list' complete_list, e->'consultations' consultations
from f, jsonb_array_elements(f.j->'entities') e order by 1;
select 'payload_bytes' k, length(j::text) v from f;
select 'grants' k, has_function_privilege('anon','public.clinic_knowledge_feed()','execute') anon, has_function_privilege('authenticated','public.clinic_knowledge_feed()','execute') authenticated, has_function_privilege('service_role','public.clinic_knowledge_feed()','execute') service_role;
rollback;
