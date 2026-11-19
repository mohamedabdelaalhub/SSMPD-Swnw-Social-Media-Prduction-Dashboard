-- تراجع «اللي اتعلمته من تعليقاتك» — بيشيل الجداول والدوال الجديدة بس، مابيلمسش جدول comments.
drop function if exists public.content_comment_lesson_skip(uuid[], text);
drop function if exists public.content_comment_lesson_record(uuid[], uuid, text, text, text, text, text);
drop function if exists public.content_comment_lessons_unscanned(integer);
drop function if exists public.content_comment_lesson_set_status(uuid, text);
drop table if exists public.content_comment_lesson_scans;
drop table if exists public.content_comment_lessons;
drop function if exists public.content_comment_lessons_normalize();
