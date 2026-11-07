-- تعليقات سيا على مهمة مسندة لـ Claude Creative تتوجّه لـ Claude تلقائيًا (محمد، 2026-11-08)
-- زي ما الموظف بيختار «التعليق لـ: Claude» تحت خانة التعليق: التعليق بيتعلّم «إلى: Claude»،
-- وبيتعمل طلب في claude_task_requests عشان Claude يشوفه في أول تشغيل كل ساعة ويرد في نفس المهمة.
-- منع التكرار: طلب واحد مفتوح بس من سيا لكل مهمة (تذكيرات سيا اليومية مابتعملش طلب جديد كل يوم).
create or replace function public.task_updates_route_sia_to_claude()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_claude uuid; v_sia uuid;
begin
  if new.addressed_to is not null then return new; end if;
  select admin_id into v_sia from public.digital_team_members where code='sia' and active;
  if v_sia is null or new.author_id is distinct from v_sia then return new; end if;
  select admin_id into v_claude from public.digital_team_members where code='claude_creative' and active;
  if v_claude is null then return new; end if;
  if exists(select 1 from public.tasks where id=new.task_id and assignee_id=v_claude) then
    new.addressed_to := v_claude;
  end if;
  return new;
end $$;

create or replace function public.task_updates_sia_claude_request()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_claude uuid; v_sia uuid;
begin
  select admin_id into v_sia from public.digital_team_members where code='sia' and active;
  select admin_id into v_claude from public.digital_team_members where code='claude_creative' and active;
  if v_sia is null or v_claude is null or new.author_id is distinct from v_sia or new.addressed_to is distinct from v_claude then return null; end if;
  if exists(select 1 from public.claude_task_requests r where r.task_id=new.task_id and r.requested_by=v_sia and r.status in ('pending','working')) then return null; end if;
  insert into public.claude_task_requests(task_id, update_id, requested_by, body)
    values (new.task_id, new.id, v_sia, new.body) on conflict (update_id) do nothing;
  return null;
end $$;

revoke all on function public.task_updates_route_sia_to_claude() from public, anon, authenticated;
revoke all on function public.task_updates_sia_claude_request() from public, anon, authenticated;

drop trigger if exists trg_task_updates_route_sia_to_claude on public.task_updates;
create trigger trg_task_updates_route_sia_to_claude before insert on public.task_updates
  for each row execute function public.task_updates_route_sia_to_claude();
drop trigger if exists trg_task_updates_sia_claude_request on public.task_updates;
create trigger trg_task_updates_sia_claude_request after insert on public.task_updates
  for each row execute function public.task_updates_sia_claude_request();
