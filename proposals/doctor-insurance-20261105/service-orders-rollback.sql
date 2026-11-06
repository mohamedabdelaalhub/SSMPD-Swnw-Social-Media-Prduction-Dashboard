-- Rollback for service-orders-migration.sql (drops ONLY objects it created).
begin;
drop trigger if exists order_ext_status_guard on clinic_reception.order_ext;
drop function if exists clinic_reception.order_ext_status_guard();
drop table if exists clinic_reception.order_status_log;
drop table if exists clinic_reception.order_ext;
drop table if exists clinic_reception.provider_cost_list;
drop table if exists clinic_reception.external_providers;
drop table if exists clinic_reception.referral_rates;
drop table if exists clinic_reception.service_performers;
drop table if exists clinic_reception.service_specialties;
commit;
