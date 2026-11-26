-- READ-ONLY diagnostic (follow-up to doctors-without-contract-readonly.sql returning 0 rows): how reception orders since 2026-11-01
-- look per workspace mode and status, whether their provider carries a doctor_key, and how many finance contracts exist.
-- Counts only — no names, no patient data. Ends with ROLLBACK.
begin read only;
select 'orders' what, w.mode, o.status, (p.doctor_key is not null) has_doctor_key, count(*) n, count(distinct p.id) providers,
       min((coalesce(o.completed_at, o.created_at) at time zone 'Africa/Cairo')::date) first_day, max((coalesce(o.completed_at, o.created_at) at time zone 'Africa/Cairo')::date) last_day
from clinic_reception.orders o join clinic_reception.workspaces w on w.id = o.workspace_id join clinic_reception.providers p on p.id = o.provider_id
where o.created_at >= timestamptz '2026-11-01 00:00+02'
group by w.mode, o.status, (p.doctor_key is not null) order by 2, 3, 4;
select 'visits' what, w.mode, v.status, count(*) n from clinic_reception.visits v join clinic_reception.workspaces w on w.id = v.workspace_id
where v.opened_at >= timestamptz '2026-11-01 00:00+02' group by w.mode, v.status order by 2, 3;
select 'finance_contracts' what, status, count(*) n, count(distinct doctor_key) doctors from clinic_finance.doctor_contracts group by status order by 2;
select 'finance_invoices_with_doctor' what, count(distinct a.invoice_id) invoices, count(distinct a.doctor_key) doctors
from clinic_finance.doctor_allocations a join clinic_finance.invoices i on i.id = a.invoice_id where i.created_at >= timestamptz '2026-11-01 00:00+02';
select 'reception_agreements' what, count(*) n, count(distinct provider_id) providers from clinic_reception.doctor_agreements;
rollback;
