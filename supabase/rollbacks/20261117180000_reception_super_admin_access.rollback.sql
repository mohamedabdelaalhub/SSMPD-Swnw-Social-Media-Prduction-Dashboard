begin;
do $rb$
declare f text;
begin
  f := pg_get_functiondef('clinic_reception.access_before_management_pilot(uuid,text)'::regprocedure);
  if position('allowed:=public.has_role(''super_admin'') or public.has_role(''general_manager'') or case' in f) = 0 then raise exception 'الملف مش متطبق'; end if;
  execute replace(f, 'allowed:=public.has_role(''super_admin'') or public.has_role(''general_manager'') or case', 'allowed:=case');
end $rb$;
commit;
