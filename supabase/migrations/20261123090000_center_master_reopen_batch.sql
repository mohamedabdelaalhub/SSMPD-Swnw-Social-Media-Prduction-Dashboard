-- Center price list: put ONE already-merged batch back to draft so the master path ('prepare') can run.
-- Why: the center list «سونو / دار النقاهة» had one 4-row batch (المسالك) merged on 2026-10-24 through apply_batch.
-- price_master_command('prepare') refuses while any item exists or any batch is not draft, and no RPC could undo it.
-- ADDITIVE ONLY: one new function, nothing existing is altered. Rollback: supabase/rollbacks/20261123090000_center_master_reopen_batch.rollback.sql
-- Rules: center draft list only (not deleted, no contract), caller can edit the list, list + batch revisions must match,
-- no approved master review, reason >= 5 chars. Removes ONLY items whose source_ref.batch_id is that batch, sets the
-- batch back to 'draft', bumps revisions and writes the removed items into clinic_prices.audit.
begin;
create or replace function public.price_master_reopen_batch(p_payload jsonb) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid:=public.my_admin_id();l clinic_prices.lists%rowtype;b clinic_prices.batches%rowtype;
 note text:=btrim(coalesce(p_payload->>'reason',''));removed jsonb;
begin
 if me is null or not clinic_prices.manage() then raise exception 'تحتاج إدارة لوائح الأسعار';end if;
 perform pg_advisory_xact_lock(712241024);
 select * into l from clinic_prices.lists where id=nullif(p_payload->>'list_id','')::uuid for update;
 if not found or l.list_kind<>'center' or l.deleted_at is not null or l.contract_id is not null or l.status<>'draft' then raise exception 'المسار مخصص لمسودة لائحة المركز فقط';end if;
 if not clinic_prices.can_edit(l.id) then raise exception 'التعديل غير مسموح لهذه القائمة';end if;
 if l.revision is distinct from (p_payload->>'list_revision')::integer then raise exception 'اللائحة تغيرت؛ أعد تحميلها';end if;
 if exists(select 1 from clinic_prices.master_reviews where list_id=l.id and status='approved') then raise exception 'المرجع معتمد بالفعل؛ لا يمكن إرجاع دفعة';end if;
 if length(note)<5 then raise exception 'اكتب سبب إرجاع الدفعة';end if;
 select * into b from clinic_prices.batches where id=nullif(p_payload->>'batch_id','')::uuid and list_id=l.id for update;
 if not found or b.status<>'applied' or b.revision is distinct from (p_payload->>'batch_revision')::integer then raise exception 'الدفعة تغيرت أو ليست مضمومة';end if;
 select coalesce(jsonb_agg(jsonb_build_object('item_id',i.id,'service_id',i.service_id,'fixed_price',i.fixed_price,'external_code',i.external_code,'external_name',i.external_name,'source_ref',i.source_ref)),'[]')
   into removed from clinic_prices.items i where i.list_id=l.id and i.source_ref->>'batch_id'=b.id::text;
 delete from clinic_prices.items i where i.list_id=l.id and i.source_ref->>'batch_id'=b.id::text;
 update clinic_prices.batches set status='draft',revision=revision+1 where id=b.id;
 update clinic_prices.lists set revision=revision+1 where id=l.id;
 insert into clinic_prices.audit(actor_id,action,list_id,details) values(me,'master_reopen_batch',l.id,jsonb_build_object('batch_id',b.id,'filename',b.filename,'reason',note,'removed_items',removed));
 return b.id;
end $$;
revoke all on function public.price_master_reopen_batch(jsonb) from public,anon;
grant execute on function public.price_master_reopen_batch(jsonb) to authenticated;
commit;
