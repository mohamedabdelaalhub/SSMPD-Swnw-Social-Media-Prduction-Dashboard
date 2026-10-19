begin;
-- Codes are proposed on the client, but allocated again under the ledger's transaction lock.
create function clinic_finance.next_chart_code(p_parent text) returns text language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare prefix text:=coalesce(p_parent,'');candidate text;i integer;
begin
 if length(prefix)>10 then raise exception 'كود الأب طويل؛ لا توجد مساحة لكود فرعي من 12 رقمًا';end if;
 for i in 1..9999 loop
 candidate:=prefix||lpad(i::text,greatest(2,length(i::text)),'0');
 if length(candidate)>12 then exit;end if;
 if not exists(select 1 from clinic_finance.accounts where code=candidate) then return candidate;end if;
 end loop;
 raise exception 'لا يوجد كود فرعي متاح لهذا الأب';
end $$;
alter function public.clinic_finance_ledger_command(text,jsonb,uuid) set schema clinic_finance;
alter function clinic_finance.clinic_finance_ledger_command(text,jsonb,uuid) rename to chart_numbering_base;
create function public.clinic_finance_ledger_command(p_action text,p_payload jsonb,p_token uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare me uuid;op clinic_finance.journal_operations%rowtype;parent text:=nullif(p_payload->>'parent_code','');c clinic_finance.account_config%rowtype;a clinic_finance.accounts%rowtype;group_code text;v jsonb;payload jsonb;created_group text;
begin
 if p_action<>'account_child' and not(p_action='account_create' and coalesce((p_payload->>'auto_code')::boolean,false)) then return clinic_finance.chart_numbering_base(p_action,p_payload,p_token);end if;
 me:=clinic_finance.require_access('review');perform clinic_finance.lock_day();
 if p_token is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'بيانات أو مفتاح العملية غير صالح';end if;
 perform pg_advisory_xact_lock(927311);
 select * into op from clinic_finance.journal_operations where actor=me and token=p_token;
 if found then if op.action<>'chart_numbered_create' or op.payload<>p_payload then raise exception 'مفتاح مستخدم لبيانات أخرى';end if;return op.result;end if;
 if p_action='account_child' and parent is null then raise exception 'اختر الحساب الأب';end if;
 if parent is not null then
 select * into c from clinic_finance.account_config where code=parent for update;
 if not found or not c.active or c.archived then raise exception 'اختر حسابًا أبًا مفعّلًا';end if;
 select * into a from clinic_finance.accounts where code=parent;
 if a.kind is distinct from p_payload->>'kind' then raise exception 'نوع الحساب الفرعي يجب أن يطابق الأب';end if;
 if clinic_finance.account_level(parent)>=5 then raise exception 'الحساب في المستوى الخامس؛ أضف الفرع من حساب التجميع الأعلى';end if;
 if c.is_postable then
 if c.is_system or clinic_finance.account_in_use(parent) or exists(select 1 from clinic_finance.registers where account_code=parent) then
 -- Create a containing group beside the original position. Original posting code and all lines stay intact.
 group_code:=clinic_finance.next_chart_code(c.parent_code);
 perform clinic_finance.chart_numbering_base('account_create',jsonb_build_object('code',group_code,'name',left(a.name,102)||' — حسابات فرعية','kind',a.kind,'parent_code',c.parent_code,'is_postable',false,'active',true),gen_random_uuid());
 perform clinic_finance.chart_numbering_base('account_update',jsonb_build_object('code',a.code,'name',a.name,'kind',a.kind,'parent_code',group_code,'revision',c.revision,'is_postable',true,'active',true),gen_random_uuid());
 parent:=group_code;created_group:=group_code;
 else
 perform clinic_finance.chart_numbering_base('account_update',jsonb_build_object('code',a.code,'name',a.name,'kind',a.kind,'parent_code',c.parent_code,'revision',c.revision,'is_postable',false,'active',true),gen_random_uuid());
 end if;
 end if;
 end if;
 payload:=p_payload-'auto_code';payload:=payload||jsonb_build_object('parent_code',parent);
 if coalesce((p_payload->>'auto_code')::boolean,false) then payload:=payload||jsonb_build_object('code',clinic_finance.next_chart_code(parent));end if;
 v:=clinic_finance.chart_numbering_base('account_create',payload,gen_random_uuid());
 v:=v||jsonb_build_object('code',payload->>'code','parent_code',parent,'group_code',created_group);
 insert into clinic_finance.journal_operations(actor,token,action,payload,result) values(me,p_token,'chart_numbered_create',p_payload,v);
 return v;
end $$;
revoke all on function clinic_finance.next_chart_code(text),clinic_finance.chart_numbering_base(text,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.clinic_finance_ledger_command(text,jsonb,uuid) from public,anon;
grant execute on function public.clinic_finance_ledger_command(text,jsonb,uuid) to authenticated;
commit;
