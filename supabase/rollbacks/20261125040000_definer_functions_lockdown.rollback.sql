-- Rollback of 20261125040000_definer_functions_lockdown.sql: restores lead_capture_gap's previous definition and the saved EXECUTE
-- grants of every touched function. Reopens the exposure — only if something that needs these functions broke.
begin;

do $$
declare r record; g text;
begin
  if to_regclass('public.definer_lockdown_saved') is null then raise exception 'definer_functions_lockdown غير مطبّق'; end if;
  for r in select * from public.definer_lockdown_saved order by sig loop
    if r.def is not null then execute r.def; end if;
    if to_regprocedure(r.sig) is null then continue; end if;
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    foreach g in array r.grantees loop
      execute format('grant execute on function %s to %s', r.sig, case when g = 'PUBLIC' then 'public' else quote_ident(g) end);
    end loop;
  end loop;
end $$;

drop table public.definer_lockdown_saved;

commit;
