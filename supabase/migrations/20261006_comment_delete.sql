-- Allow an active comment author or content administrator to delete a comment.
-- No comments or other data are removed by this migration.
do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'comments' and policyname = 'comment author or management delete'
  ) then
    create policy "comment author or management delete"
      on public.comments for delete to authenticated
      using (
        public.my_admin_id() is not null
        and (author_id = public.my_admin_id() or public.can_manage_all_content())
      );
  end if;
end
$$;
