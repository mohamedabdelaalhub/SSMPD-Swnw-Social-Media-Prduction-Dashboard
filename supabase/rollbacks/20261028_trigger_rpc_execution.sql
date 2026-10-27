-- Rollback restores previous direct grants to these SECURITY DEFINER triggers.
-- Prior ACLs had EXECUTE granted to PUBLIC, anon and authenticated.
DO $rollback$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND p.prorettype::regtype = 'trigger'::regtype
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC, anon, authenticated', r.signature);
  END LOOP;

  FOR r IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND p.proname = ANY (ARRAY['ads_plan_violations','can_write_reel_cover','claude_autoschedule_ready'])
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', r.signature);
  END LOOP;
END
$rollback$;
