-- Owner 2026-11-17 («دا حساب سوبر أدمن»): the super admin got «ليس لديك صلاحية هذه المساحة» when searching the patient archive
-- from الاستقبال والخدمات (clinic_reception_directory → access(workspace,'book')). On the live workspace 'book' was granted only to the
-- reception / customer_service roles; anyone else had to be the workspace owner or a member with that capability.
-- Change: on the LIVE workspace (live_enabled), super_admin and general_manager pass every reception action — the same rule
-- clinic_reception_journey_command already applies to them. Trial workspaces, the pilot gate in clinic_reception.access and every
-- other role are unchanged. Patched in place by an exact text anchor (must occur exactly once); md5 of the old body is printed in the notice.
-- Rollback: supabase/rollbacks/20261117180000_reception_super_admin_access.rollback.sql
begin;
do $mig$
declare f text; anchor text := 'allowed:=case'; n int;
begin
  if to_regprocedure('clinic_reception.access_before_management_pilot(uuid,text)') is null then raise exception 'access_before_management_pilot غير موجودة'; end if;
  f := pg_get_functiondef('clinic_reception.access_before_management_pilot(uuid,text)'::regprocedure);
  if position('has_role(''super_admin'') or public.has_role(''general_manager'') or case' in f) > 0 then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
  n := (length(f) - length(replace(f, anchor, ''))) / length(anchor);
  if n <> 1 then raise exception 'access_before_management_pilot تغيّرت عن النص المتوقع (anchor مرات: %)', n; end if;
  raise notice 'access_before_management_pilot md5 before: %', md5(f);
  execute replace(f, anchor, 'allowed:=public.has_role(''super_admin'') or public.has_role(''general_manager'') or case');
end $mig$;
commit;
