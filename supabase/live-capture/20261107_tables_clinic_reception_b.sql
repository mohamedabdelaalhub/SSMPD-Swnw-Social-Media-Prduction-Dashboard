-- LIVE CAPTURE (2026-11-07): table structure read from production catalogs (read-only).
-- Reference snapshot only. NOT a migration: do not apply blindly.
-- Generated from docs/live-schema/tables-raw-20261107.txt. Unqualified names resolve via search_path (public).
-- Not captured: grants, policy roles (TO ...), permissive/restrictive flag, triggers, sequences ownership, seed rows.

CREATE TABLE clinic_reception.doctor_sessions (
  id uuid not null default gen_random_uuid(),
  workspace_id uuid not null,
  provider_id uuid not null,
  session_date date not null,
  status text not null default 'scheduled'::text,
  eta_minutes integer,
  delay_reason text,
  arrived_at timestamp with time zone,
  started_at timestamp with time zone,
  ended_at timestamp with time zone,
  updated_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  CONSTRAINT doctor_sessions_eta_minutes_check CHECK (((eta_minutes IS NULL) OR ((eta_minutes >= 0) AND (eta_minutes <= 480)))),
  CONSTRAINT doctor_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT doctor_sessions_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES clinic_reception.providers(id) ON DELETE CASCADE,
  CONSTRAINT doctor_sessions_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'on_the_way'::text, 'arrived'::text, 'started'::text, 'delayed'::text, 'ended'::text, 'cancelled'::text]))),
  CONSTRAINT doctor_sessions_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES admins(id),
  CONSTRAINT doctor_sessions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES clinic_reception.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT doctor_sessions_workspace_id_provider_id_session_date_key UNIQUE (workspace_id, provider_id, session_date)
);
ALTER TABLE clinic_reception.doctor_sessions ENABLE ROW LEVEL SECURITY;

CREATE TABLE clinic_reception.external_providers (
  id uuid not null default gen_random_uuid(),
  workspace_id uuid not null,
  name text not null,
  kind text not null,
  phone text,
  terms jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  CONSTRAINT external_providers_kind_check CHECK ((kind = ANY (ARRAY['lab'::text, 'radiology'::text]))),
  CONSTRAINT external_providers_pkey PRIMARY KEY (id),
  CONSTRAINT external_providers_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES clinic_reception.workspaces(id)
);
ALTER TABLE clinic_reception.external_providers ENABLE ROW LEVEL SECURITY;

CREATE TABLE clinic_reception.order_ext (
  order_id uuid not null,
  kind text not null,
  mode text not null default 'internal'::text,
  billing_party text not null default 'center'::text,
  referring_doctor_key text,
  performing_doctor_key text,
  external_provider_id uuid,
  status text not null default 'referred'::text,
  status_at timestamp with time zone not null default now(),
  report_file_ref text,
  priced jsonb,
  created_at timestamp with time zone not null default now(),
  CONSTRAINT order_ext_billing_party_check CHECK ((billing_party = ANY (ARRAY['center'::text, 'provider'::text]))),
  CONSTRAINT order_ext_check CHECK (((mode = 'internal'::text) OR (external_provider_id IS NOT NULL))),
  CONSTRAINT order_ext_check1 CHECK (((billing_party = 'center'::text) OR (mode = 'external'::text))),
  CONSTRAINT order_ext_external_provider_id_fkey FOREIGN KEY (external_provider_id) REFERENCES clinic_reception.external_providers(id),
  CONSTRAINT order_ext_kind_check CHECK ((kind = ANY (ARRAY['service'::text, 'radiology'::text, 'lab'::text, 'medicine'::text, 'supply'::text]))),
  CONSTRAINT order_ext_mode_check CHECK ((mode = ANY (ARRAY['internal'::text, 'external'::text]))),
  CONSTRAINT order_ext_order_id_fkey FOREIGN KEY (order_id) REFERENCES clinic_reception.orders(id) ON DELETE CASCADE,
  CONSTRAINT order_ext_pkey PRIMARY KEY (order_id),
  CONSTRAINT order_ext_status_check CHECK ((status = ANY (ARRAY['referred'::text, 'scheduled'::text, 'attended'::text, 'cancelled'::text, 'no_show'::text, 'done'::text, 'report_uploaded'::text, 'patient_notified'::text])))
);
ALTER TABLE clinic_reception.order_ext ENABLE ROW LEVEL SECURITY;

CREATE TABLE clinic_reception.order_reports (
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  file_size bigint not null,
  checksum text,
  patient_visible boolean not null default true,
  uploaded_by uuid not null,
  uploaded_at timestamp with time zone not null default now(),
  CONSTRAINT order_reports_file_size_check CHECK (((file_size > 0) AND (file_size <= 20971520))),
  CONSTRAINT order_reports_mime_type_check CHECK ((mime_type = ANY (ARRAY['application/pdf'::text, 'image/jpeg'::text, 'image/png'::text]))),
  CONSTRAINT order_reports_order_id_fkey FOREIGN KEY (order_id) REFERENCES clinic_reception.orders(id) ON DELETE CASCADE,
  CONSTRAINT order_reports_pkey PRIMARY KEY (id),
  CONSTRAINT order_reports_storage_path_key UNIQUE (storage_path)
);
ALTER TABLE clinic_reception.order_reports ENABLE ROW LEVEL SECURITY;

CREATE TABLE clinic_reception.order_status_log (
  id bigint not null default nextval('clinic_reception.order_status_log_id_seq'::regclass),
  order_id uuid not null,
  from_status text,
  to_status text not null,
  at timestamp with time zone not null default now(),
  by_user uuid,
  CONSTRAINT order_status_log_order_id_fkey FOREIGN KEY (order_id) REFERENCES clinic_reception.orders(id) ON DELETE CASCADE,
  CONSTRAINT order_status_log_pkey PRIMARY KEY (id)
);
ALTER TABLE clinic_reception.order_status_log ENABLE ROW LEVEL SECURITY;

CREATE TABLE clinic_reception.provider_cost_list (
  provider_id uuid not null,
  service_id uuid not null,
  year integer not null,
  cost numeric(12,2) not null,
  CONSTRAINT provider_cost_list_cost_check CHECK ((cost >= (0)::numeric)),
  CONSTRAINT provider_cost_list_pkey PRIMARY KEY (provider_id, service_id, year),
  CONSTRAINT provider_cost_list_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES clinic_reception.external_providers(id) ON DELETE CASCADE,
  CONSTRAINT provider_cost_list_service_id_fkey FOREIGN KEY (service_id) REFERENCES clinic_reception.services(id) ON DELETE CASCADE
);
ALTER TABLE clinic_reception.provider_cost_list ENABLE ROW LEVEL SECURITY;

CREATE TABLE clinic_reception.referral_rates (
  id uuid not null default gen_random_uuid(),
  workspace_id uuid not null,
  doctor_key text not null,
  category text not null,
  percent numeric(5,2) not null,
  valid_from date not null default CURRENT_DATE,
  valid_to date,
  CONSTRAINT referral_rates_category_check CHECK ((category = ANY (ARRAY['consult'::text, 'followup'::text, 'consultation'::text, 'radiology'::text, 'lab'::text, 'procedure'::text]))),
  CONSTRAINT referral_rates_percent_check CHECK (((percent >= (0)::numeric) AND (percent <= (100)::numeric))),
  CONSTRAINT referral_rates_pkey PRIMARY KEY (id),
  CONSTRAINT referral_rates_workspace_id_doctor_key_category_valid_from_key UNIQUE (workspace_id, doctor_key, category, valid_from),
  CONSTRAINT referral_rates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES clinic_reception.workspaces(id)
);
ALTER TABLE clinic_reception.referral_rates ENABLE ROW LEVEL SECURITY;

CREATE TABLE clinic_reception.report_notifications (
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  report_id uuid not null,
  channel text not null default 'email'::text,
  status text not null default 'pending'::text,
  attempts integer not null default 0,
  last_error text,
  skipped_reason text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  sent_at timestamp with time zone,
  CONSTRAINT report_notifications_channel_check CHECK ((channel = 'email'::text)),
  CONSTRAINT report_notifications_order_id_fkey FOREIGN KEY (order_id) REFERENCES clinic_reception.orders(id) ON DELETE CASCADE,
  CONSTRAINT report_notifications_pkey PRIMARY KEY (id),
  CONSTRAINT report_notifications_report_id_channel_key UNIQUE (report_id, channel),
  CONSTRAINT report_notifications_report_id_fkey FOREIGN KEY (report_id) REFERENCES clinic_reception.order_reports(id) ON DELETE CASCADE,
  CONSTRAINT report_notifications_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'skipped'::text])))
);
ALTER TABLE clinic_reception.report_notifications ENABLE ROW LEVEL SECURITY;

CREATE TABLE clinic_reception.service_performers (
  id uuid not null default gen_random_uuid(),
  service_id uuid not null,
  doctor_key text,
  specialty_id text,
  CONSTRAINT service_performers_check CHECK (((doctor_key IS NOT NULL) <> (specialty_id IS NOT NULL))),
  CONSTRAINT service_performers_pkey PRIMARY KEY (id),
  CONSTRAINT service_performers_service_id_fkey FOREIGN KEY (service_id) REFERENCES clinic_reception.services(id) ON DELETE CASCADE
);
ALTER TABLE clinic_reception.service_performers ENABLE ROW LEVEL SECURITY;

CREATE TABLE clinic_reception.service_specialties (
  service_id uuid not null,
  specialty_id text not null,
  CONSTRAINT service_specialties_pkey PRIMARY KEY (service_id, specialty_id),
  CONSTRAINT service_specialties_service_id_fkey FOREIGN KEY (service_id) REFERENCES clinic_reception.services(id) ON DELETE CASCADE
);
ALTER TABLE clinic_reception.service_specialties ENABLE ROW LEVEL SECURITY;
