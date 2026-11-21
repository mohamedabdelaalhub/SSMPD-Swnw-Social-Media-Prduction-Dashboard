"""Clean-room rebuild rehearsal: apply supabase/setup.sql + supabase/migrations/*.sql (+ live-capture) to an EMPTY local Postgres
with Supabase platform stubs, retry failed files until no progress, then report what could not be built.
Usage: python -I rebuild_rehearsal.py <repo-dir> <empty-data-dir> <out-json>"""
import sys, os, glob, json, re, time
import pgserver, psycopg2

repo, data, out = sys.argv[1], sys.argv[2], sys.argv[3]
srv = pgserver.get_server(data, cleanup_mode="delete")

def conn():
    c = psycopg2.connect(srv.get_uri()); c.autocommit = True; return c

STUBS = r"""
do $$ begin
  if not exists (select from pg_roles where rolname='anon') then create role anon nologin noinherit; end if;
  if not exists (select from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if;
  if not exists (select from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if;
  if not exists (select from pg_roles where rolname='supabase_admin') then create role supabase_admin nologin; end if;
  if not exists (select from pg_roles where rolname='authenticator') then create role authenticator noinherit login; end if;
end $$;
create schema if not exists extensions; create schema if not exists auth; create schema if not exists storage;
create schema if not exists vault; create schema if not exists cron; create schema if not exists net; create schema if not exists realtime;
create schema if not exists legacy_dashboard; create schema if not exists hub; create schema if not exists performance_private;
create function extensions.digest(data text, type text) returns bytea language sql immutable as $f$ select case lower(type) when 'md5' then decode(md5(data),'hex') else sha256(convert_to(data,'utf8')) end $f$;
create function extensions.digest(data bytea, type text) returns bytea language sql immutable as $f$ select case lower(type) when 'md5' then decode(md5(data),'hex') else sha256(data) end $f$;
create function extensions.hmac(data text, key text, type text) returns bytea language sql immutable as $f$ select sha256(convert_to(key||data,'utf8')) $f$;
create function extensions.hmac(data bytea, key bytea, type text) returns bytea language sql immutable as $f$ select sha256(key||data) $f$;
create function extensions.gen_random_bytes(n integer) returns bytea language sql volatile as $f$ select decode(substr(md5(random()::text)||md5(random()::text)||md5(random()::text)||md5(random()::text),1,n*2),'hex') $f$;
create function extensions.gen_salt(t text) returns text language sql volatile as $f$ select '$2a$06$'||md5(random()::text) $f$;
create function extensions.crypt(pw text, salt text) returns text language sql immutable as $f$ select salt||md5(pw||salt) $f$;
create function extensions.uuid_generate_v4() returns uuid language sql volatile as $f$ select gen_random_uuid() $f$;
grant usage on schema public, extensions, auth, storage to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
create table auth.users(id uuid primary key default gen_random_uuid(), email text, phone text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}', encrypted_password text, email_confirmed_at timestamptz, created_at timestamptz default now(), updated_at timestamptz default now(), last_sign_in_at timestamptz, banned_until timestamptz, is_anonymous boolean default false, aud text, role text);
create table auth.identities(id uuid primary key default gen_random_uuid(), user_id uuid references auth.users(id), provider text, identity_data jsonb, created_at timestamptz default now());
create table auth.sessions(id uuid primary key default gen_random_uuid(), user_id uuid, created_at timestamptz default now(), updated_at timestamptz, ip inet, user_agent text);
create table auth.audit_log_entries(id uuid primary key default gen_random_uuid(), payload jsonb, created_at timestamptz default now(), ip_address text);
create table auth.refresh_tokens(id bigserial primary key, user_id text, token text, revoked boolean default false, created_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $f$ select nullif(coalesce(current_setting('request.jwt.claim.sub', true), (nullif(current_setting('request.jwt.claims', true),'')::jsonb)->>'sub'),'')::uuid $f$;
create function auth.jwt() returns jsonb language sql stable as $f$ select coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb, jsonb_build_object('sub', current_setting('request.jwt.claim.sub', true), 'email', current_setting('request.jwt.claim.email', true))) $f$;
create function auth.role() returns text language sql stable as $f$ select coalesce(nullif(current_setting('request.jwt.claim.role', true),''), (nullif(current_setting('request.jwt.claims', true),'')::jsonb)->>'role', 'anon') $f$;
create function auth.email() returns text language sql stable as $f$ select auth.jwt()->>'email' $f$;
create table storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[], owner uuid, created_at timestamptz default now(), updated_at timestamptz default now());
create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, owner_id text, metadata jsonb, path_tokens text[], created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $f$ select string_to_array(name,'/') $f$;
create function storage.filename(name text) returns text language sql immutable as $f$ select (string_to_array(name,'/'))[array_length(string_to_array(name,'/'),1)] $f$;
create function storage.extension(name text) returns text language sql immutable as $f$ select (regexp_match(name,'\.([^.]+)$'))[1] $f$;
create table vault.secrets(id uuid primary key default gen_random_uuid(), name text unique, description text, secret text, created_at timestamptz default now());
create view vault.decrypted_secrets as select id, name, description, secret, secret as decrypted_secret, created_at from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid language sql as $f$ insert into vault.secrets(name,description,secret) values(new_name,new_description,new_secret) returning id $f$;
create table cron.job(jobid bigserial primary key, schedule text, command text, jobname text unique, active boolean default true);
create table cron.job_run_details(runid bigserial primary key, jobid bigint, status text, return_message text, start_time timestamptz, end_time timestamptz);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $f$ insert into cron.job(jobname,schedule,command) values(job_name,schedule,command) on conflict (jobname) do update set schedule=excluded.schedule, command=excluded.command returning jobid $f$;
create function cron.schedule(schedule text, command text) returns bigint language sql as $f$ insert into cron.job(schedule,command) values(schedule,command) returning jobid $f$;
create function cron.unschedule(job_name text) returns boolean language sql as $f$ delete from cron.job where jobname=job_name returning true $f$;
create function cron.unschedule(job_id bigint) returns boolean language sql as $f$ delete from cron.job where jobid=job_id returning true $f$;
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000) returns bigint language sql as $f$ select 1::bigint $f$;
create function net.http_get(url text, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000) returns bigint language sql as $f$ select 1::bigint $f$;
create publication supabase_realtime;
grant all on all tables in schema auth, storage, vault, cron to service_role;
grant select on auth.users to authenticated;
"""

def run_file(path):
    sql = open(path, encoding="utf-8").read()
    c = conn(); cur = c.cursor()
    try:
        cur.execute("set statement_timeout='120s'")
        cur.execute("set search_path=public, extensions")
        sql = re.sub(r"create extension if not exists [^;]*;", "", sql, flags=re.I)
        if not sql.strip().strip(";").strip():
            return None
        cur.execute(sql)
        return None
    except Exception as e:
        msg = str(e).strip().splitlines()[0][:200]
        try:
            pos = int(getattr(e.diag, "statement_position", 0) or 0)
            ctx = re.sub(r"\s+", " ", sql[max(0, pos-1):pos+160])
            ln = sql.count("\n", 0, max(0, pos-1)) + 1
            return f"{msg} @line {ln}: {ctx}"
        except Exception:
            return msg
    finally:
        try: c.close()
        except Exception: pass

c = conn(); cur = c.cursor()
cur.execute("select version()"); print(cur.fetchone()[0][:60])
cur.execute(STUBS); c.close()

files = []
base = os.path.join(repo, "supabase")
if os.path.exists(f"{base}/setup.sql"): files.append(f"{base}/setup.sql")
files += sorted(glob.glob(f"{base}/migrations/*.sql"))
loose = [f for f in sorted(glob.glob(f"{base}/*.sql")) if not f.endswith("setup.sql") and "backfill_data" not in f] + sorted(glob.glob(f"{base}/activation/*.sql"))
files += loose
caps = sorted(glob.glob(f"{base}/live-capture/*_tables_*.sql")) + sorted(glob.glob(f"{base}/live-capture/*.sql"))
seen = set(); caps = [f for f in caps if not (f in seen or seen.add(f))]
# captured tables go before captured functions
caps = sorted(caps, key=lambda f: (0 if "_tables_" in os.path.basename(f) or "addendum" in os.path.basename(f) else 1, f))
allf = files + caps
print("files:", len(allf))

status = {f: "pending" for f in allf}
errors = {}
for rnd in range(1, 9):
    progress = 0
    for f in allf:
        if status[f] == "ok": continue
        err = run_file(f)
        if err is None:
            status[f] = "ok"; progress += 1; errors.pop(f, None)
        else:
            status[f] = "fail"; errors[f] = err
    ok = sum(1 for v in status.values() if v == "ok")
    print(f"round {rnd}: ok={ok}/{len(allf)} newly_ok={progress} failing={len(allf)-ok}", flush=True)
    if progress == 0: break

c = conn(); cur = c.cursor()
cur.execute("select count(*) from information_schema.tables where table_schema in ('public','legacy_dashboard','performance_private','clinic_reception','clinic_finance','clinic_prices','clinic_people','hub','psychcare') and table_type='BASE TABLE'")
tables = cur.fetchone()[0]
cur.execute("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','legacy_dashboard','performance_private','clinic_reception','clinic_finance','clinic_prices','clinic_people') and p.prokind in ('f','p')")
funcs = cur.fetchone()[0]
cur.execute("select n.nspname||'.'||p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','legacy_dashboard','performance_private','clinic_reception','clinic_finance','clinic_prices','clinic_people') and p.prokind in ('f','p')")
funcnames = sorted(r[0] for r in cur.fetchall())
cur.execute("select table_schema||'.'||table_name from information_schema.tables where table_schema in ('public','legacy_dashboard','performance_private','clinic_reception','clinic_finance','clinic_prices','clinic_people','hub','psychcare') and table_type='BASE TABLE'")
tabnames = sorted(r[0] for r in cur.fetchall())
res = {"files_total": len(allf), "files_ok": sum(1 for v in status.values() if v == "ok"),
       "failing": {os.path.relpath(f, repo): e for f, e in errors.items()},
       "built_tables": tables, "built_functions": funcs, "tables": tabnames, "functions": funcnames}
json.dump(res, open(out, "w"), ensure_ascii=False, indent=1)
print(json.dumps({k: v for k, v in res.items() if k not in ("tables", "functions", "failing")}))
print("failing files:", len(errors))
