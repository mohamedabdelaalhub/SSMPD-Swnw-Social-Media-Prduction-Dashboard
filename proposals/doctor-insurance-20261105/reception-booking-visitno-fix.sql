-- FIX (no table/data change): single-service booking fails with 'invalid input syntax for type integer: ""'.
-- clinic_reception.bridge_command casts an EMPTY package_visit_no to integer inside its device-guard EXISTS.
-- Replaces only that cast with nullif(...,''), by patching the live function definition (same technique as the
-- 20261017051044 migration). Idempotent; keeps owner/grants (CREATE OR REPLACE). Review file, rollback provided.
begin;
do $do$
declare def text; patched text;
begin
 def:=pg_get_functiondef('clinic_reception.bridge_command(uuid,text,jsonb,uuid)'::regprocedure);
 if position($a$e.visit_no=nullif(p_payload->>'package_visit_no','')::integer$a$ in def)>0 then return; end if;
 patched:=replace(def,$a$e.visit_no=(p_payload->>'package_visit_no')::integer$a$,$b$e.visit_no=nullif(p_payload->>'package_visit_no','')::integer$b$);
 if patched=def then raise exception 'Expected package_visit_no cast not found in bridge_command'; end if;
 execute patched;
end $do$;
commit;
