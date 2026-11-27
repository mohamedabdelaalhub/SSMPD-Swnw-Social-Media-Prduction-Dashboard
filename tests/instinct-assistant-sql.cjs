// 20261124200000 «مساعد إنستنكت»: drafts by Instinct only, approve/publish by the owner only, staff see published notes of their
// group only, own threads only, Instinct replies, patient-identifier refusals (Arabic + Latin digits), notifications + unread_since,
// append-only audit, hidden staff descriptions, ai_assistant locked out of every other table (restrictive policy) and of
// my_admin_id(), no access flags / extra roles for it, re-run refused, rollback restores everything.
const fs = require('fs'), assert = require('node:assert/strict'), { PGlite } = require('@electric-sql/pglite');
const MIG = fs.readFileSync('supabase/migrations/20261124200000_instinct_assistant.sql', 'utf8');
const RB = fs.readFileSync('supabase/rollbacks/20261124200000_instinct_assistant.rollback.sql', 'utf8');
const U = n => '00000000-0000-0000-0000-' + String(n).padStart(12, '0');
const OWNER = U(1), GM = U(2), RECEP = U(3), DESIGN = U(4), NURSE = U(5), ACC = U(6), AI = U(7), OWNER_U = U(101), GM_U = U(102), RECEP_U = U(103),
  DESIGN_U = U(104), NURSE_U = U(105), ACC_U = U(106), AI_U = U(107);
(async () => {
  const db = new PGlite(), q = (s, p) => db.query(s, p), one = async (s, p) => (await q(s, p)).rows[0];
  const as = async (uid, sql, params) => {
    await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid}', false); set role authenticated;`);
    try { return (await q(sql, params || [])).rows; } finally { await db.exec('reset role'); }
  };
  const val = async (uid, sql, params) => { const r = await as(uid, sql, params); return Object.values(r[0])[0]; };
  const refused = async (uid, sql, params, re) => {
    let err = null; try { await as(uid, sql, params); } catch (e) { err = e; }
    assert.ok(err, 'should be refused: ' + sql); if (re) assert.match(err.message, re, sql);
  };
  try {
    await db.exec(`create role authenticated; create role anon; create role service_role; create schema auth; create schema clinic_finance;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth, clinic_finance to authenticated; grant execute on function auth.uid() to authenticated;
      create table public.admins(id uuid primary key, user_id uuid unique, email text not null unique, name text, role text not null,
        active boolean not null default true, has_archive_access boolean not null default false, can_delete_leads boolean not null default false,
        is_system_identity boolean not null default false,
        constraint admins_role_check check (role = any ('{accountant,approver,customer_service,designer,digital_agent,financial_manager,general_manager,nursing,page_manager,reception,some_live_only_role,super_admin}'::text[])));
      create table public.admin_extra_roles(admin_id uuid references public.admins(id), role text,
        constraint admin_extra_roles_role_check check (role in ('reception','customer_service','designer','accountant')));
      create table public.administrative_assistant_config(id int primary key, owner_admin_id uuid);
      create function public.my_admin_id()
      returns uuid language sql security definer stable set search_path = public as $$
        select id from public.admins where user_id = auth.uid() and active limit 1;
      $$;
      create function public.has_role(p_role text) returns boolean language sql stable security definer set search_path to 'public' as $$
        select exists (select 1 from public.admins where user_id = auth.uid() and active and role = p_role)
            or exists (select 1 from public.admin_extra_roles r join public.admins a on a.id = r.admin_id where a.user_id = auth.uid() and a.active and r.role = p_role) $$;
      create function public.has_any_role(p_roles text[]) returns boolean language sql stable security definer set search_path to 'public' as $$
        select exists (select 1 from public.admins where user_id = auth.uid() and active and role = any(p_roles))
            or exists (select 1 from public.admin_extra_roles r join public.admins a on a.id = r.admin_id where a.user_id = auth.uid() and a.active and r.role = any(p_roles)) $$;
      grant execute on all functions in schema public to authenticated;
      alter table public.admins enable row level security;
      create policy "read all" on public.admins for select to authenticated using (true);
      create policy "update own" on public.admins for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
      grant select, update on public.admins to authenticated;
      alter table public.admin_extra_roles enable row level security;
      create policy "read extra" on public.admin_extra_roles for select to authenticated using (true);
      grant select on public.admin_extra_roles to authenticated;
      -- stand-ins for other modules: any active admin can read them (worst case)
      create table public.patients(id int, name text); insert into public.patients values (1, 'x');
      alter table public.patients enable row level security; create policy "any admin" on public.patients for all to authenticated using (public.my_admin_id() is not null or true);
      grant select, insert on public.patients to authenticated;
      create table clinic_finance.treasury(id int, amount numeric); insert into clinic_finance.treasury values (1, 100);
      alter table clinic_finance.treasury enable row level security; create policy "any" on clinic_finance.treasury for all to authenticated using (true);
      grant select, insert on clinic_finance.treasury to authenticated;
      create function public.clinic_finance_overview() returns jsonb language plpgsql security definer set search_path = public as $$
        begin if public.my_admin_id() is null then raise exception 'سجّل الدخول' using errcode = '42501'; end if; return '{}'::jsonb; end $$;
      grant execute on function public.clinic_finance_overview() to authenticated;
      -- leaks of the kind the live sweep found: unguarded definer functions, a backup table without RLS, a system table
      create function public.lead_capture_gap(p_day date default current_date) returns jsonb language sql stable security definer set search_path = public as $$
        select jsonb_build_object('n', (select count(*) from public.patients)) $$;
      create function public.clinic_reception_message_claim(p_limit integer default 10) returns jsonb language plpgsql security definer set search_path = public as $$
      declare result jsonb;
      begin
        select jsonb_agg(name) into result from public.patients; return result;
      end $$;
      grant execute on function public.lead_capture_gap(date), public.clinic_reception_message_claim(integer) to authenticated;
      create table public.ops_backup_20261120_home(id int, secret text); insert into public.ops_backup_20261120_home values (1, 'x');
      grant select on public.ops_backup_20261120_home to authenticated;
      create schema net; create table net._http_response(id int, content text); insert into net._http_response values (1, 'token');
      grant usage on schema net to authenticated; grant select on net._http_response to authenticated;`);
    await q(`insert into public.admins(id, user_id, email, name, role) values
      ($1,$2,'o@x','المالك','super_admin'), ($3,$4,'g@x','مدير','general_manager'), ($5,$6,'r@x','مازن','reception'),
      ($7,$8,'d@x','مصمم','designer'), ($9,$10,'n@x','ممرضة','nursing'), ($11,$12,'a@x','محاسب','accountant')`,
      [OWNER, OWNER_U, GM, GM_U, RECEP, RECEP_U, DESIGN, DESIGN_U, NURSE, NURSE_U, ACC, ACC_U]);
    await q("update public.admins set has_archive_access = true where id = $1", [RECEP]);
    await q("insert into public.admin_extra_roles values ($1, 'customer_service')", [RECEP]);
    await q("insert into public.administrative_assistant_config values (1, $1)", [OWNER]);
    await assert.rejects(() => q("insert into public.admins(id, email, role) values ($1, 'ai@x', 'ai_assistant')", [AI]), /admins_role_check/);

    // the same parse on the other live forms: IN (...) works; a list that misses a role in use is refused loudly
    for (const [form, ok] of [["role in ('page_manager','designer','approver','general_manager','super_admin','reception','customer_service','nursing','accountant','financial_manager','digital_agent','some_live_only_role')", true],
                              ["role = any (array['reception'::text, 'super_admin'::text])", false]]) {
      await db.exec('begin'); await db.exec(`alter table public.admins drop constraint admins_role_check; alter table public.admins add constraint admins_role_check check (${form}) not valid`);
      if (ok) { await db.exec(MIG.replace(/^begin;$/m, '').replace(/^commit;$/m, ''));
        assert.match((await one("select pg_get_constraintdef(oid) d from pg_constraint where conname = 'admins_role_check'")).d, /accountant.*ai_assistant.*some_live_only_role.*super_admin/); }
      else await assert.rejects(() => db.exec(MIG.replace(/^begin;$/m, '').replace(/^commit;$/m, '')), /admins_role_check parse failed/);
      await db.exec('rollback');
    }
    await db.exec(MIG);
    assert.match((await one("select pg_get_constraintdef(oid) d from pg_constraint where conname = 'admins_role_check'")).d, /accountant.*ai_assistant.*super_admin/, 'array-literal form (live) keeps every role');
    await assert.rejects(() => db.exec(MIG), /تم تطبيق هذا الملف من قبل/); await db.exec('rollback');

    // role check: live-only role kept, ai_assistant accepted; never an extra role, never an access flag
    await q("insert into public.admins(id, email, role) values (gen_random_uuid(), 'l@x', 'some_live_only_role')");
    await q("insert into public.admins(id, user_id, email, name, role) values ($1, $2, 'ai@x', 'إنستنكت', 'ai_assistant')", [AI, AI_U]);
    await assert.rejects(() => q("update public.admins set has_archive_access = true where id = $1", [AI]), /صلاحيات إضافية/);
    await assert.rejects(() => q("insert into public.admin_extra_roles values ($1, 'reception')", [AI]), /أدوار إضافية/);
    await assert.rejects(() => q("insert into public.admin_extra_roles values ($1, 'ai_assistant')", [GM]), /admin_extra_roles_role_check/);
    await assert.rejects(() => q("update public.admins set role = 'ai_assistant' where id = $1", [RECEP]), /صلاحيات إضافية|أدوار إضافية/);

    // lockout: my_admin_id null, other module tables empty and closed for writes, own admins row only
    assert.equal(await val(AI_U, 'select public.my_admin_id() x'), null);
    assert.equal(await val(RECEP_U, 'select public.my_admin_id() x'), RECEP);
    assert.equal(await val(AI_U, 'select count(*)::int from public.patients'), 0);
    assert.equal(await val(AI_U, 'select count(*)::int from clinic_finance.treasury'), 0);
    assert.equal(await val(AI_U, 'select count(*)::int from public.admin_extra_roles'), 0);
    assert.deepEqual((await as(AI_U, 'select id from public.admins')).map(r => r.id), [AI]);
    await refused(AI_U, "insert into public.patients values (2, 'y')", null, /row-level security/);
    await refused(AI_U, "insert into clinic_finance.treasury values (2, 5)", null, /row-level security/);
    await refused(AI_U, 'select public.clinic_finance_overview()', null, /سجّل الدخول/);
    assert.equal(await val(RECEP_U, 'select count(*)::int from public.patients'), 1, 'staff unaffected');
    assert.equal(await val(ACC_U, 'select count(*)::int from clinic_finance.treasury'), 1, 'staff unaffected');
    assert.equal(await val(GM_U, 'select count(*)::int from public.admins'), 8, 'staff see all admins as before');
    // instinct tables: no direct access for anyone
    for (const t of ['instinct_notes', 'instinct_threads', 'instinct_messages', 'instinct_notifications', 'instinct_audit_log'])
      await refused(OWNER_U, `select * from public.${t}`, null, /permission denied/);

    // 2c: guarded functions refuse the AI only; system table revoked; backup table behind RLS
    await refused(AI_U, 'select public.lead_capture_gap()', null, /مالوش صلاحية/);
    await refused(AI_U, 'select public.clinic_reception_message_claim(5)', null, /مالوش صلاحية/);
    assert.equal((await val(RECEP_U, 'select public.lead_capture_gap() x')).n, 1, 'staff unaffected (sql)');
    assert.deepEqual(await val(RECEP_U, 'select public.clinic_reception_message_claim(5) x'), ['x'], 'staff unaffected (plpgsql)');
    await refused(RECEP_U, 'select * from net._http_response', null, /permission denied/);
    assert.equal(await val(RECEP_U, 'select count(*)::int from public.ops_backup_20261120_home'), 0, 'backup: RLS on, no policies');
    assert.equal((await one('select count(*)::int n from public.ops_backup_20261120_home')).n, 1, 'data kept');
    // context per role
    assert.equal((await val(AI_U, 'select public.instinct_context() x')).kind, 'instinct');
    assert.equal((await val(OWNER_U, 'select public.instinct_context() x')).can_decide, true);
    assert.equal((await val(GM_U, 'select public.instinct_context() x')).can_decide, false, 'a super_admin-like manager is not the owner');
    assert.deepEqual((await val(RECEP_U, 'select public.instinct_context() x')).groups, ['reception', 'customer_service']);
    await refused(NURSE_U, 'select public.instinct_context()', null, /مش متاح لحسابك/);

    // drafts: Instinct only
    await refused(RECEP_U, "select public.instinct_note_save(null, 'عنوان', 'نص الملاحظة', 'reception')", null, /لمساعد إنستنكت بس/);
    await refused(OWNER_U, "select public.instinct_note_save(null, 'عنوان', 'نص الملاحظة', 'reception')", null, /لمساعد إنستنكت بس/);
    const n1 = (await val(AI_U, "select public.instinct_note_save(null, 'الحجز السريع', 'افتح الاستقبال ثم حجز جديد', 'reception') x")).id;
    const n2 = (await val(AI_U, "select public.instinct_note_save(null, 'للمحاسبين', 'راجع الخزينة', 'finance') x")).id;
    await refused(AI_U, "select public.instinct_note_save(null, 'رقم', 'كلم ٠١٠١٢٣٤٥٦٧٨', 'all')", null, /رقم موبايل/);
    await refused(AI_U, `select public.instinct_note_save('${n1}', 'الحجز السريع', 'تعديل', 'reception')`, null, /للمالك بس/);
    await val(OWNER_U, `select public.instinct_note_save('${n1}', 'الحجز السريع', 'افتح الاستقبال ثم اضغط حجز جديد', 'reception') x`);
    await refused(GM_U, `select public.instinct_note_save('${n1}', 'x12', 'y12', 'all')`, null, /للمالك بس/);
    // the AI account cannot write admins at all (own profile included)
    await refused(AI_U, "update public.admins set name = 'x' where id = $1", [AI], /row-level security|0 rows/).catch(async () => {
      assert.equal((await one('select name from public.admins where id = $1', [AI])).name, 'إنستنكت', 'own row untouched'); });
    // approve / publish: owner only (not the general manager, not Instinct, not staff)
    for (const u of [AI_U, GM_U, RECEP_U, ACC_U]) await refused(u, `select public.instinct_note_decide('${n1}', 'approve')`, null, /للمالك بس/);
    assert.equal(await val(RECEP_U, 'select jsonb_array_length(public.instinct_notes_list())'), 0, 'drafts are hidden from staff');
    assert.equal((await val(OWNER_U, `select public.instinct_note_decide('${n1}', 'approve') x`)).status, 'approved');
    await refused(OWNER_U, `select public.instinct_note_save('${n1}', 'a12', 'b12', 'all')`, null, /اتعتمدت/);
    assert.equal(await val(RECEP_U, 'select jsonb_array_length(public.instinct_notes_list())'), 0, 'approved but unpublished: hidden');
    assert.equal((await val(OWNER_U, `select public.instinct_note_decide('${n1}', 'publish') x`)).status, 'published');
    assert.equal((await val(OWNER_U, `select public.instinct_note_decide('${n2}', 'publish') x`)).status, 'published');
    assert.deepEqual((await val(RECEP_U, 'select public.instinct_notes_list() x')).map(n => n.id), [n1], 'reception: its group only');
    assert.deepEqual((await val(ACC_U, 'select public.instinct_notes_list() x')).map(n => n.id), [n2]);
    assert.equal(await val(DESIGN_U, 'select jsonb_array_length(public.instinct_notes_list())'), 0);
    assert.equal(await val(AI_U, 'select jsonb_array_length(public.instinct_notes_list())'), 2, 'Instinct reads published notes');

    // questions: patient identifiers refused (Latin / Arabic digits, spaced, codes, national id)
    for (const bad of ['المريض رقمه 01012345678', 'الرقم ٠١١ ٢٣٤٥ ٦٧٨٩', '+20 100 123 4567', 'ملف P-2026-000123', 'كود p 2026 123456',
      'رقم قومي 29001011234567', 'ملف المريض 55555'])
      await refused(RECEP_U, 'select public.instinct_ask(null, $1)', [bad], /ممنوع كتابة/);
    const t1 = (await val(RECEP_U, "select public.instinct_ask(null, 'إزاي أعمل حجز لمريض جديد؟') x")).thread_id;
    await val(RECEP_U, `select public.instinct_ask('${t1}', 'وكمان إزاي ألغيه؟') x`);
    const t2 = (await val(ACC_U, "select public.instinct_ask(null, 'إزاي أقفل الوردية؟') x")).thread_id;
    await refused(ACC_U, `select public.instinct_ask('${t1}', 'سؤال')`, null, /مش بتاعتك/);
    await refused(ACC_U, `select public.instinct_thread('${t1}')`, null, /مش بتاعتك/);
    await refused(AI_U, "select public.instinct_ask(null, 'سؤال')", null, /مش بيسأل/);
    assert.deepEqual((await val(RECEP_U, 'select public.instinct_threads_list() x')).map(t => t.id), [t1], 'own threads only');
    assert.equal(await val(OWNER_U, 'select jsonb_array_length(public.instinct_threads_list())'), 2, 'owner sees all');
    assert.equal(await val(AI_U, 'select jsonb_array_length(public.instinct_threads_list())'), 2, 'Instinct sees all');
    // replies: Instinct only
    for (const u of [OWNER_U, RECEP_U]) await refused(u, `select public.instinct_reply('${t1}', 'رد')`, null, /لمساعد إنستنكت بس/);
    await refused(AI_U, `select public.instinct_reply('${t1}', 'كلم 01212345678')`, null, /رقم موبايل/);
    await val(AI_U, `select public.instinct_reply('${t1}', 'افتح الاستقبال والخدمات ثم حجز جديد') x`);
    const th = await val(RECEP_U, `select public.instinct_thread('${t1}') x`);
    assert.deepEqual(th.messages.map(m => m.author_kind), ['staff', 'staff', 'instinct']);
    // owner hides the reply: gone for staff, still visible (flagged) to owner + Instinct; logged
    const rid = th.messages[2].id;
    for (const u of [AI_U, RECEP_U, GM_U]) await refused(u, `select public.instinct_message_hide('${rid}', true)`, null, /للمالك بس/);
    await val(OWNER_U, `select public.instinct_message_hide('${rid}', true) x`);
    assert.equal((await val(RECEP_U, `select public.instinct_thread('${t1}') x`)).messages.length, 2);
    assert.equal((await val(OWNER_U, `select public.instinct_thread('${t1}') x`)).messages[2].hidden, true);
    await val(OWNER_U, `select public.instinct_message_hide('${rid}', false) x`);
    assert.equal((await val(RECEP_U, `select public.instinct_thread('${t1}') x`)).messages.length, 3);
    assert.equal((await val(RECEP_U, 'select public.instinct_threads_list() x'))[0].answered, true);

    // notifications: owner (new draft x2, new question x3), Instinct (questions x3), reception (reply)
    const on = await val(OWNER_U, 'select public.instinct_notifications_list() x');
    assert.deepEqual(on.map(n => n.kind).sort(), ['new_draft', 'new_draft', 'new_question', 'new_question', 'new_question']);
    assert.equal((await val(AI_U, 'select public.instinct_notifications_list() x')).length, 3);
    assert.equal((await val(RECEP_U, 'select public.instinct_notifications_list() x'))[0].kind, 'reply');
    assert.equal(await val(RECEP_U, 'select public.instinct_notifications_read(null) x'), 1);
    assert.equal((await val(RECEP_U, 'select public.instinct_context() x')).unread, 0);
    // unread since (Phase 2 polling)
    const us = await val(AI_U, "select public.instinct_unread_since(now() - interval '1 hour') x");
    assert.equal(us.new_questions.length, 3); assert.equal(us.status_changes.length, 2);
    assert.equal((await val(AI_U, "select public.instinct_unread_since(now() + interval '1 hour') x")).new_questions.length, 0);
    await refused(RECEP_U, 'select public.instinct_unread_since(null)', null, /للمالك ومساعد إنستنكت بس/);

    // e-mail outbox: one line per question / draft, no message text; browser cannot touch it; service_role leases + acks
    const ob = (await q('select kind, employee_name, role_label, link, to_jsonb(o)::text j from public.instinct_notify_outbox o order by created_at')).rows;
    assert.deepEqual(ob.map(r => r.kind).sort(), ['new_draft', 'new_draft', 'new_question', 'new_question', 'new_question']);
    assert.ok(ob.every(r => !r.j.includes('إزاي') && !r.j.includes('الخزينة')), 'no message text in the outbox');
    assert.ok(ob.some(r => r.employee_name === 'مازن' && /استقبال/.test(r.role_label) && r.link.endsWith('#instinct')));
    for (const u of [OWNER_U, AI_U]) await refused(u, 'select public.instinct_outbox_lease(10, 60)', null, /permission denied/);
    await db.exec('set role service_role');
    const lease = (await q('select public.instinct_outbox_lease(3, 60) x')).rows[0].x;
    assert.equal(lease.items.length, 3);
    assert.equal((await q('select public.instinct_outbox_ack($1, $2, true) x', [lease.lease_token, lease.items.map(i => i.id)])).rows[0].x, 3);
    assert.equal((await q('select public.instinct_outbox_lease(10, 60) x')).rows[0].x.items.length, 2, 'only the unsent ones');
    await db.exec('reset role');
    // rate limit: 60 replies / hour
    await q("insert into public.instinct_audit_log(actor_id, actor_kind, action, entity_type, entity_id) select $1, 'instinct', 'reply', 'thread', $2 from generate_series(1, 60)", [AI, t1]);
    await refused(AI_U, `select public.instinct_reply('${t2}', 'رد')`, null, /حد المسموح في الساعة/);
    // hidden staff descriptions: owner + Instinct only; no contact data
    const prof = await val(AI_U, 'select public.instinct_staff_profiles() x');
    const mazen = prof.find(p => p.admin_id === RECEP);
    assert.match(mazen.description, /استقبال/); assert.match(mazen.description, /خدمة عملاء/); assert.match(mazen.description, /أرشيف المرضى/);
    assert.ok(!prof.some(p => p.admin_id === AI)); assert.ok(!JSON.stringify(prof).includes('@x'), 'no emails');
    await refused(RECEP_U, 'select public.instinct_staff_profiles()', null, /للمالك ومساعد إنستنكت بس/);
    await refused(GM_U, 'select public.instinct_staff_profiles()', null, /للمالك ومساعد إنستنكت بس/);

    // audit: every step recorded, append-only for everyone (even the table owner)
    const audit = await val(OWNER_U, 'select public.instinct_audit_list(100) x');
    assert.deepEqual([...new Set(audit.map(a => a.action))].sort(), ['note_approve', 'note_create', 'note_edit', 'note_publish', 'question', 'reply', 'reply_hide', 'reply_unhide']);
    await refused(AI_U, 'select public.instinct_audit_list(10)', null, /للمالك بس/);
    await assert.rejects(() => q('update public.instinct_audit_log set action = action'), /للإضافة فقط/);
    await assert.rejects(() => q('delete from public.instinct_audit_log'), /للإضافة فقط/);
    await assert.rejects(() => q('truncate public.instinct_audit_log'), /للإضافة فقط/);
    // kill switch: owner only, logged; an inactive AI account is shut out of everything
    assert.deepEqual((await val(OWNER_U, 'select public.instinct_context() x')).ai_accounts.map(a => a.active), [true]);
    for (const u of [GM_U, AI_U, RECEP_U]) await refused(u, `select public.instinct_set_ai_active('${AI}', false)`, null, /للمالك بس/);
    await refused(OWNER_U, `select public.instinct_set_ai_active('${RECEP}', false)`, null, /مش حساب مساعد إنستنكت/);
    await val(OWNER_U, `select public.instinct_set_ai_active('${AI}', false) x`);
    await refused(AI_U, 'select public.instinct_context()', null, /سجّل الدخول/);
    await refused(AI_U, `select public.instinct_reply('${t1}', 'رد')`, null, /لمساعد إنستنكت بس/);
    assert.ok((await val(OWNER_U, 'select public.instinct_audit_list(10) x')).some(a => a.action === 'ai_disable'));
    assert.equal(await val(AI_U, 'select count(*)::int from public.patients'), 0);

    // rollback: refused while an ai_assistant exists; then everything back
    await assert.rejects(() => db.exec(RB), /ai_assistant/); await db.exec('rollback');
    await q("update public.admins set role = 'designer' where id = $1", [AI]);
    await db.exec(RB);
    await assert.rejects(() => q("update public.admins set role = 'ai_assistant' where id = $1", [AI]), /admins_role_check/);
    assert.equal((await one("select count(*)::int n from pg_policy where polname = 'instinct_ai_block'")).n, 0);
    assert.equal((await one("select count(*)::int n from pg_proc where proname like 'instinct\\_%'")).n, 0);
    assert.ok(!(await one("select prosrc from pg_proc where proname = 'my_admin_id'")).prosrc.includes('ai_assistant'));
    assert.ok(!(await one("select prosrc from pg_proc where proname = 'lead_capture_gap'")).prosrc.includes('instinct'), 'functions restored');
    assert.ok(!(await one("select prosrc from pg_proc where proname = 'clinic_reception_message_claim'")).prosrc.includes('instinct'));
    assert.equal((await one("select has_table_privilege('authenticated', 'net._http_response', 'SELECT') x")).x, true, 'grant restored');
    assert.equal((await one("select relrowsecurity x from pg_class where relname = 'ops_backup_20261120_home'")).x, false, 'RLS restored');
    await q("insert into public.admins(id, email, role) values (gen_random_uuid(), 'l2@x', 'some_live_only_role')");
    console.log('instinct assistant sql: ok');
  } catch (e) { console.error(e); process.exitCode = 1; } finally { await db.close(); }
})();
