-- READ ONLY. For «مهمة خارجية» (mig 20261126150000): dump the LIVE definitions the patch has to match (the repo holds only
-- in-place patched fragments of several of them). No data rows, no patient or salary values: definitions and catalog only.
-- Run as a whole: BEGIN READ ONLY … ROLLBACK. Paste the full output to claude/price-matcher-output as relay/36-hr-mission-defs.out
begin read only;
\pset format unaligned
\pset tuples_only on
\pset fieldsep '\t'
-- 1. every function in clinic_people + the public HR / attendance / payroll / presence / review-inbox RPCs
select '### FUNC '||p.oid::regprocedure::text||E'\n'||pg_get_functiondef(p.oid)||E'\n### END'
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where p.prokind='f' and (n.nspname='clinic_people'
   or (n.nspname='public' and (p.proname like 'hr\_%' or p.proname ~ '(attendance|payroll|presence|review_inbox|coverage|minimum|staffing|shift)')))
order by n.nspname,p.proname,p.oid;
-- 2. clinic_people tables: columns, constraints, indexes, triggers
select '### COLS '||c.table_name||E'\t'||string_agg(c.column_name||' '||c.data_type||coalesce(' default '||c.column_default,'')||case when c.is_nullable='NO' then ' not null' else '' end,', ' order by c.ordinal_position)
from information_schema.columns c where c.table_schema='clinic_people' group by c.table_name order by c.table_name;
select '### CONS '||conrelid::regclass::text||E'\t'||conname||E'\t'||pg_get_constraintdef(oid)
from pg_constraint where connamespace='clinic_people'::regnamespace order by conrelid::regclass::text,conname;
select '### IDX '||indexrelid::regclass::text||E'\t'||pg_get_indexdef(indexrelid)
from pg_index i join pg_class c on c.oid=i.indrelid where c.relnamespace='clinic_people'::regnamespace order by 1;
select '### TRG '||tgrelid::regclass::text||E'\t'||tgname||E'\t'||pg_get_triggerdef(oid)
from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace='clinic_people'::regnamespace) order by 1;
-- 3. shape only: request kinds/status in use and how many people have a manager (counts, no names)
select '### KINDS '||kind||E'\t'||status||E'\t'||count(*) from clinic_people.requests group by kind,status order by 1;
select '### MANAGERS people_with_manager='||count(*) filter (where manager_id is not null)||' managers='||count(distinct manager_id)||' active='||count(*) filter (where status<>'ended')
from clinic_people.people;
rollback;
