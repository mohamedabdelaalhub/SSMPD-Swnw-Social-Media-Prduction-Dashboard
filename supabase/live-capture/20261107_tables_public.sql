-- LIVE CAPTURE (2026-11-07): table structure read from production catalogs (read-only).
-- Reference snapshot only. NOT a migration: do not apply blindly.
-- Generated from docs/live-schema/tables-raw-20261107.txt. Unqualified names resolve via search_path (public).
-- Not captured: grants, policy roles (TO ...), permissive/restrictive flag, triggers, sequences ownership, seed rows.

CREATE TABLE public.administrative_assistant_actions (
  id uuid not null default gen_random_uuid(),
  request_id uuid,
  action_type text not null,
  payload jsonb not null default '{}'::jsonb,
  risk_level text not null default 'normal'::text,
  status text not null default 'proposed'::text,
  requested_by uuid,
  approved_by uuid,
  approved_at timestamp with time zone,
  expires_at timestamp with time zone,
  executed_at timestamp with time zone,
  result jsonb,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  CONSTRAINT administrative_assistant_actions_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES admins(id),
  CONSTRAINT administrative_assistant_actions_pkey PRIMARY KEY (id),
  CONSTRAINT administrative_assistant_actions_request_id_fkey FOREIGN KEY (request_id) REFERENCES administrative_assistant_requests(id) ON DELETE CASCADE,
  CONSTRAINT administrative_assistant_actions_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES admins(id),
  CONSTRAINT administrative_assistant_actions_risk_level_check CHECK ((risk_level = ANY (ARRAY['normal'::text, 'sensitive'::text, 'high'::text, 'critical'::text]))),
  CONSTRAINT administrative_assistant_actions_status_check CHECK ((status = ANY (ARRAY['proposed'::text, 'waiting_approval'::text, 'approved'::text, 'rejected'::text, 'executing'::text, 'executed'::text, 'failed'::text, 'cancelled'::text])))
);
ALTER TABLE public.administrative_assistant_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assistant_actions_managers" ON public.administrative_assistant_actions FOR ALL USING (business_manager()) WITH CHECK (business_manager());

CREATE TABLE public.administrative_assistant_audit (
  id bigint not null,
  at timestamp with time zone not null default now(),
  actor_type text not null,
  actor_id uuid,
  event_type text not null,
  request_id uuid,
  action_id uuid,
  detail jsonb not null default '{}'::jsonb,
  CONSTRAINT administrative_assistant_audit_action_id_fkey FOREIGN KEY (action_id) REFERENCES administrative_assistant_actions(id) ON DELETE SET NULL,
  CONSTRAINT administrative_assistant_audit_pkey PRIMARY KEY (id),
  CONSTRAINT administrative_assistant_audit_request_id_fkey FOREIGN KEY (request_id) REFERENCES administrative_assistant_requests(id) ON DELETE SET NULL
);
ALTER TABLE public.administrative_assistant_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assistant_audit_managers" ON public.administrative_assistant_audit FOR SELECT USING (business_manager());

CREATE TABLE public.administrative_assistant_config (
  id smallint not null default 1,
  enabled boolean not null default true,
  mode text not null default 'shadow'::text,
  auto_execute_enabled boolean not null default false,
  owner_admin_id uuid,
  escalation_channels jsonb not null default '["dashboard"]'::jsonb,
  updated_by uuid,
  updated_at timestamp with time zone not null default now(),
  assistant_admin_id uuid,
  CONSTRAINT administrative_assistant_config_assistant_admin_id_fkey FOREIGN KEY (assistant_admin_id) REFERENCES admins(id) ON DELETE SET NULL,
  CONSTRAINT administrative_assistant_config_id_check CHECK ((id = 1)),
  CONSTRAINT administrative_assistant_config_mode_check CHECK ((mode = ANY (ARRAY['read_only'::text, 'shadow'::text, 'approval'::text, 'delegated'::text]))),
  CONSTRAINT administrative_assistant_config_owner_admin_id_fkey FOREIGN KEY (owner_admin_id) REFERENCES admins(id),
  CONSTRAINT administrative_assistant_config_pkey PRIMARY KEY (id),
  CONSTRAINT administrative_assistant_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES admins(id)
);
ALTER TABLE public.administrative_assistant_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assistant_config_managers" ON public.administrative_assistant_config FOR ALL USING (business_manager()) WITH CHECK (business_manager());

CREATE TABLE public.administrative_assistant_requests (
  id uuid not null default gen_random_uuid(),
  source text not null default 'manual'::text,
  source_update_id uuid,
  task_id uuid,
  requester_id uuid,
  body text not null,
  priority text not null default 'normal'::text,
  status text not null default 'pending'::text,
  requires_owner boolean not null default false,
  suggested_action jsonb,
  decision_summary text,
  assigned_rule_id uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  CONSTRAINT administrative_assistant_requests_assigned_rule_id_fkey FOREIGN KEY (assigned_rule_id) REFERENCES administrative_assistant_rules(id),
  CONSTRAINT administrative_assistant_requests_pkey PRIMARY KEY (id),
  CONSTRAINT administrative_assistant_requests_priority_check CHECK ((priority = ANY (ARRAY['normal'::text, 'important'::text, 'urgent'::text, 'critical'::text]))),
  CONSTRAINT administrative_assistant_requests_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES admins(id),
  CONSTRAINT administrative_assistant_requests_source_update_id_fkey FOREIGN KEY (source_update_id) REFERENCES task_updates(id) ON DELETE SET NULL,
  CONSTRAINT administrative_assistant_requests_source_update_id_key UNIQUE (source_update_id),
  CONSTRAINT administrative_assistant_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'reviewing'::text, 'waiting_owner'::text, 'approved'::text, 'rejected'::text, 'executed'::text, 'closed'::text]))),
  CONSTRAINT administrative_assistant_requests_task_id_fkey FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
);
ALTER TABLE public.administrative_assistant_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assistant_requests_insert" ON public.administrative_assistant_requests FOR INSERT WITH CHECK (((requester_id = my_admin_id()) OR business_manager()));
CREATE POLICY "assistant_requests_select" ON public.administrative_assistant_requests FOR SELECT USING ((business_manager() OR (requester_id = my_admin_id())));
CREATE POLICY "assistant_requests_update" ON public.administrative_assistant_requests FOR UPDATE USING (business_manager()) WITH CHECK (business_manager());

CREATE TABLE public.administrative_assistant_rules (
  id uuid not null default gen_random_uuid(),
  title text not null,
  instruction text not null,
  scope text not null default 'general'::text,
  action_type text not null default 'advice'::text,
  conditions jsonb not null default '{}'::jsonb,
  approval_mode text not null default 'owner_each_time'::text,
  valid_from timestamp with time zone not null default now(),
  valid_until timestamp with time zone,
  active boolean not null default true,
  created_by uuid,
  approved_by uuid,
  approved_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  CONSTRAINT administrative_assistant_rules_approval_mode_check CHECK ((approval_mode = ANY (ARRAY['suggest_only'::text, 'owner_each_time'::text, 'owner_confirm_details'::text, 'dual_approval'::text, 'preapproved'::text]))),
  CONSTRAINT administrative_assistant_rules_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES admins(id),
  CONSTRAINT administrative_assistant_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES admins(id),
  CONSTRAINT administrative_assistant_rules_pkey PRIMARY KEY (id)
);
ALTER TABLE public.administrative_assistant_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assistant_rules_managers" ON public.administrative_assistant_rules FOR ALL USING (business_manager()) WITH CHECK (business_manager());

CREATE TABLE public.automation_run_tokens (
  token uuid not null default gen_random_uuid(),
  created_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone not null default (now() + '04:00:00'::interval),
  note text,
  CONSTRAINT automation_run_tokens_pkey PRIMARY KEY (token)
);
ALTER TABLE public.automation_run_tokens ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.clinic_faqs (
  id uuid not null default gen_random_uuid(),
  question text not null,
  answer text not null,
  sort integer not null default 0,
  active boolean not null default true,
  updated_at timestamp with time zone not null default now(),
  updated_by uuid,
  CONSTRAINT clinic_faqs_pkey PRIMARY KEY (id)
);
ALTER TABLE public.clinic_faqs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clinic_faqs_read" ON public.clinic_faqs FOR SELECT USING (clinic_info_access());
CREATE POLICY "clinic_faqs_write" ON public.clinic_faqs FOR ALL USING (clinic_info_edit()) WITH CHECK (clinic_info_edit());

CREATE TABLE public.clinic_hours (
  id uuid not null default gen_random_uuid(),
  department text not null,
  days text[] not null default '{}'::text[],
  open_time time without time zone,
  close_time time without time zone,
  closed boolean not null default false,
  notes text,
  sort integer not null default 0,
  active boolean not null default true,
  updated_at timestamp with time zone not null default now(),
  updated_by uuid,
  CONSTRAINT clinic_hours_pkey PRIMARY KEY (id)
);
ALTER TABLE public.clinic_hours ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clinic_hours_read" ON public.clinic_hours FOR SELECT USING (clinic_info_access());
CREATE POLICY "clinic_hours_write" ON public.clinic_hours FOR ALL USING (clinic_info_edit()) WITH CHECK (clinic_info_edit());

CREATE TABLE public.clinic_offers (
  id uuid not null default gen_random_uuid(),
  title text not null,
  details text,
  price_text text,
  starts_on date,
  ends_on date,
  active boolean not null default true,
  updated_at timestamp with time zone not null default now(),
  updated_by uuid,
  CONSTRAINT clinic_offers_pkey PRIMARY KEY (id)
);
ALTER TABLE public.clinic_offers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clinic_offers_read" ON public.clinic_offers FOR SELECT USING (clinic_info_access());
CREATE POLICY "clinic_offers_write" ON public.clinic_offers FOR ALL USING (clinic_info_edit()) WITH CHECK (clinic_info_edit());

CREATE TABLE public.clinic_profile (
  id integer not null default 1,
  address text,
  maps_url text,
  phone text,
  whatsapp text,
  email text,
  website text,
  directions_notes text,
  payment_methods text[] not null default '{}'::text[],
  payment_notes text,
  home_visits text,
  results_notes text,
  booking_policy text,
  agent_notes text,
  updated_at timestamp with time zone not null default now(),
  updated_by uuid,
  CONSTRAINT clinic_profile_id_check CHECK ((id = 1)),
  CONSTRAINT clinic_profile_pkey PRIMARY KEY (id)
);
ALTER TABLE public.clinic_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clinic_profile_read" ON public.clinic_profile FOR SELECT USING (clinic_info_access());
CREATE POLICY "clinic_profile_write" ON public.clinic_profile FOR UPDATE USING (clinic_info_edit()) WITH CHECK (clinic_info_edit());

CREATE TABLE public.content_learnings (
  id uuid not null default gen_random_uuid(),
  brand text not null,
  dimension text not null,
  value text not null,
  verdict text not null,
  confidence text not null,
  evidence jsonb not null default '{}'::jsonb,
  note text not null default ''::text,
  source text not null default 'system'::text,
  week_end date not null default CURRENT_DATE,
  expires_at timestamp with time zone not null default (now() + '35 days'::interval),
  active boolean not null default true,
  created_at timestamp with time zone not null default now(),
  CONSTRAINT content_learnings_brand_check CHECK ((brand = ANY (ARRAY['sono'::text, 'dr_dina'::text, 'all'::text]))),
  CONSTRAINT content_learnings_confidence_check CHECK ((confidence = ANY (ARRAY['strong'::text, 'tentative'::text]))),
  CONSTRAINT content_learnings_dimension_check CHECK ((dimension = ANY (ARRAY['format'::text, 'daypart'::text, 'weekday'::text, 'cta_type'::text, 'specialty'::text, 'angle'::text, 'note'::text]))),
  CONSTRAINT content_learnings_pkey PRIMARY KEY (id),
  CONSTRAINT content_learnings_source_check CHECK ((source = ANY (ARRAY['system'::text, 'claude'::text, 'manual'::text]))),
  CONSTRAINT content_learnings_verdict_check CHECK ((verdict = ANY (ARRAY['do_more'::text, 'do_less'::text, 'avoid'::text, 'test'::text])))
);
CREATE INDEX content_learnings_active ON public.content_learnings USING btree (brand, active, expires_at);
ALTER TABLE public.content_learnings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "content_learnings_read" ON public.content_learnings FOR SELECT USING ((my_role() = ANY (ARRAY['page_manager'::text, 'designer'::text, 'approver'::text, 'general_manager'::text, 'super_admin'::text])));
CREATE POLICY "content_learnings_toggle" ON public.content_learnings FOR UPDATE USING ((my_role() = ANY (ARRAY['super_admin'::text, 'general_manager'::text]))) WITH CHECK ((my_role() = ANY (ARRAY['super_admin'::text, 'general_manager'::text])));

CREATE TABLE public.content_ratings (
  content_id uuid not null,
  rating text not null,
  reason text not null default ''::text,
  rated_by uuid,
  rated_at timestamp with time zone not null default now(),
  failure_cause text,
  CONSTRAINT content_ratings_content_id_fkey FOREIGN KEY (content_id) REFERENCES content_items(id) ON DELETE CASCADE,
  CONSTRAINT content_ratings_failure_cause_check CHECK ((failure_cause = ANY (ARRAY['topic'::text, 'design'::text, 'hook'::text, 'timing'::text, 'other'::text]))),
  CONSTRAINT content_ratings_pkey PRIMARY KEY (content_id),
  CONSTRAINT content_ratings_rating_check CHECK ((rating = ANY (ARRAY['strong'::text, 'ok'::text, 'weak'::text]))),
  CONSTRAINT content_ratings_reason_check CHECK ((length(reason) <= 400))
);
ALTER TABLE public.content_ratings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "content_ratings_read" ON public.content_ratings FOR SELECT USING ((my_role() = ANY (ARRAY['page_manager'::text, 'approver'::text, 'general_manager'::text, 'super_admin'::text])));
CREATE POLICY "content_ratings_update" ON public.content_ratings FOR UPDATE USING ((my_role() = ANY (ARRAY['page_manager'::text, 'approver'::text, 'general_manager'::text, 'super_admin'::text]))) WITH CHECK ((rated_by = my_admin_id()));
CREATE POLICY "content_ratings_write" ON public.content_ratings FOR INSERT WITH CHECK (((my_role() = ANY (ARRAY['page_manager'::text, 'approver'::text, 'general_manager'::text, 'super_admin'::text])) AND (reviewed_by = my_admin_id())));

CREATE TABLE public.health_occasions (
  id integer not null default nextval('health_occasions_id_seq'::regclass),
  name text not null,
  month integer not null,
  day integer not null,
  year integer,
  span_days integer not null default 1,
  specialty text not null default ''::text,
  note text not null default ''::text,
  CONSTRAINT health_occasions_day_check CHECK (((day >= 1) AND (day <= 31))),
  CONSTRAINT health_occasions_month_check CHECK (((month >= 1) AND (month <= 12))),
  CONSTRAINT health_occasions_pkey PRIMARY KEY (id),
  CONSTRAINT health_occasions_span_days_check CHECK (((span_days >= 1) AND (span_days <= 120)))
);
ALTER TABLE public.health_occasions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "health_occasions_read" ON public.health_occasions FOR SELECT USING ((my_admin_id() IS NOT NULL));

CREATE TABLE public.insurance_plan_service_rules (
  id uuid not null default gen_random_uuid(),
  plan_id uuid not null,
  service_id uuid not null,
  copay_type text not null default 'inherit'::text,
  copay_value numeric(14,2) not null default 0,
  notes text not null default ''::text,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  CONSTRAINT insurance_plan_service_percent_valid CHECK (((copay_type <> 'percentage'::text) OR (copay_value <= (100)::numeric))),
  CONSTRAINT insurance_plan_service_rule_unique UNIQUE (plan_id, service_id),
  CONSTRAINT insurance_plan_service_rules_copay_type_check CHECK ((copay_type = ANY (ARRAY['inherit'::text, 'none'::text, 'percentage'::text, 'fixed'::text]))),
  CONSTRAINT insurance_plan_service_rules_copay_value_check CHECK ((copay_value >= (0)::numeric)),
  CONSTRAINT insurance_plan_service_rules_created_by_fkey FOREIGN KEY (created_by) REFERENCES admins(id),
  CONSTRAINT insurance_plan_service_rules_pkey PRIMARY KEY (id),
  CONSTRAINT insurance_plan_service_rules_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES insurance_plans(id) ON DELETE CASCADE,
  CONSTRAINT insurance_plan_service_rules_service_id_fkey FOREIGN KEY (service_id) REFERENCES pricing_services(id) ON DELETE CASCADE,
  CONSTRAINT insurance_plan_service_zero_valid CHECK (((copay_type <> ALL (ARRAY['inherit'::text, 'none'::text])) OR (copay_value = (0)::numeric)))
);
CREATE INDEX insurance_plan_rules_plan_idx ON public.insurance_plan_service_rules USING btree (plan_id, service_id);
CREATE INDEX insurance_plan_rules_created_by_idx ON public.insurance_plan_service_rules USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE INDEX insurance_plan_rules_service_idx ON public.insurance_plan_service_rules USING btree (service_id);
ALTER TABLE public.insurance_plan_service_rules ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.insurance_plans (
  id uuid not null default gen_random_uuid(),
  contract_id uuid not null,
  name text not null,
  code text not null,
  price_list_id uuid,
  copay_type text not null default 'none'::text,
  copay_value numeric(14,2) not null default 0,
  valid_from date not null default CURRENT_DATE,
  valid_to date,
  active boolean not null default true,
  notes text not null default ''::text,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  CONSTRAINT insurance_plans_code_unique UNIQUE (contract_id, code),
  CONSTRAINT insurance_plans_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES contracting_entity_contracts(id) ON DELETE CASCADE,
  CONSTRAINT insurance_plans_copay_type_check CHECK ((copay_type = ANY (ARRAY['none'::text, 'percentage'::text, 'fixed'::text]))),
  CONSTRAINT insurance_plans_copay_value_check CHECK ((copay_value >= (0)::numeric)),
  CONSTRAINT insurance_plans_created_by_fkey FOREIGN KEY (created_by) REFERENCES admins(id),
  CONSTRAINT insurance_plans_dates_valid CHECK (((valid_to IS NULL) OR (valid_to >= valid_from))),
  CONSTRAINT insurance_plans_none_zero CHECK (((copay_type <> 'none'::text) OR (copay_value = (0)::numeric))),
  CONSTRAINT insurance_plans_percent_valid CHECK (((copay_type <> 'percentage'::text) OR (copay_value <= (100)::numeric))),
  CONSTRAINT insurance_plans_pkey PRIMARY KEY (id),
  CONSTRAINT insurance_plans_price_list_id_fkey FOREIGN KEY (price_list_id) REFERENCES clinic_prices.lists(id)
);
CREATE INDEX insurance_plans_contract_idx ON public.insurance_plans USING btree (contract_id, active, valid_from, valid_to);
CREATE INDEX insurance_plans_created_by_idx ON public.insurance_plans USING btree (created_by) WHERE (created_by IS NOT NULL);
CREATE INDEX insurance_plans_price_list_idx ON public.insurance_plans USING btree (price_list_id) WHERE (price_list_id IS NOT NULL);
ALTER TABLE public.insurance_plans ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.kpi_defs (
  kpi text not null,
  label_ar text not null,
  unit text not null default ''::text,
  direction text not null,
  scales boolean not null default false,
  min_sample integer not null default 0,
  sort_order integer not null default 0,
  hint_ar text not null default ''::text,
  alert_below numeric not null default 40,
  CONSTRAINT kpi_defs_direction_check CHECK ((direction = ANY (ARRAY['higher'::text, 'lower'::text]))),
  CONSTRAINT kpi_defs_pkey PRIMARY KEY (kpi)
);
ALTER TABLE public.kpi_defs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kpi_defs_read" ON public.kpi_defs FOR SELECT USING ((my_role() = ANY (ARRAY['super_admin'::text, 'general_manager'::text])));

CREATE TABLE public.kpi_targets (
  role text not null,
  kpi text not null,
  target numeric not null,
  weight numeric not null default 1,
  CONSTRAINT kpi_targets_kpi_fkey FOREIGN KEY (kpi) REFERENCES kpi_defs(kpi) ON DELETE CASCADE,
  CONSTRAINT kpi_targets_pkey PRIMARY KEY (role, kpi),
  CONSTRAINT kpi_targets_target_check CHECK ((target >= (0)::numeric)),
  CONSTRAINT kpi_targets_weight_check CHECK (((weight >= (0)::numeric) AND (weight <= (10)::numeric)))
);
ALTER TABLE public.kpi_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kpi_targets_read" ON public.kpi_targets FOR SELECT USING ((my_role() = ANY (ARRAY['super_admin'::text, 'general_manager'::text])));
CREATE POLICY "kpi_targets_write" ON public.kpi_targets FOR ALL USING ((my_role() = 'super_admin'::text)) WITH CHECK ((my_role() = 'super_admin'::text));

CREATE TABLE public.patient_activation_codes (
  id uuid not null default gen_random_uuid(),
  account_id uuid not null,
  verification_id uuid,
  code_hash text not null,
  expires_at timestamp with time zone not null,
  used_at timestamp with time zone,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  CONSTRAINT patient_activation_codes_account_id_fkey FOREIGN KEY (account_id) REFERENCES patient_accounts(id) ON DELETE CASCADE,
  CONSTRAINT patient_activation_codes_created_by_fkey FOREIGN KEY (created_by) REFERENCES admins(id),
  CONSTRAINT patient_activation_codes_pkey PRIMARY KEY (id),
  CONSTRAINT patient_activation_codes_verification_id_fkey FOREIGN KEY (verification_id) REFERENCES patient_identity_verifications(id) ON DELETE SET NULL
);
CREATE INDEX patient_activation_codes_account_idx ON public.patient_activation_codes USING btree (account_id, created_at DESC);
CREATE INDEX patient_activation_codes_active_idx ON public.patient_activation_codes USING btree (account_id, expires_at) WHERE (used_at IS NULL);
ALTER TABLE public.patient_activation_codes ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.patient_feedback_signals (
  id uuid not null default gen_random_uuid(),
  rating_id uuid not null,
  patient_visit_id uuid,
  admin_id uuid,
  team text,
  theme text not null,
  sentiment text not null,
  severity text not null default 'low'::text,
  confidence numeric(4,3) not null default 0.5,
  status text not null default 'open'::text,
  detected_at timestamp with time zone not null default now(),
  reviewed_at timestamp with time zone,
  reviewed_by uuid,
  review_note text,
  CONSTRAINT patient_feedback_signals_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE SET NULL,
  CONSTRAINT patient_feedback_signals_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (1)::numeric))),
  CONSTRAINT patient_feedback_signals_patient_visit_id_fkey FOREIGN KEY (patient_visit_id) REFERENCES patient_visits(id) ON DELETE SET NULL,
  CONSTRAINT patient_feedback_signals_pkey PRIMARY KEY (id),
  CONSTRAINT patient_feedback_signals_rating_id_fkey FOREIGN KEY (rating_id) REFERENCES patient_experience_ratings(id) ON DELETE CASCADE,
  CONSTRAINT patient_feedback_signals_rating_id_key UNIQUE (rating_id),
  CONSTRAINT patient_feedback_signals_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES admins(id),
  CONSTRAINT patient_feedback_signals_sentiment_check CHECK ((sentiment = ANY (ARRAY['positive'::text, 'neutral'::text, 'negative'::text]))),
  CONSTRAINT patient_feedback_signals_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'low'::text, 'medium'::text, 'high'::text]))),
  CONSTRAINT patient_feedback_signals_status_check CHECK ((status = ANY (ARRAY['open'::text, 'confirmed'::text, 'dismissed'::text])))
);
CREATE INDEX patient_feedback_signals_admin_idx ON public.patient_feedback_signals USING btree (admin_id, status, detected_at DESC);
CREATE INDEX patient_feedback_signals_theme_idx ON public.patient_feedback_signals USING btree (theme, sentiment, detected_at DESC);
CREATE INDEX patient_feedback_signals_visit_idx ON public.patient_feedback_signals USING btree (patient_visit_id) WHERE (patient_visit_id IS NOT NULL);
CREATE INDEX patient_feedback_signals_reviewed_by_idx ON public.patient_feedback_signals USING btree (reviewed_by) WHERE (reviewed_by IS NOT NULL);
ALTER TABLE public.patient_feedback_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "patient_feedback_signals_read" ON public.patient_feedback_signals FOR SELECT USING (((admin_id = my_admin_id()) OR has_role('super_admin'::text) OR has_role('general_manager'::text)));

CREATE TABLE public.performance_evidence (
  id uuid not null default gen_random_uuid(),
  admin_id uuid not null,
  role text,
  category text not null,
  metric text not null,
  source_type text not null,
  source_id text not null,
  severity text not null default 'medium'::text,
  status text not null default 'open'::text,
  affects_score boolean not null default true,
  title text not null,
  detail text not null default ''::text,
  suggested_action text not null default ''::text,
  evidence jsonb not null default '{}'::jsonb,
  detected_at timestamp with time zone not null default now(),
  due_at timestamp with time zone,
  fixed_at timestamp with time zone,
  fixed_by uuid,
  reviewed_at timestamp with time zone,
  reviewed_by uuid,
  review_note text,
  CONSTRAINT performance_evidence_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
  CONSTRAINT performance_evidence_admin_id_source_type_source_id_metric_key UNIQUE (admin_id, source_type, source_id, metric),
  CONSTRAINT performance_evidence_category_check CHECK ((category = ANY (ARRAY['data_quality'::text, 'task_quality'::text, 'clinical_documentation'::text, 'workflow'::text, 'patient_experience'::text, 'other'::text]))),
  CONSTRAINT performance_evidence_evidence_check CHECK ((jsonb_typeof(evidence) = 'object'::text)),
  CONSTRAINT performance_evidence_fixed_by_fkey FOREIGN KEY (fixed_by) REFERENCES admins(id),
  CONSTRAINT performance_evidence_pkey PRIMARY KEY (id),
  CONSTRAINT performance_evidence_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES admins(id),
  CONSTRAINT performance_evidence_severity_check CHECK ((severity = ANY (ARRAY['info'::text, 'low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
  CONSTRAINT performance_evidence_status_check CHECK ((status = ANY (ARRAY['open'::text, 'fixed_by_employee'::text, 'fixed_by_other'::text, 'confirmed'::text, 'dismissed'::text])))
);
CREATE INDEX performance_evidence_admin_status_idx ON public.performance_evidence USING btree (admin_id, status, detected_at DESC);
CREATE INDEX performance_evidence_source_idx ON public.performance_evidence USING btree (source_type, source_id);
CREATE INDEX performance_evidence_fixed_by_idx ON public.performance_evidence USING btree (fixed_by) WHERE (fixed_by IS NOT NULL);
CREATE INDEX performance_evidence_reviewed_by_idx ON public.performance_evidence USING btree (reviewed_by) WHERE (reviewed_by IS NOT NULL);
ALTER TABLE public.performance_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "performance_evidence_read" ON public.performance_evidence FOR SELECT USING (((admin_id = my_admin_id()) OR has_role('super_admin'::text) OR has_role('general_manager'::text)));

CREATE TABLE public.performance_role_allocations (
  admin_id uuid not null,
  role text not null,
  allocation_pct numeric(5,2) not null,
  set_by uuid not null,
  updated_at timestamp with time zone not null default now(),
  CONSTRAINT performance_role_allocations_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
  CONSTRAINT performance_role_allocations_allocation_pct_check CHECK (((allocation_pct > (0)::numeric) AND (allocation_pct <= (100)::numeric))),
  CONSTRAINT performance_role_allocations_pkey PRIMARY KEY (admin_id, role),
  CONSTRAINT performance_role_allocations_set_by_fkey FOREIGN KEY (set_by) REFERENCES admins(id)
);
CREATE INDEX performance_role_allocations_set_by_idx ON public.performance_role_allocations USING btree (set_by);
ALTER TABLE public.performance_role_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "performance_role_allocations_read" ON public.performance_role_allocations FOR SELECT USING (((admin_id = my_admin_id()) OR has_role('super_admin'::text) OR has_role('general_manager'::text)));

CREATE TABLE public.staff_kpi_alerts (
  id uuid not null default gen_random_uuid(),
  admin_id uuid not null,
  kpi text not null,
  period_end date not null,
  value numeric,
  target numeric,
  score numeric,
  message text not null,
  created_at timestamp with time zone not null default now(),
  acknowledged_at timestamp with time zone,
  CONSTRAINT staff_kpi_alerts_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
  CONSTRAINT staff_kpi_alerts_admin_id_kpi_period_end_key UNIQUE (admin_id, kpi, period_end),
  CONSTRAINT staff_kpi_alerts_pkey PRIMARY KEY (id)
);
ALTER TABLE public.staff_kpi_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_alerts_ack" ON public.staff_kpi_alerts FOR UPDATE USING ((my_role() = ANY (ARRAY['super_admin'::text, 'general_manager'::text]))) WITH CHECK ((my_role() = ANY (ARRAY['super_admin'::text, 'general_manager'::text])));
CREATE POLICY "staff_alerts_read" ON public.staff_kpi_alerts FOR SELECT USING ((my_role() = ANY (ARRAY['super_admin'::text, 'general_manager'::text])));

CREATE TABLE public.staff_kpi_settings (
  key text not null,
  value jsonb not null default 'false'::jsonb,
  updated_by uuid,
  updated_at timestamp with time zone not null default now(),
  CONSTRAINT staff_kpi_settings_pkey PRIMARY KEY (key)
);
ALTER TABLE public.staff_kpi_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_kpi_settings_read" ON public.staff_kpi_settings FOR SELECT USING ((my_admin_id() IS NOT NULL));
CREATE POLICY "staff_kpi_settings_write" ON public.staff_kpi_settings FOR ALL USING ((my_role() = 'super_admin'::text)) WITH CHECK ((my_role() = 'super_admin'::text));

CREATE TABLE public.staff_monthly_summaries (
  admin_id uuid not null,
  month date not null,
  strength text not null default ''::text,
  improve text not null default ''::text,
  action text not null default ''::text,
  score integer,
  kpis jsonb not null default '[]'::jsonb,
  source text not null default 'claude'::text,
  created_at timestamp with time zone not null default now(),
  CONSTRAINT staff_monthly_summaries_action_check CHECK ((length(action) <= 800)),
  CONSTRAINT staff_monthly_summaries_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
  CONSTRAINT staff_monthly_summaries_improve_check CHECK ((length(improve) <= 800)),
  CONSTRAINT staff_monthly_summaries_pkey PRIMARY KEY (admin_id, month),
  CONSTRAINT staff_monthly_summaries_source_check CHECK ((source = ANY (ARRAY['claude'::text, 'system'::text]))),
  CONSTRAINT staff_monthly_summaries_strength_check CHECK ((length(strength) <= 800))
);
ALTER TABLE public.staff_monthly_summaries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_summaries_read" ON public.staff_monthly_summaries FOR SELECT USING ((my_role() = ANY (ARRAY['super_admin'::text, 'general_manager'::text])));

CREATE TABLE public.staff_reviews (
  admin_id uuid not null,
  month date not null,
  rating integer not null,
  note text not null default ''::text,
  reviewed_by uuid,
  updated_at timestamp with time zone not null default now(),
  CONSTRAINT staff_reviews_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES admins(id) ON DELETE CASCADE,
  CONSTRAINT staff_reviews_note_check CHECK ((length(note) <= 1000)),
  CONSTRAINT staff_reviews_pkey PRIMARY KEY (admin_id, month),
  CONSTRAINT staff_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);
ALTER TABLE public.staff_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_reviews_read" ON public.staff_reviews FOR SELECT USING ((my_role() = ANY (ARRAY['super_admin'::text, 'general_manager'::text])));
CREATE POLICY "staff_reviews_update" ON public.staff_reviews FOR UPDATE USING ((my_role() = ANY (ARRAY['super_admin'::text, 'general_manager'::text]))) WITH CHECK ((reviewed_by = my_admin_id()));
CREATE POLICY "staff_reviews_write" ON public.staff_reviews FOR INSERT WITH CHECK (((my_role() = ANY (ARRAY['super_admin'::text, 'general_manager'::text])) AND (reviewed_by = my_admin_id())));
