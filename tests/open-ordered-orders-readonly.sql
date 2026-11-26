-- READ-ONLY: live reception orders since 2026-11-01 still «ordered» (never marked «تم التنفيذ», so no doctor fee is posted), for
-- reception to execute (if really done) or cancel. Visit no, dates, service, doctor/provider, visit status. No patient names or phones.
-- Ends with ROLLBACK.
begin read only;
select v.visit_no, v.status visit_status,
       (v.opened_at at time zone 'Africa/Cairo')::date visit_day,
       (o.created_at at time zone 'Africa/Cairo')::date ordered_day,
       s.code service_code, s.name service_name, s.department,
       p.name provider, coalesce(p.doctor_key, '— مش مربوط بكود دكتور —') doctor_key,
       o.quantity, round(o.price * o.quantity * (1 - o.discount / 100), 2) amount
from clinic_reception.orders o
join clinic_reception.workspaces w on w.id = o.workspace_id and w.mode = 'live'
join clinic_reception.visits v on v.id = o.visit_id
join clinic_reception.services s on s.id = o.service_id
join clinic_reception.providers p on p.id = o.provider_id
where o.status = 'ordered' and o.created_at >= timestamptz '2026-11-01 00:00+02'
order by (p.doctor_key is null) desc, p.name, v.visit_no, o.created_at;
rollback;
