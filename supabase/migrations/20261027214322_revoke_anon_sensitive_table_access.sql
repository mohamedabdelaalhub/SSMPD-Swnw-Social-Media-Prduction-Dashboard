-- Remove direct anon table access from patient records, staff identity/roles,
-- and leads. Authenticated policies/grants remain unchanged. Public booking
-- tables and partner RPCs are intentionally outside this scope.
DO $migration$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.oid::regclass AS relation
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r','p')
      AND (left(c.relname, 8) = 'patient_'
           OR c.relname IN ('patients','admins','admin_extra_roles','leads'))
      AND has_table_privilege('anon', c.oid, 'SELECT')
  LOOP
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE %s FROM anon', r.relation);
  END LOOP;
END
$migration$;
