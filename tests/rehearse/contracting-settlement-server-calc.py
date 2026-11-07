"""Throwaway local Postgres rehearsal for 20261107200000_contracting_settlement_server_calc.sql.
Needs: pip install pgserver psycopg2-binary (in a venv). Usage: python -I this.py <repo-dir> <empty-tmp-dir>"""
import sys, json, datetime, pgserver, psycopg2

repo, data = sys.argv[1], sys.argv[2]
MIG = open(f"{repo}/supabase/migrations/20261107200000_contracting_settlement_server_calc.sql", encoding="utf-8").read()
RB = open(f"{repo}/supabase/rollbacks/20261107200000_contracting_settlement_server_calc.rollback.sql", encoding="utf-8").read()

BASE = """
create role anon nologin; create role authenticated nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth, public to authenticated;
create table public.admins(id uuid primary key, user_id uuid, role text, active boolean default true);
create function public.is_super() returns boolean language sql security definer stable as $$ select exists(select 1 from public.admins where user_id=auth.uid() and active and role='super_admin') $$;
create function public.has_role(r text) returns boolean language sql security definer stable as $$ select exists(select 1 from public.admins where user_id=auth.uid() and active and role=r) $$;
create function public.my_admin_id() returns uuid language sql security definer stable as $$ select id from public.admins where user_id=auth.uid() $$;
create function public.is_controlled_finance() returns boolean language sql stable as $$ select false $$;
create function public.finance_module_allowed(m text, a text) returns boolean language sql stable as $$ select false $$;
grant execute on all functions in schema public to authenticated;
create table public.contracting_entities(id uuid primary key, name text);
create table public.contracting_referrals(id uuid primary key default gen_random_uuid(), entity_id uuid not null references public.contracting_entities(id), status text not null default 'new', created_at timestamptz not null default now());
create table public.contracting_incentive_tiers(id uuid primary key default gen_random_uuid(), entity_id uuid references public.contracting_entities(id), preset_key text, min_amount numeric(14,2) not null default 0, max_amount numeric(14,2), rate_percent numeric(6,3) not null, sort_order integer not null default 0, active boolean not null default true);
create table public.contracting_partner_transactions(id uuid primary key default gen_random_uuid(), entity_id uuid not null references public.contracting_entities(id), eligible boolean not null default true, collected_amount numeric(14,2) not null default 0, refunded_amount numeric(14,2) not null default 0, transaction_date date not null default current_date);
create table public.contracting_settlements(id uuid primary key default gen_random_uuid(), entity_id uuid not null references public.contracting_entities(id) on delete cascade, period_start date not null, period_end date not null, eligible_revenue numeric(14,2) not null default 0, referral_count integer not null default 0, completed_count integer not null default 0, incentive_amount numeric(14,2) not null default 0, adjustments numeric(14,2) not null default 0, status text not null default 'under_review', reviewed_by uuid, approved_by uuid, paid_at timestamptz, created_at timestamptz not null default now(), unique(entity_id, period_start, period_end));
create table public.contracting_activity_log(id uuid primary key default gen_random_uuid(), entity_id uuid not null, agreement_id uuid, action_key text not null, summary text not null, metadata jsonb not null default '{}', created_by uuid, created_at timestamptz not null default now());
alter table public.contracting_settlements enable row level security;
create policy s_all on public.contracting_settlements for all to authenticated using (public.has_role('contract_manager') or public.is_super()) with check (public.has_role('contract_manager') or public.is_super());
grant select, insert, update, delete on all tables in schema public to authenticated;
insert into public.admins values
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000000aa','super_admin',true),
 ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000000bb','contract_manager',true),
 ('00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-0000000000cc','reception',true);
insert into public.contracting_entities values ('00000000-0000-0000-0000-0000000000e1','A'),('00000000-0000-0000-0000-0000000000e2','B');
"""
SUPER, MGR, REC = "00000000-0000-0000-0000-0000000000aa", "00000000-0000-0000-0000-0000000000bb", "00000000-0000-0000-0000-0000000000cc"
E1, E2 = "00000000-0000-0000-0000-0000000000e1", "00000000-0000-0000-0000-0000000000e2"

srv = pgserver.get_server(data, cleanup_mode="delete")
def conn():
    c = psycopg2.connect(srv.get_uri()); c.autocommit = True; return c

def run(sub, sql, params=()):
    c = conn(); cur = c.cursor()
    try:
        cur.execute("begin")
        cur.execute("select set_config('request.jwt.claim.sub',%s,true)", (sub,))
        cur.execute("set local role authenticated")
        cur.execute(sql, params)
        out = cur.fetchone() if cur.description else cur.rowcount
        cur.execute("commit"); return ("OK", out)
    except Exception as e:
        return ("ERR", str(e).splitlines()[0])
    finally:
        c.close()

fails = []
def check(name, got, want, pred=None):
    ok = got[0] == want and (pred is None or pred(got[1]))
    print(("PASS " if ok else "FAIL ") + name + " -> " + str(got)[:220])
    if not ok: fails.append(name)

c = conn(); cur = c.cursor()
cur.execute("drop schema if exists public cascade; create schema public")
for s in ("auth",):
    cur.execute(f"drop schema if exists {s} cascade")
for r in ("anon", "authenticated"):
    try: cur.execute(f"drop role {r}")
    except Exception: pass
cur.execute(BASE)

today = datetime.date.today()
first = today.replace(day=1)
prev_last = first - datetime.timedelta(days=1)
# this month: 30000 collected (+1000 refunded on a 1000 tx), one ineligible 9999; last month: 50000 (must be excluded)
cur.execute("""insert into public.contracting_partner_transactions(entity_id,eligible,collected_amount,refunded_amount,transaction_date) values
 (%s,true,20000,0,%s),(%s,true,10000,0,%s),(%s,true,1000,1000,%s),(%s,false,9999,0,%s),(%s,true,50000,0,%s)""",
 (E1, first, E1, today, E1, today, E1, today, E1, prev_last))
cur.execute("insert into public.contracting_referrals(entity_id,status,created_at) values (%s,'completed',now()),(%s,'new',now()),(%s,'collected',now() - interval '40 days')", (E1, E1, E1))

print("== apply migration twice")
cur.execute(MIG); cur.execute(MIG)
CALL = "select public.contracting_create_settlement(%s::uuid, %s::date)"
r = run(MGR, CALL, (E1, None))
check("manager creates current month", r, "OK", lambda o: True)
row = r[1][0] if r[0] == "OK" else {}
# 10000*5% + 15000*7.5% + 5000*10% = 500 + 1125 + 500 = 2125
check("eligible = this month only (30000)", ("OK", row.get("eligible_revenue")), "OK", lambda v: float(v) == 30000)
check("incentive progressive = 2125", ("OK", row.get("incentive_amount")), "OK", lambda v: float(v) == 2125)
check("referrals this month = 2, completed = 1", ("OK", (row.get("referral_count"), row.get("completed_count"))), "OK", lambda v: v == (2, 1))
check("status under_review", ("OK", row.get("status")), "OK", lambda v: v == "under_review")
check("activity log written", run(SUPER, "select count(*) from public.contracting_activity_log where action_key='settlement_created'"), "OK", lambda o: o[0] == 1)
r = run(MGR, CALL, (E1, prev_last))
check("previous month uses last month only (50000 -> 500+1125+2500 = 4125)", r, "OK", lambda o: float(o[0]["eligible_revenue"]) == 50000 and float(o[0]["incentive_amount"]) == 4125)
check("future month refused", run(MGR, CALL, (E1, (first + datetime.timedelta(days=40)))), "ERR")
check("reception refused", run(REC, CALL, (E1, None)), "ERR")
check("unknown entity refused", run(MGR, CALL, ("00000000-0000-0000-0000-0000000000ff", None)), "ERR")
cur.execute("insert into public.contracting_partner_transactions(entity_id,collected_amount,transaction_date) values (%s,1000,%s)", (E1, today))
check("recalc while under_review updates (31000 -> 500+1125+600 = 2225)", run(MGR, CALL, (E1, None)), "OK", lambda o: float(o[0]["incentive_amount"]) == 2225)
check("still one row for the month", run(SUPER, "select count(*) from public.contracting_settlements where entity_id=%s and period_start=%s", (E1, first)), "OK", lambda o: o[0] == 1)

print("== approved / paid protection")
check("super approves", run(SUPER, "update public.contracting_settlements set status='approved' where entity_id=%s and period_start=%s", (E1, first)), "OK", lambda n: n == 1)
check("button again on approved month refused", run(MGR, CALL, (E1, None)), "ERR")
check("manager direct edit of amount refused", run(MGR, "update public.contracting_settlements set incentive_amount=1 where entity_id=%s and period_start=%s", (E1, first)), "ERR")
check("manager direct reset to under_review refused", run(MGR, "update public.contracting_settlements set status='under_review' where entity_id=%s and period_start=%s", (E1, first)), "ERR")
check("manager direct upsert (old browser path) refused",
      run(MGR, "insert into public.contracting_settlements(entity_id,period_start,period_end,incentive_amount,status) values (%s,%s,%s,1,'under_review') on conflict (entity_id,period_start,period_end) do update set incentive_amount=excluded.incentive_amount,status=excluded.status",
          (E1, first, (first.replace(day=28) + datetime.timedelta(days=4)).replace(day=1) - datetime.timedelta(days=1))), "ERR")
check("approved -> paid with same amounts allowed", run(MGR, "update public.contracting_settlements set status='paid', paid_at=now() where entity_id=%s and period_start=%s", (E1, first)), "OK", lambda n: n == 1)
check("delete paid refused", run(MGR, "delete from public.contracting_settlements where entity_id=%s and period_start=%s", (E1, first)), "ERR")
check("amount still 2225 after attacks", run(SUPER, "select incentive_amount from public.contracting_settlements where entity_id=%s and period_start=%s", (E1, first)), "OK", lambda o: float(o[0]) == 2225)
check("super can still correct a paid row", run(SUPER, "update public.contracting_settlements set adjustments=5 where entity_id=%s and period_start=%s", (E1, first)), "OK", lambda n: n == 1)
check("under_review row can be deleted by manager", run(MGR, "delete from public.contracting_settlements where entity_id=%s and period_start=%s", (E1, prev_last.replace(day=1))), "OK", lambda n: n == 1)

print("== entity-specific tiers")
cur.execute("insert into public.contracting_partner_transactions(entity_id,collected_amount,transaction_date) values (%s,20000,%s)", (E2, today))
cur.execute("insert into public.contracting_incentive_tiers(entity_id,min_amount,max_amount,rate_percent,sort_order) values (%s,0,null,3,1)", (E2,))
check("entity tier 3%% of 20000 = 600", run(MGR, CALL, (E2, None)), "OK", lambda o: float(o[0]["incentive_amount"]) == 600)
check("anon cannot execute", ("OK" if not run(MGR, "select has_function_privilege('anon','public.contracting_create_settlement(uuid,date)','execute')")[1][0] else "ERR", None), "OK")

print("== rollback")
cur.execute(RB)
check("function removed", run(SUPER, "select to_regprocedure('public.contracting_create_settlement(uuid,date)') is null"), "OK", lambda o: o[0] is True)
check("guard removed (manager can edit paid row again = old behaviour)", run(MGR, "update public.contracting_settlements set incentive_amount=1 where entity_id=%s and period_start=%s", (E1, first)), "OK", lambda n: n == 1)
c.close()
print("REHEARSAL " + ("OK" if not fails else "FAILED: " + ", ".join(fails)))
sys.exit(1 if fails else 0)
