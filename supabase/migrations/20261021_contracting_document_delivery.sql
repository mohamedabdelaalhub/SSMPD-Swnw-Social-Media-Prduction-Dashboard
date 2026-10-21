-- Immutable PDF snapshots for partnership proposals and final contracts.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contracting-documents', 'contracting-documents', false, 20971520, array['application/pdf']::text[])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
