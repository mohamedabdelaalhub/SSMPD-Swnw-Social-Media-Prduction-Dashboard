-- Rollback for the targeted tables. Pre-change snapshot showed ALL table
-- privileges for anon on each target. This restores that exact grant set.
DO $rollback$
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
  LOOP
    EXECUTE format('GRANT ALL PRIVILEGES ON TABLE %s TO anon', r.relation);
  END LOOP;
END
$rollback$;
