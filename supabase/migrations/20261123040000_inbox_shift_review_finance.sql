-- «للمراجعة النهاردة»: «استلام» on a shift (owner 2026-11-23: «خلي صلاحية ظهوره للأدوار المخولة ... ومايظهرش لبقية الأدوار ويبقي فعال»).
-- Every shift, reception-opened ones included, is reviewed with public.clinic_finance_review_shift (the live reception workspace
-- refuses clinic_reception_command 'shift_review'), which needs clinic_finance 'review'. So the inbox lists shifts waiting for
-- review only to users with finance 'review' — no one sees a «استلام» button they cannot use. Open shifts (read-only) unchanged.
-- In-place anchor patch of public.clinic_review_inbox(); the previous body is saved in clinic_reception.inbox_shift_saved_defs.
-- Rollback: supabase/rollbacks/20261123040000_inbox_shift_review_finance.rollback.sql
begin;

do $$ begin
  if to_regprocedure('public.clinic_review_inbox()') is null then raise exception 'طبّق صندوق المراجعة أولًا'; end if;
  if to_regclass('clinic_reception.inbox_shift_saved_defs') is not null then raise exception 'تم تطبيق هذا الملف من قبل'; end if;
end $$;

create table clinic_reception.inbox_shift_saved_defs (name text primary key, def text not null, saved_at timestamptz not null default now());
revoke all on clinic_reception.inbox_shift_saved_defs from public, anon, authenticated;
insert into clinic_reception.inbox_shift_saved_defs(name, def) values ('clinic_review_inbox', pg_get_functiondef('public.clinic_review_inbox()'::regprocedure));

do $$ declare d text := pg_get_functiondef('public.clinic_review_inbox()'::regprocedure);
  a text := 'where s.status = ''submitted'' and ((rs.id is null and fin_review) or (rs.id is not null and rx and rs.workspace_id = ws));';
  b text := 'where s.status = ''submitted'' and fin_review;';
  r text := '''rpc'', case when rs.id is not null then ''clinic_reception_command'' else ''clinic_finance_review_shift'' end,';
begin
  if (length(d) - length(replace(d, a, ''))) <> length(a) then raise exception 'clinic_review_inbox shift anchor not found once'; end if;
  d := replace(d, a, b);
  if (length(d) - length(replace(d, r, ''))) = length(r) then d := replace(d, r, '''rpc'', ''clinic_finance_review_shift'','); end if;
  execute d;
end $$;

commit;
