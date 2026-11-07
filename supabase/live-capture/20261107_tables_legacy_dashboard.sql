-- LIVE CAPTURE (2026-11-07): table structure read from production catalogs (read-only).
-- Reference snapshot only. NOT a migration: do not apply blindly.
-- Generated from docs/live-schema/tables-raw-20261107.txt. Unqualified names resolve via search_path (public).
-- Not captured: grants, policy roles (TO ...), permissive/restrictive flag, triggers, sequences ownership, seed rows.

CREATE TABLE legacy_dashboard.admins (
  id uuid not null default gen_random_uuid(),
  user_id uuid,
  email text not null,
  name text,
  role text not null default 'مستخدم'::text,
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  ai_enabled boolean not null default false,
  CONSTRAINT admins_email_key UNIQUE (email),
  CONSTRAINT admins_pkey PRIMARY KEY (id),
  CONSTRAINT admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT admins_user_id_key UNIQUE (user_id)
);
CREATE INDEX admins_email_idx ON legacy_dashboard.admins USING btree (lower(email));
ALTER TABLE legacy_dashboard.admins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "claim own invite" ON legacy_dashboard.admins FOR UPDATE USING (((user_id IS NULL) AND (lower(email) = lower((auth.jwt() ->> 'email'::text))))) WITH CHECK ((user_id = auth.uid()));
CREATE POLICY "read own or pending" ON legacy_dashboard.admins FOR SELECT USING (((user_id = auth.uid()) OR ((user_id IS NULL) AND (lower(email) = lower((auth.jwt() ->> 'email'::text))))));
CREATE POLICY "super reads all" ON legacy_dashboard.admins FOR SELECT USING (legacy_dashboard.is_super());
CREATE POLICY "super writes all" ON legacy_dashboard.admins FOR ALL USING (legacy_dashboard.is_super()) WITH CHECK (legacy_dashboard.is_super());

CREATE TABLE legacy_dashboard.ai_request_limits (
  user_id uuid not null,
  bucket timestamp with time zone not null,
  count integer not null default 1,
  CONSTRAINT ai_request_limits_pkey PRIMARY KEY (user_id, bucket),
  CONSTRAINT ai_request_limits_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
ALTER TABLE legacy_dashboard.ai_request_limits ENABLE ROW LEVEL SECURITY;

CREATE TABLE legacy_dashboard.amida_archive (
  id uuid not null default gen_random_uuid(),
  principal numeric not null,
  annual_rate numeric not null,
  partners jsonb not null,
  period_total numeric not null,
  annual_total numeric not null,
  note text,
  created_by text,
  created_at timestamp with time zone not null default now(),
  exchange_rate numeric,
  deduction numeric,
  CONSTRAINT amida_archive_pkey PRIMARY KEY (id)
);
ALTER TABLE legacy_dashboard.amida_archive ENABLE ROW LEVEL SECURITY;
CREATE POLICY "amida granted read archive" ON legacy_dashboard.amida_archive FOR SELECT USING (legacy_dashboard.can_access_amida());
CREATE POLICY "amida granted write archive" ON legacy_dashboard.amida_archive FOR INSERT WITH CHECK (legacy_dashboard.can_access_amida());
CREATE POLICY "amida super delete archive" ON legacy_dashboard.amida_archive FOR DELETE USING (legacy_dashboard.is_super());
CREATE POLICY "amida super update archive" ON legacy_dashboard.amida_archive FOR UPDATE USING (legacy_dashboard.is_super()) WITH CHECK (legacy_dashboard.is_super());

CREATE TABLE legacy_dashboard.amida_settings (
  id integer not null default 1,
  principal numeric not null default 0,
  annual_rate numeric not null default 0,
  partners jsonb not null default '[]'::jsonb,
  updated_at timestamp with time zone not null default now(),
  exchange_rate numeric not null default 75,
  deduction numeric not null default 5,
  CONSTRAINT amida_settings_pkey PRIMARY KEY (id),
  CONSTRAINT one_row_amida CHECK ((id = 1))
);
ALTER TABLE legacy_dashboard.amida_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "amida granted read settings" ON legacy_dashboard.amida_settings FOR SELECT USING (legacy_dashboard.can_access_amida());
CREATE POLICY "amida granted write settings" ON legacy_dashboard.amida_settings FOR ALL USING (legacy_dashboard.can_access_amida()) WITH CHECK (legacy_dashboard.can_access_amida());

CREATE TABLE legacy_dashboard.app_secrets (
  id integer not null default 1,
  api_key text,
  updated_at timestamp with time zone not null default now(),
  CONSTRAINT app_secrets_pkey PRIMARY KEY (id),
  CONSTRAINT one_row_secret CHECK ((id = 1))
);
ALTER TABLE legacy_dashboard.app_secrets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super only secrets" ON legacy_dashboard.app_secrets FOR ALL USING (legacy_dashboard.is_super()) WITH CHECK (legacy_dashboard.is_super());

CREATE TABLE legacy_dashboard.app_settings (
  id integer not null default 1,
  provider text default 'anthropic'::text,
  model text default 'claude-sonnet-5'::text,
  enable_for_admins boolean not null default false,
  include_doctor_names boolean not null default true,
  has_key boolean not null default false,
  updated_at timestamp with time zone not null default now(),
  CONSTRAINT app_settings_pkey PRIMARY KEY (id),
  CONSTRAINT one_row CHECK ((id = 1))
);
ALTER TABLE legacy_dashboard.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all read settings" ON legacy_dashboard.app_settings FOR SELECT USING (true);
CREATE POLICY "super writes settings" ON legacy_dashboard.app_settings FOR ALL USING (legacy_dashboard.is_super()) WITH CHECK (legacy_dashboard.is_super());

CREATE TABLE legacy_dashboard.branch_studies (
  id uuid not null default gen_random_uuid(),
  owner_id uuid not null,
  owner_name text not null default ''::text,
  study jsonb not null,
  total numeric not null default 0,
  version bigint not null default 1,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  CONSTRAINT branch_studies_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id),
  CONSTRAINT branch_studies_pkey PRIMARY KEY (id)
);
CREATE INDEX branch_studies_owner_idx ON legacy_dashboard.branch_studies USING btree (owner_id);
ALTER TABLE legacy_dashboard.branch_studies ENABLE ROW LEVEL SECURITY;

CREATE TABLE legacy_dashboard.branch_study_members (
  study_id uuid not null,
  user_id uuid not null,
  permission text not null,
  CONSTRAINT branch_study_members_permission_check CHECK ((permission = ANY (ARRAY['view'::text, 'add'::text, 'edit'::text, 'full'::text]))),
  CONSTRAINT branch_study_members_pkey PRIMARY KEY (study_id, user_id),
  CONSTRAINT branch_study_members_study_id_fkey FOREIGN KEY (study_id) REFERENCES legacy_dashboard.branch_studies(id) ON DELETE CASCADE,
  CONSTRAINT branch_study_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
CREATE INDEX branch_members_user_idx ON legacy_dashboard.branch_study_members USING btree (user_id);
ALTER TABLE legacy_dashboard.branch_study_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE legacy_dashboard.clinic_schedule (
  id integer not null default 1,
  payload jsonb not null,
  file_name text,
  saved_by uuid,
  saved_email text,
  updated_at timestamp with time zone not null default now(),
  CONSTRAINT clinic_schedule_pkey PRIMARY KEY (id),
  CONSTRAINT clinic_schedule_saved_by_fkey FOREIGN KEY (saved_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT one_schedule CHECK ((id = 1))
);
ALTER TABLE legacy_dashboard.clinic_schedule ENABLE ROW LEVEL SECURITY;
CREATE POLICY "all read schedule" ON legacy_dashboard.clinic_schedule FOR SELECT USING ((EXISTS ( SELECT 1 FROM legacy_dashboard.admins WHERE ((admins.user_id = auth.uid()) AND admins.active))));
CREATE POLICY "super writes schedule" ON legacy_dashboard.clinic_schedule FOR ALL USING (legacy_dashboard.is_super()) WITH CHECK (legacy_dashboard.is_super());

CREATE TABLE legacy_dashboard.notifications (
  id bigint not null,
  event_type text not null,
  actor_id uuid,
  actor_name text,
  message text not null,
  created_at timestamp with time zone not null default now(),
  CONSTRAINT notifications_pkey PRIMARY KEY (id)
);
ALTER TABLE legacy_dashboard.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif delete admin manager" ON legacy_dashboard.notifications FOR DELETE USING ((EXISTS ( SELECT 1 FROM legacy_dashboard.admins WHERE ((admins.user_id = auth.uid()) AND (admins.active = true) AND (admins.role = ANY (ARRAY['سوبر أدمن'::text, 'مدير'::text]))))));
CREATE POLICY "notif insert any admin" ON legacy_dashboard.notifications FOR INSERT WITH CHECK ((EXISTS ( SELECT 1 FROM legacy_dashboard.admins WHERE ((admins.user_id = auth.uid()) AND (admins.active = true)))));
CREATE POLICY "notif select admin manager" ON legacy_dashboard.notifications FOR SELECT USING ((EXISTS ( SELECT 1 FROM legacy_dashboard.admins WHERE ((admins.user_id = auth.uid()) AND (admins.active = true) AND (admins.role = ANY (ARRAY['سوبر أدمن'::text, 'مدير'::text]))))));

CREATE TABLE legacy_dashboard.operations_outbox (
  id uuid not null default gen_random_uuid(),
  fingerprint text not null,
  report_id uuid,
  snapshot jsonb not null,
  approved_by uuid not null,
  approved_at timestamp with time zone not null default now(),
  delivered_at timestamp with time zone,
  attempts integer not null default 0,
  next_attempt_at timestamp with time zone not null default now(),
  last_error text,
  lease_until timestamp with time zone,
  lease_token uuid,
  CONSTRAINT operations_outbox_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES auth.users(id),
  CONSTRAINT operations_outbox_fingerprint_key UNIQUE (fingerprint),
  CONSTRAINT operations_outbox_pkey PRIMARY KEY (id),
  CONSTRAINT operations_outbox_report_id_fkey FOREIGN KEY (report_id) REFERENCES legacy_dashboard.reports(id) ON DELETE SET NULL
);
ALTER TABLE legacy_dashboard.operations_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operations_outbox_read" ON legacy_dashboard.operations_outbox FOR SELECT USING ((legacy_dashboard.is_super() OR (approved_by = auth.uid())));

CREATE TABLE legacy_dashboard.reports (
  id uuid not null default gen_random_uuid(),
  title text not null,
  period_from date,
  period_to date,
  files text[] not null default '{}'::text[],
  revenue numeric not null default 0,
  cost numeric not null default 0,
  net numeric not null default 0,
  score integer not null default 0,
  risk_count integer not null default 0,
  payload jsonb not null,
  created_by uuid,
  created_name text,
  created_at timestamp with time zone not null default now(),
  CONSTRAINT reports_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT reports_pkey PRIMARY KEY (id)
);
CREATE INDEX reports_created_idx ON legacy_dashboard.reports USING btree (created_at DESC);
CREATE INDEX reports_period_idx ON legacy_dashboard.reports USING btree (period_from, period_to);
ALTER TABLE legacy_dashboard.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "active read reports" ON legacy_dashboard.reports FOR SELECT USING ((EXISTS ( SELECT 1 FROM legacy_dashboard.admins WHERE ((admins.user_id = auth.uid()) AND admins.active))));
CREATE POLICY "owner deletes reports" ON legacy_dashboard.reports FOR DELETE USING (((created_by = auth.uid()) OR legacy_dashboard.is_super()));
CREATE POLICY "uploaders add reports" ON legacy_dashboard.reports FOR INSERT WITH CHECK ((EXISTS ( SELECT 1 FROM legacy_dashboard.admins WHERE ((admins.user_id = auth.uid()) AND admins.active AND (admins.role = ANY (ARRAY['سوبر أدمن'::text, 'سوبر ادمن'::text, 'مالك'::text, 'مدير'::text, 'محاسب'::text]))))));

CREATE TABLE legacy_dashboard.tab_access (
  admin_id uuid not null,
  tabs text[] not null default '{}'::text[],
  updated_at timestamp with time zone not null default now(),
  CONSTRAINT tab_access_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES legacy_dashboard.admins(id) ON DELETE CASCADE,
  CONSTRAINT tab_access_pkey PRIMARY KEY (admin_id)
);
ALTER TABLE legacy_dashboard.tab_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read own tab access" ON legacy_dashboard.tab_access FOR SELECT USING (((admin_id IN ( SELECT admins.id FROM legacy_dashboard.admins WHERE (admins.user_id = auth.uid()))) OR legacy_dashboard.is_super()));
CREATE POLICY "super writes tab access" ON legacy_dashboard.tab_access FOR ALL USING (legacy_dashboard.is_super()) WITH CHECK (legacy_dashboard.is_super());

CREATE TABLE legacy_dashboard.usage_log (
  id bigint not null,
  admin_id uuid not null,
  email text,
  name text,
  started_at timestamp with time zone not null default now(),
  ended_at timestamp with time zone not null default now(),
  reports text[] not null default '{}'::text[],
  created_at timestamp with time zone not null default now(),
  CONSTRAINT usage_log_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES legacy_dashboard.admins(id) ON DELETE CASCADE,
  CONSTRAINT usage_log_pkey PRIMARY KEY (id)
);
ALTER TABLE legacy_dashboard.usage_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "usage insert own" ON legacy_dashboard.usage_log FOR INSERT WITH CHECK ((admin_id = ( SELECT admins.id FROM legacy_dashboard.admins WHERE (admins.user_id = auth.uid()))));
CREATE POLICY "usage select super" ON legacy_dashboard.usage_log FOR SELECT USING (legacy_dashboard.is_super());
CREATE POLICY "usage update own" ON legacy_dashboard.usage_log FOR UPDATE USING ((admin_id = ( SELECT admins.id FROM legacy_dashboard.admins WHERE (admins.user_id = auth.uid()))));
