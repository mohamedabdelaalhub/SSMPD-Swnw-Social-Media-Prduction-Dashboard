-- LIVE CAPTURE (2026-11-07): table structure read from production catalogs (read-only).
-- Reference snapshot only. NOT a migration: do not apply blindly. Grants and policies listed only where present.
-- Tables: clinic_reception.call_events, checkin_tokens, diagnostic_followups (complete). RLS on, no policies returned.

CREATE TABLE clinic_reception.call_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  appointment_id uuid,
  patient_id uuid,
  direction text NOT NULL,
  status text NOT NULL,
  provider text NOT NULL DEFAULT 'pbx'::text,
  external_call_id text NOT NULL,
  caller text,
  callee text,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  answered_at timestamp with time zone,
  ended_at timestamp with time zone,
  duration_seconds integer,
  recording_url text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolved_at timestamp with time zone,
  resolved_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT call_events_pkey PRIMARY KEY (id),
  CONSTRAINT call_events_provider_external_call_id_key UNIQUE (provider, external_call_id),
  CONSTRAINT call_events_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES clinic_reception.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT call_events_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES clinic_reception.appointments(id) ON DELETE SET NULL,
  CONSTRAINT call_events_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES clinic_reception.patients(id) ON DELETE SET NULL,
  CONSTRAINT call_events_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.admins(id),
  CONSTRAINT call_events_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text]))),
  CONSTRAINT call_events_status_check CHECK ((status = ANY (ARRAY['ringing'::text, 'answered'::text, 'missed'::text, 'completed'::text, 'failed'::text, 'busy'::text, 'cancelled'::text]))),
  CONSTRAINT call_events_duration_seconds_check CHECK (((duration_seconds IS NULL) OR (duration_seconds >= 0)))
);
CREATE INDEX call_events_unresolved_idx ON clinic_reception.call_events USING btree (workspace_id, status, resolved_at, started_at DESC);
CREATE INDEX call_events_workspace_started_idx ON clinic_reception.call_events USING btree (workspace_id, started_at DESC);
ALTER TABLE clinic_reception.call_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE clinic_reception.checkin_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  expires_at timestamp with time zone NOT NULL,
  used_at timestamp with time zone,
  request_lat double precision,
  request_lng double precision,
  request_accuracy double precision,
  distance_meters double precision,
  created_by uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT checkin_tokens_pkey PRIMARY KEY (id),
  CONSTRAINT checkin_tokens_token_key UNIQUE (token),
  CONSTRAINT checkin_tokens_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES clinic_reception.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT checkin_tokens_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES clinic_reception.appointments(id) ON DELETE CASCADE,
  CONSTRAINT checkin_tokens_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.admins(id)
);
CREATE INDEX checkin_tokens_appt_idx ON clinic_reception.checkin_tokens USING btree (appointment_id, created_at DESC);
ALTER TABLE clinic_reception.checkin_tokens ENABLE ROW LEVEL SECURITY;

CREATE TABLE clinic_reception.diagnostic_followups (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  visit_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  result_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending'::text,
  result_file_id uuid,
  requested_at timestamp with time zone NOT NULL DEFAULT now(),
  ready_at timestamp with time zone,
  result_message_queued_at timestamp with time zone,
  followup_message_queued_at timestamp with time zone,
  created_by uuid NOT NULL,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT diagnostic_followups_pkey PRIMARY KEY (id),
  CONSTRAINT diagnostic_followups_visit_id_result_type_key UNIQUE (visit_id, result_type),
  CONSTRAINT diagnostic_followups_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES clinic_reception.workspaces(id) ON DELETE CASCADE,
  CONSTRAINT diagnostic_followups_visit_id_fkey FOREIGN KEY (visit_id) REFERENCES clinic_reception.visits(id) ON DELETE CASCADE,
  CONSTRAINT diagnostic_followups_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES clinic_reception.appointments(id) ON DELETE CASCADE,
  CONSTRAINT diagnostic_followups_patient_id_fkey FOREIGN KEY (patient_id) REFERENCES clinic_reception.patients(id) ON DELETE CASCADE,
  CONSTRAINT diagnostic_followups_result_file_id_fkey FOREIGN KEY (result_file_id) REFERENCES public.patient_files(id) ON DELETE SET NULL,
  CONSTRAINT diagnostic_followups_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.admins(id),
  CONSTRAINT diagnostic_followups_result_type_check CHECK ((result_type = ANY (ARRAY['lab_result'::text, 'radiology'::text]))),
  CONSTRAINT diagnostic_followups_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'ready'::text, 'closed'::text])))
);
ALTER TABLE clinic_reception.diagnostic_followups ENABLE ROW LEVEL SECURITY;
