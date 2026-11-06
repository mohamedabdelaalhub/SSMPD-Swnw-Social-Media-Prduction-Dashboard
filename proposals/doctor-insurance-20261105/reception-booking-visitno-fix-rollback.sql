begin;
do $do$
declare def text; patched text;
begin
 def:=pg_get_functiondef('clinic_reception.bridge_command(uuid,text,jsonb,uuid)'::regprocedure);
 patched:=replace(def,$b$e.visit_no=nullif(p_payload->>'package_visit_no','')::integer$b$,$a$e.visit_no=(p_payload->>'package_visit_no')::integer$a$);
 if patched<>def then execute patched; end if;
end $do$;
commit;
