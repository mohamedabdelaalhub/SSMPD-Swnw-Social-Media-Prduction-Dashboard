-- Rollback of 20261123090000_center_master_reopen_batch.sql (safe to run twice).
-- Removes the function only. A batch already reopened stays draft; its removed items are kept in clinic_prices.audit
-- (action 'master_reopen_batch', details.removed_items) and come back through the normal master 'prepare'/'review'.
begin;
drop function if exists public.price_master_reopen_batch(jsonb);
commit;
