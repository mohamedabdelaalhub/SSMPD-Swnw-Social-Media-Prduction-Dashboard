"""Throwaway local Postgres rehearsal for 20261107180000_admins_guard_permission_flags.sql.
Usage: pgenv/bin/python -I rehearse_admins_guard.py <repo-dir> <tmp-data-dir>"""
import sys, pgserver, psycopg2

repo, data = sys.argv[1], sys.argv[2]
MIG = open(f"{repo}/supabase/migrations/20261107180000_admins_guard_permission_flags.sql", encoding="utf-8").read()
RB = open(f"{repo}/supabase/rollbacks/20261107180000_admins_guard_permission_flags.rollback.sql", encoding="utf-8").read()
OLD = """
create or replace function public.guard_admin_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_super() then return new; end if;
  if new.role is distinct from old.role or new.active is distinct from old.active then
    raise exception 'غير مسموح بتغيير الدور أو الحالة';
  end if;
  return new;
end $$;
create trigger admins_guard before update on public.admins for each row execute function public.guard_admin_changes();
"""
BASE = """
create role anon nologin; create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', current_setting('request.jwt.claim.email', true)) $$;
grant usage on schema auth to authenticated;
create table public.admins(id uuid primary key default gen_random_uuid(), user_id uuid unique, email text not null, name text,
  role text not null, active boolean not null default true, is_system_identity boolean not null default false,
  has_archive_access boolean not null default false, has_archive_review_access boolean not null default false,
  has_verification_management_access boolean not null default false, can_delete_leads boolean not null default false,
  can_delete_nutrition_visits boolean not null default false, has_hr_access boolean not null default false);
alter table public.admins enable row level security;
grant select, update on public.admins to authenticated;
create function public.is_super() returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid() and active and role = 'super_admin') $$;
grant execute on function public.is_super() to authenticated;
create policy "super update" on public.admins for update to authenticated using (public.is_super()) with check (public.is_super());
create policy "claim own invite" on public.admins for update to authenticated
  using (user_id is null and not is_system_identity and lower(email)=lower((auth.jwt()->>'email'::text)))
  with check (user_id=auth.uid() and not is_system_identity);
create policy "read own or pending" on public.admins for select to authenticated using (true);
insert into public.admins(id,user_id,email,role) values
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000aa','boss@x','super_admin'),
 ('00000000-0000-0000-0000-00000000000b',null,'new@x','reception'),
 ('00000000-0000-0000-0000-00000000000c',null,'new2@x','nursing'),
 ('00000000-0000-0000-0000-00000000000d','00000000-0000-0000-0000-0000000000dd','old@x','reception');
"""
NEW_UID = '00000000-0000-0000-0000-0000000000bb'

srv = pgserver.get_server(data, cleanup_mode="delete")
def conn():
    c = psycopg2.connect(srv.get_uri()); c.autocommit = True; return c

def as_user(cur, sub, email):
    cur.execute("begin")
    cur.execute("select set_config('request.jwt.claim.sub',%s,true), set_config('request.jwt.claim.email',%s,true)", (sub, email))
    cur.execute("set local role authenticated")

def attempt(sql, sub, email, params=()):
    c = conn(); cur = c.cursor()
    try:
        as_user(cur, sub, email); cur.execute(sql, params); n = cur.rowcount; cur.execute("rollback"); return ("OK", n)
    except Exception as e:
        return ("ERR", str(e).splitlines()[0])
    finally:
        c.close()

def service(sql):  # no JWT, table owner (like service_role / hr-staff-account)
    c = conn(); cur = c.cursor()
    try:
        cur.execute("begin"); cur.execute(sql); n = cur.rowcount; cur.execute("rollback"); return ("OK", n)
    except Exception as e:
        return ("ERR", str(e).splitlines()[0])
    finally:
        c.close()

fails = []
def check(name, got, want_status, want_rows=None):
    ok = got[0] == want_status and (want_rows is None or got[1] == want_rows)
    print(("PASS " if ok else "FAIL ") + name + " -> " + str(got))
    if not ok: fails.append(name)

c = conn(); cur = c.cursor()
cur.execute("drop schema if exists public cascade; create schema public")
try: cur.execute("drop schema auth cascade")
except Exception: pass
for r in ("anon", "authenticated"):
    try: cur.execute(f"drop role {r}")
    except Exception: pass
cur.execute(BASE); cur.execute("grant usage on schema public to authenticated"); cur.execute(OLD)

B = "update public.admins set user_id=%s{extra} where id='00000000-0000-0000-0000-00000000000b'"
print("== before fix (bug reproduction)")
check("old: claim + self-grant archive succeeds (BUG)", attempt(B.format(extra=",has_archive_access=true"), NEW_UID, "new@x", (NEW_UID,)), "OK", 1)

print("== apply migration twice")
cur.execute(MIG); cur.execute(MIG)
check("plain claim works", attempt(B.format(extra=""), NEW_UID, "new@x", (NEW_UID,)), "OK", 1)
for col in ("has_archive_access", "has_archive_review_access", "has_verification_management_access", "can_delete_leads", "can_delete_nutrition_visits", "has_hr_access"):
    check(f"claim + {col} blocked", attempt(B.format(extra=f",{col}=true"), NEW_UID, "new@x", (NEW_UID,)), "ERR")
check("claim + role change blocked", attempt(B.format(extra=",role='super_admin'"), NEW_UID, "new@x", (NEW_UID,)), "ERR")
check("claim of someone else's invite = 0 rows", attempt(B.format(extra=""), NEW_UID, "other@x", (NEW_UID,)), "OK", 0)
SUP = ("00000000-0000-0000-0000-0000000000aa", "boss@x")
check("super grants flags", attempt("update public.admins set has_archive_access=true, can_delete_leads=true where id='00000000-0000-0000-0000-00000000000d'", *SUP), "OK", 1)
check("super changes role", attempt("update public.admins set role='nursing' where id='00000000-0000-0000-0000-00000000000d'", *SUP), "OK", 1)
check("super re-links account", attempt("update public.admins set user_id=null where id='00000000-0000-0000-0000-00000000000d'", *SUP), "OK", 1)
check("service binds user_id (hr-staff-account path)", service("update public.admins set user_id='00000000-0000-0000-0000-0000000000cc' where id='00000000-0000-0000-0000-00000000000c' and user_id is null"), "OK", 1)
check("service cannot re-bind linked account", service("update public.admins set user_id='00000000-0000-0000-0000-0000000000cc' where id='00000000-0000-0000-0000-00000000000d'"), "ERR")
check("non-flag column change by service still ok", service("update public.admins set name='x' where id='00000000-0000-0000-0000-00000000000d'"), "OK", 1)

print("== rollback restores previous behaviour")
cur.execute(RB)
check("after rollback: self-grant succeeds again (old behaviour)", attempt(B.format(extra=",has_archive_access=true"), NEW_UID, "new@x", (NEW_UID,)), "OK", 1)
check("after rollback: role change still blocked", attempt(B.format(extra=",role='super_admin'"), NEW_UID, "new@x", (NEW_UID,)), "ERR")
c.close()
print("REHEARSAL " + ("OK" if not fails else "FAILED: " + ", ".join(fails)))
sys.exit(1 if fails else 0)
