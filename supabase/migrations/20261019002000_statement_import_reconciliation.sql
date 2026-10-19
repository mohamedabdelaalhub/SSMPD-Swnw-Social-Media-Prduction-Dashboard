begin;
alter table clinic_finance.bank_statements add column file_hash text;
alter table clinic_finance.bank_statements add column file_name text;
alter table clinic_finance.bank_statements add column provider text not null default '';
alter table clinic_finance.bank_statements add column source_url text;
alter table clinic_finance.bank_statements add column import_details jsonb not null default '{}';
create unique index bank_file_once on clinic_finance.bank_statements(account,file_hash) where file_hash is not null;
alter table clinic_finance.bank_rows add column source_page integer check(source_page>0);
alter table clinic_finance.bank_rows add column terminal_code text;
alter table clinic_finance.bank_rows add column rrn text;
create index bank_rows_reference on clinic_finance.bank_rows(reference,day);
create table clinic_finance.payment_proofs(payment_id uuid primary key references clinic_finance.payments(id),provider text not null,terminal_code text not null default '',rrn text not null default '',reference text not null,evidence_url text not null default '',recorded_by uuid not null references public.admins(id),updated_at timestamptz not null default now());
create table clinic_finance.advance_proofs(advance_id uuid primary key references clinic_finance.advances(id),provider text not null,terminal_code text not null default '',rrn text not null default '',reference text not null,evidence_url text not null default '',recorded_by uuid not null references public.admins(id),updated_at timestamptz not null default now());
alter table clinic_finance.advance_proofs enable row level security;
revoke all on clinic_finance.advance_proofs from public,anon,authenticated;
alter table clinic_finance.payment_proofs enable row level security;
revoke all on clinic_finance.payment_proofs from public,anon,authenticated;
alter function public.clinic_finance_bank_command(text,jsonb,uuid) set schema clinic_finance;
alter function clinic_finance.clinic_finance_bank_command(text,jsonb,uuid) rename to import_bank_command_base;
create function public.clinic_finance_bank_command(p_action text,p_payload jsonb,p_token uuid) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=case when p_action='proof_advance' then clinic_finance.booking_access('create') else clinic_finance.require_access('create') end;op clinic_finance.journal_operations%rowtype;v uuid;j jsonb;n integer:=0;proof clinic_finance.payment_proofs%rowtype;begin
 perform clinic_finance.lock_day();
 if p_token is null or jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>700000 then raise exception 'بيانات الطلب غير صالحة';end if;
 select * into op from clinic_finance.journal_operations where actor=me and token=p_token;
 if found then if op.action<>'bank_'||p_action or op.payload<>p_payload then raise exception 'مفتاح مستخدم لبيانات أخرى';end if;return (op.result->>'id')::uuid;end if;
 if p_action in('proof','proof_advance') then
 v:=(p_payload->>'payment_id')::uuid;
 if p_action='proof_advance' then
 if not exists(select 1 from clinic_finance.advances where id=v and method<>'cash' and (created_by=me or clinic_finance.allowed('review'))) then raise exception 'المقدم غير متاح لك' using errcode='42501';end if;
 elsif not exists(select 1 from clinic_finance.payments where id=v and method<>'cash' and (created_by=me or clinic_finance.allowed('review'))) then raise exception 'العملية غير متاحة لك' using errcode='42501';end if;
 if length(coalesce(p_payload->>'reference','')) not between 2 and 120 or length(coalesce(p_payload->>'provider','')) not between 2 and 100 or length(coalesce(p_payload->>'terminal_code',''))>80 or length(coalesce(p_payload->>'rrn',''))>80 then raise exception 'راجع بيانات الإيصال';end if;
 if coalesce(p_payload->>'evidence_url','')<>'' and p_payload->>'evidence_url'!~'^https://drive[.]google[.]com/' then raise exception 'استخدم رابط مستند من Google Drive';end if;
 if p_action='proof_advance' then
 perform 1 from clinic_finance.advance_proofs where advance_id=v for update;
 if found and not clinic_finance.allowed('review') then raise exception 'تعديل إثبات محفوظ يحتاج مراجعة مالية';end if;
 insert into clinic_finance.advance_proofs(advance_id,provider,terminal_code,rrn,reference,evidence_url,recorded_by) values(v,p_payload->>'provider',coalesce(p_payload->>'terminal_code',''),coalesce(p_payload->>'rrn',''),p_payload->>'reference',coalesce(p_payload->>'evidence_url',''),me) on conflict(advance_id) do update set provider=excluded.provider,terminal_code=excluded.terminal_code,rrn=excluded.rrn,reference=excluded.reference,evidence_url=excluded.evidence_url,recorded_by=me,updated_at=now();
 else
 select * into proof from clinic_finance.payment_proofs where payment_id=v for update;
 if found and not clinic_finance.allowed('review') then raise exception 'تعديل إثبات محفوظ يحتاج مراجعة مالية';end if;
 insert into clinic_finance.payment_proofs(payment_id,provider,terminal_code,rrn,reference,evidence_url,recorded_by) values(v,p_payload->>'provider',coalesce(p_payload->>'terminal_code',''),coalesce(p_payload->>'rrn',''),p_payload->>'reference',coalesce(p_payload->>'evidence_url',''),me) on conflict(payment_id) do update set provider=excluded.provider,terminal_code=excluded.terminal_code,rrn=excluded.rrn,reference=excluded.reference,evidence_url=excluded.evidence_url,recorded_by=me,updated_at=now();
 end if;
 else
 if p_action='statement' and p_payload ? 'file_hash' then
 perform clinic_finance.require_access('review');
 if p_payload->>'file_hash'!~'^[a-f0-9]{64}$' or p_payload->>'reviewed' is distinct from 'true' or length(coalesce(p_payload->>'file_name','')) not between 1 and 250 or length(coalesce(p_payload->>'provider','')) not between 2 and 100 then raise exception 'راجع الملف والجهة وأكد مراجعة المعاينة';end if;
 if coalesce((p_payload->>'declared_count')::integer,0)<>jsonb_array_length(p_payload->'rows') then raise exception 'عدد العمليات لا يطابق العدد الذي راجعته';end if;
 if coalesce((p_payload->>'declared_total')::numeric,0)<>(select sum((x->>'amount')::numeric) from jsonb_array_elements(p_payload->'rows')x) then raise exception 'إجمالي العمليات لا يطابق الكشف';end if;
 if exists(select 1 from jsonb_array_elements(p_payload->'rows')x group by x->>'day',x->>'reference',(x->>'amount')::numeric having count(*)>1) then raise exception 'توجد سطور مكررة داخل الكشف؛ راجعها قبل الحفظ';end if;
 if exists(select 1 from clinic_finance.bank_rows r join clinic_finance.bank_statements s on s.id=r.statement_id join jsonb_array_elements(p_payload->'rows')x on r.day=(x->>'day')::date and r.reference=x->>'reference' and r.amount=(x->>'amount')::numeric where s.account=p_payload->>'account') then raise exception 'الكشف يتداخل مع عمليات سبق استيرادها؛ راجع الفترة والمراجع';end if;
 if coalesce(p_payload->>'source_url','')<>'' and p_payload->>'source_url'!~'^https://drive[.]google[.]com/' then raise exception 'رابط الأصل يجب أن يكون من Google Drive';end if;
 end if;
 v:=clinic_finance.import_bank_command_base(p_action,p_payload,p_token);
 if p_action='statement' and p_payload ? 'file_hash' then
 update clinic_finance.bank_statements set file_hash=p_payload->>'file_hash',file_name=p_payload->>'file_name',provider=p_payload->>'provider',source_url=nullif(p_payload->>'source_url',''),import_details=jsonb_build_object('count',p_payload->'declared_count','total',p_payload->'declared_total','reviewed',true,'ocr',coalesce(p_payload->'ocr','false')) where id=v;
 for j in select value from jsonb_array_elements(p_payload->'rows') loop n:=n+1;update clinic_finance.bank_rows set source_page=nullif(j->>'page','')::integer,terminal_code=left(j->>'terminal_code',80),rrn=left(j->>'rrn',80) where statement_id=v and row_no=n;end loop;
 end if;
 end if;
 insert into clinic_finance.journal_operations values(me,p_token,'bank_'||p_action,p_payload,jsonb_build_object('id',v),now());
 insert into clinic_finance.audit(actor,action,entity_id,detail) values(me,'bank_'||p_action,v,jsonb_build_object('reference',p_payload->>'reference','file_hash',p_payload->>'file_hash'));return v;
end $$;
-- Dedicated period query: never compare a whole statement to a paginated snapshot.
create function public.clinic_finance_reconciliation_report(p_statement uuid) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare s clinic_finance.bank_statements%rowtype;n integer;begin
 perform clinic_finance.require_access('review');select * into s from clinic_finance.bank_statements where id=p_statement;if not found then raise exception 'الكشف غير موجود';end if;
 select count(*) into n from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id where l.account=s.account and e.business_date between s.from_date-7 and s.to_date+7;
 if n>10000 then raise exception 'الفترة تتجاوز 10000 حركة؛ قسم الكشف لفترات أصغر';end if;
 return jsonb_build_object('statement',to_jsonb(s),'rows',(select coalesce(jsonb_agg(to_jsonb(r) order by row_no),'[]') from clinic_finance.bank_rows r where statement_id=s.id),'lines',(select coalesce(jsonb_agg(x order by business_date,id),'[]') from(
 select l.id,l.account,l.debit-l.credit amount,e.id entry_id,e.source,e.source_id,e.business_date,e.created_at,e.description,e.created_by,coalesce((select name from public.admins where id=coalesce(p.created_by,ad.created_by,au.created_by,ps.created_by)),a.name) actor_name,a.name posting_actor,sh.cashier_id,ca.name cashier_name,sh.id shift_id,r.name register_name,p.id payment_id,coalesce(p.reference,ad.reference,au.reference,ps.reference) payment_reference,coalesce(p.method,ad.method) method,i.reference invoice_reference,i.patient_ref,coalesce(pr.reference,ap.reference) receipt_reference,coalesce(pr.rrn,ap.rrn) rrn,coalesce(pr.terminal_code,ap.terminal_code) terminal_code,coalesce(pr.provider,ap.provider) provider,ps.gross settlement_gross,ps.fee settlement_fee,exists(select 1 from clinic_finance.bank_rows br where br.line_id=l.id) already_matched
 from clinic_finance.lines l join clinic_finance.entries e on e.id=l.entry_id left join public.admins a on a.id=e.created_by left join clinic_finance.shifts sh on sh.id=e.shift_id left join public.admins ca on ca.id=sh.cashier_id left join clinic_finance.registers r on r.id=sh.register_id left join clinic_finance.payments p on p.id=e.source_id left join clinic_finance.invoices i on i.id=p.invoice_id left join clinic_finance.payment_proofs pr on pr.payment_id=p.id left join clinic_finance.advances ad on ad.id=e.source_id left join clinic_finance.advance_uses au on au.id=e.source_id left join clinic_finance.pos_settlements ps on ps.id=e.source_id left join clinic_finance.advance_proofs ap on ap.advance_id=ad.id where l.account=s.account and e.business_date between s.from_date-7 and s.to_date+7)x),'complete',true);
end $$;
alter function public.clinic_finance_snapshot(date,date,integer) set schema clinic_finance;
alter function clinic_finance.clinic_finance_snapshot(date,date,integer) rename to proof_snapshot_base;
create function public.clinic_finance_snapshot(p_from date,p_to date,p_offset integer default 0) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare v jsonb:=clinic_finance.proof_snapshot_base(p_from,p_to,p_offset);begin
 v:=jsonb_set(v,'{payments}',(select coalesce(jsonb_agg(x||jsonb_build_object('proof',to_jsonb(p))),'[]') from jsonb_array_elements(v->'payments')x left join clinic_finance.payment_proofs p on p.payment_id=(x->>'id')::uuid));return v;end $$;
alter function public.clinic_booking_snapshot(date,date) set schema clinic_finance;
alter function clinic_finance.clinic_booking_snapshot(date,date) rename to proof_booking_base;
create function public.clinic_booking_snapshot(p_from date,p_to date) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$declare v jsonb:=clinic_finance.proof_booking_base(p_from,p_to);begin
 v:=jsonb_set(v,'{advances}',(select coalesce(jsonb_agg(x||jsonb_build_object('proof',to_jsonb(p))),'[]') from jsonb_array_elements(v->'advances')x left join clinic_finance.advance_proofs p on p.advance_id=(x->>'id')::uuid));return v;end $$;
revoke all on function public.clinic_finance_snapshot(date,date,integer),public.clinic_booking_snapshot(date,date) from public,anon;
grant execute on function public.clinic_finance_snapshot(date,date,integer),public.clinic_booking_snapshot(date,date) to authenticated;
revoke all on all functions in schema clinic_finance from public,anon,authenticated;
revoke all on function public.clinic_finance_bank_command(text,jsonb,uuid),public.clinic_finance_reconciliation_report(uuid) from public,anon;
grant execute on function public.clinic_finance_bank_command(text,jsonb,uuid),public.clinic_finance_reconciliation_report(uuid) to authenticated;
commit;
