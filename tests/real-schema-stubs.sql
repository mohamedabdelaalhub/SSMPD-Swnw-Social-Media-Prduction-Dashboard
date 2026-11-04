-- Minimal Supabase stand-ins so the repo's real supabase/setup.sql can be loaded into a THROWAWAY local PostgreSQL (no network, dummy data only).
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;   -- Supabase's service_role bypasses RLS create role authenticator nologin; create role supabase_admin nologin;
-- Supabase gives anon/authenticated/service_role ALL on every NEW object in public through default privileges (observed live on video_jobs, review #122).
-- Without this the fixture under-reported the real grants. Set BEFORE setup.sql/migrations are loaded; RLS and explicit revokes in the repo still apply on top.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
create schema if not exists extensions; create extension if not exists pgcrypto;
create schema auth;
create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}'::jsonb, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role',true),''), nullif(current_setting('test.role',true),'')) $$;
create function auth.jwt() returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create publication supabase_realtime;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb, created_at timestamptz default now());
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;
grant usage on schema auth, storage, extensions to anon, authenticated, service_role;
