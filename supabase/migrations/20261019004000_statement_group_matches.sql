begin;
create table clinic_finance.bank_group_matches(row_id uuid not null references clinic_finance.bank_rows(id),line_id uuid not null unique references clinic_finance.lines(id),created_by uuid not null references public.admins(id),created_at timestamptz not null default now(),primary key(row_id,line_id));
alter table clinic_finance.bank_group_matches enable row level security;
revoke all on clinic_finance.bank_group_matches from public,anon,authenticated;
create function public.clinic_finance_reconciliation_match(p_row uuid,p_lines uuid[],p_note text,p_token uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=clinic_finance.require_access('review');r clinic_finance.bank_rows%rowtype;s clinic_finance.bank_statements%rowtype;total numeric;ct integer;op clinic_finance.journal_operations%rowtype;payload jsonb:=jsonb_build_object('row',p_row,'lines',p_lines,'note',p_note);begin
 perform clinic_finance.lock_day();if p_token is null or length(trim(coalesce(p_note,''))) not between 3 and 1000 or coalesce(array_length(p_lines,1),0) not between 1 and 100 then raise exception 'اختر من حركة إلى 100 حركة واكتب سبب الربط';end if;
 select * into op from clinic_finance.journal_operations where actor=me and token=p_token;if found then if op.action<>'bank_group_match' or op.payload<>payload then raise exception 'مفتاح مستخدم لطلب آخر';end if;return p_row;end if;
 select * into r from clinic_finance.bank_rows where id=p_row for update;if not found then raise exception 'سطر الكشف غير موجود';end if;
 select * into s from clinic_finance.bank_statements where id=r.statement_id for update;if s.status<>'pending' or r.line_id is not null or exists(select 1 from clinic_finance.bank_group_matches where row_id=p_row) then raise exception 'الكشف معتمد أو السطر مرتبط بالفعل';end if;
 perform 1 from clinic_finance.lines where id=any(p_lines) order by id for update;
 select count(*),sum(l.debit-l.credit) into ct,total from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id where l.id=any(p_lines) and l.account=s.account and e.business_date between s.from_date-7 and s.to_date+7 and not exists(select 1 from clinic_finance.bank_rows where line_id=l.id) and not exists(select 1 from clinic_finance.bank_group_matches where line_id=l.id);
 if ct<>array_length(p_lines,1) or total<>r.amount then raise exception 'الحركات مكررة أو مرتبطة أو خارج الفترة أو مجموعها لا يساوي مبلغ الكشف';end if;
 insert into clinic_finance.bank_group_matches(row_id,line_id,created_by) select p_row,x,me from unnest(p_lines)x;
 update clinic_finance.bank_rows set line_id=p_lines[1] where id=p_row;
 insert into clinic_finance.journal_operations values(me,p_token,'bank_group_match',payload,jsonb_build_object('id',p_row),now());insert into clinic_finance.audit(actor,action,entity_id,detail) values(me,'bank_group_match',p_row,payload);return p_row;
end $$;
-- Protect every allocated line, not only the first compatibility link.
create function clinic_finance.group_match_reversal_guard() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$begin
 if new.source='manual_reversal' and exists(select 1 from clinic_finance.manual_batches b join clinic_finance.lines l on l.entry_id=(b.payload->>'entry_id')::uuid join clinic_finance.bank_group_matches g on g.line_id=l.id where b.id=new.source_id) then raise exception 'القيد مرتبط بمطابقة مجمعة؛ فك المطابقة قبل التصحيح';end if;return new;end $$;
create trigger bank_group_reversal before insert on clinic_finance.entries for each row execute function clinic_finance.group_match_reversal_guard();
-- Include combined-line allocations and settlement evidence in report results.
alter function public.clinic_finance_reconciliation_report(uuid) set schema clinic_finance;
alter function clinic_finance.clinic_finance_reconciliation_report(uuid) rename to group_report_base;
create function public.clinic_finance_reconciliation_report(p_statement uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare v jsonb:=clinic_finance.group_report_base(p_statement);begin
 v:=jsonb_set(v,'{rows}',(select coalesce(jsonb_agg(x||jsonb_build_object('line_ids',(select coalesce(jsonb_agg(line_id),'[]') from clinic_finance.bank_group_matches where row_id=(x->>'id')::uuid))),'[]') from jsonb_array_elements(v->'rows')x));
 v:=jsonb_set(v,'{lines}',(select coalesce(jsonb_agg(x||jsonb_build_object('already_matched',coalesce((x->>'already_matched')::boolean,false) or exists(select 1 from clinic_finance.bank_group_matches where line_id=(x->>'id')::uuid))),'[]') from jsonb_array_elements(v->'lines')x));return v;
end $$;
-- Unmatch clears every allocation atomically. The base still checks approval state and financial permission.
alter function public.clinic_finance_bank_command(text,jsonb,uuid) set schema clinic_finance;
alter function clinic_finance.clinic_finance_bank_command(text,jsonb,uuid) rename to group_bank_command_base;
create function public.clinic_finance_bank_command(p_action text,p_payload jsonb,p_token uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$declare v uuid;begin
 if exists(select 1 from clinic_finance.journal_operations where actor=public.my_admin_id() and token=p_token) then return clinic_finance.group_bank_command_base(p_action,p_payload,p_token);end if;
 if p_action='match' and exists(select 1 from clinic_finance.bank_group_matches where row_id=(p_payload->>'row_id')::uuid) then raise exception 'فك المطابقة المجمعة قبل تغيير الربط';end if;
 v:=clinic_finance.group_bank_command_base(p_action,p_payload,p_token);
 if p_action='unmatch' then delete from clinic_finance.bank_group_matches where row_id=(p_payload->>'row_id')::uuid;end if;return v;
end $$;
alter function public.clinic_finance_snapshot(date,date,integer) set schema clinic_finance;
alter function clinic_finance.clinic_finance_snapshot(date,date,integer) rename to group_snapshot_base;
create function public.clinic_finance_snapshot(p_from date,p_to date,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare v jsonb:=clinic_finance.group_snapshot_base(p_from,p_to,p_offset);begin
 if v ? 'bank_unmatched' then v:=jsonb_set(v,'{bank_unmatched}',(select coalesce(jsonb_agg(x),'[]') from jsonb_array_elements(v->'bank_unmatched')x where not exists(select 1 from clinic_finance.bank_group_matches where line_id=(x->>'id')::uuid)));end if;return v;end $$;
revoke all on function public.clinic_finance_snapshot(date,date,integer) from public,anon;
grant execute on function public.clinic_finance_snapshot(date,date,integer) to authenticated;
revoke all on all functions in schema clinic_finance from public,anon,authenticated;
revoke all on function public.clinic_finance_reconciliation_match(uuid,uuid[],text,uuid),public.clinic_finance_reconciliation_report(uuid),public.clinic_finance_bank_command(text,jsonb,uuid) from public,anon;
grant execute on function public.clinic_finance_reconciliation_match(uuid,uuid[],text,uuid),public.clinic_finance_reconciliation_report(uuid),public.clinic_finance_bank_command(text,jsonb,uuid) to authenticated;
commit;
