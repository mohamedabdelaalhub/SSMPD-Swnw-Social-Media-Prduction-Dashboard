-- Rollback of 20261119030000 (numbers already printed stay on paper; columns are kept renamed, never dropped with data).
begin;
drop function if exists public.clinic_reception_shared_records(text,uuid,date,date,integer);
alter function clinic_reception.shared_before_invoice_numbers(text,uuid,date,date,integer) set schema public;
alter function public.shared_before_invoice_numbers(text,uuid,date,date,integer) rename to clinic_reception_shared_records;
grant execute on function public.clinic_reception_shared_records(text,uuid,date,date,integer) to authenticated;
drop trigger if exists payment_numbering on clinic_reception.payments;
drop trigger if exists payment_proof_used on clinic_reception.payments;
drop function if exists clinic_reception.payment_proof_used();
drop function if exists clinic_reception.payment_numbering();
drop function if exists public.clinic_reception_invoice_print(uuid, uuid);
drop function if exists public.clinic_reception_payment_proof(uuid, text, text);
drop policy if exists payment_proofs_insert on storage.objects;
drop policy if exists payment_proofs_select on storage.objects;
drop function if exists public.payment_proof_allowed(text, boolean);
alter table clinic_reception.payment_proofs rename to payment_proofs_rolled_back;
alter table clinic_reception.doc_counters rename to doc_counters_rolled_back;
drop function if exists clinic_reception.next_doc_no(text);
commit;
