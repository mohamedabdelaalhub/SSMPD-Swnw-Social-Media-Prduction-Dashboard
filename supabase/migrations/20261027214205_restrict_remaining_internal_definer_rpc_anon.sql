-- Keep only confirmed public RPC surfaces available to anon: partner profiles/referrals,
-- public doctor listing/availability support and public health occasion dates.
-- Remove anon EXECUTE from remaining internal authorization, staff, inventory,
-- automation, task and report functions. Authenticated grants remain untouched.
DO $migration$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.prorettype::regtype::text <> 'trigger'
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
      AND p.proname <> ALL (ARRAY[
        'contracting_partner_public_profile',
        'contracting_partner_submit_referral',
        'list_active_sono_doctors',
        'is_active_sono_doctor',
        'upcoming_health_occasions'
      ])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.signature);
  END LOOP;
END
$migration$;
