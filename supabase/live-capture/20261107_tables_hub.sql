-- LIVE CAPTURE (2026-11-07): table structure read from production catalogs (read-only).
-- Reference snapshot only. NOT a migration: do not apply blindly.
-- Generated from docs/live-schema/tables-raw-20261107.txt. Unqualified names resolve via search_path (public).
-- Not captured: grants, policy roles (TO ...), permissive/restrictive flag, triggers, sequences ownership, seed rows.

CREATE TABLE hub.audit (
  id uuid not null default gen_random_uuid(),
  actor uuid not null,
  action text not null,
  card_key text not null,
  subject_type text not null,
  subject_value text not null,
  old_enabled boolean,
  new_enabled boolean,
  created_at timestamp with time zone not null default now(),
  CONSTRAINT audit_action_check CHECK ((action = ANY (ARRAY['set'::text, 'remove'::text]))),
  CONSTRAINT audit_pkey PRIMARY KEY (id)
);
ALTER TABLE hub.audit ENABLE ROW LEVEL SECURITY;

CREATE TABLE hub.card_access (
  card_key text not null,
  subject_type text not null,
  subject_value text not null default ''::text,
  enabled boolean not null default true,
  updated_by uuid,
  updated_at timestamp with time zone not null default now(),
  CONSTRAINT card_access_card_key_fkey FOREIGN KEY (card_key) REFERENCES hub.cards(card_key) ON DELETE CASCADE,
  CONSTRAINT card_access_check CHECK ((((subject_type = ANY (ARRAY['public'::text, 'authenticated'::text])) AND (subject_value = ''::text)) OR ((subject_type = ANY (ARRAY['role'::text, 'user'::text])) AND ((length(subject_value) >= 2) AND (length(subject_value) <= 64))))),
  CONSTRAINT card_access_pkey PRIMARY KEY (card_key, subject_type, subject_value),
  CONSTRAINT card_access_subject_type_check CHECK ((subject_type = ANY (ARRAY['public'::text, 'authenticated'::text, 'role'::text, 'user'::text]))),
  CONSTRAINT card_access_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES admins(id)
);
ALTER TABLE hub.card_access ENABLE ROW LEVEL SECURITY;

CREATE TABLE hub.cards (
  card_key text not null,
  sort_order integer not null default 100,
  CONSTRAINT cards_card_key_check CHECK ((card_key ~ '^[a-z][a-z0-9_]{1,30}$'::text)),
  CONSTRAINT cards_pkey PRIMARY KEY (card_key)
);
ALTER TABLE hub.cards ENABLE ROW LEVEL SECURITY;
