# Handoff: «مركز التدريب والتقييم 1» → «مركز التدريب والتقييم 2»

Written 2026-11-19 by session `session_01UqVZHZwfhSJK8H5SXUQBHh` (context limit reached). Talk to the owner in Egyptian
Arabic only. All training UI text is Modern Standard Arabic (فصحى), owner's decision.

## 1. Index
1. Index · 2. Where things are · 3. Owner decisions · 4. PR status · 5. Open items · 6. PR4 design (next) ·
7. PR6 design · 8. How to test locally · 9. Rules learned

## 2. Where things are
- Spec (owner artifact): https://claude.ai/artifact/92LrYYbDKWhvZwMJRcx1E5
- Manager exam bank (50 q, has key, LOADED on live): artifact 3A2GETCNMF48KLJi871BpP
- Job-tracks bank swnw-jobs-bank-4 (63 q + 11 lessons, has key, LOADED on live): artifact LM59qgmkDpUCoKmhUhsPFK
- Candidate terms + privacy policy DRAFT (MSA, for lawyer review): artifact 44KCqQyvvYzZKt1CFys9Qr
- Interview content in MSA (20 q + 3 role-plays, reviewer-only): NOT yet published. It was generated from artifact
  979XVrb2dssrDY88rRt2zQ (Egyptian original). Regenerate if needed (shape in §5).
- Course (8 modules, MSA, public static): `assets/js/training-course-data.js`
- UI: `assets/js/training-evaluation.js`, `assets/css/training-evaluation.css`
- DB: schema `training` (private; RLS on, no policies, direct access revoked; only SECURITY DEFINER RPCs).
- Content partner chat: «كورس الإدارة 2» `session_01UqVZHXuYdzL3n8jhntbBNP` (content review only; legal text is the owner's).
- Main chat now: `session_01UqVZHVjijrt8v6jYB8JQSB` (batch one message per milestone).

The repo is PUBLIC: never commit any answer key, interview guide or role-play script. They are loaded on the server by
the main chat via owner-only import RPCs from owner-only artifacts.

## 3. Owner decisions (all confirmed by the owner in this chat)
- Owner = super_admin is the only one who approves final decisions.
- Employee sees grade label + weak points + owner message, NOT the number. Retake only via a new assignment, ≥ 30 days later.
- Candidate data kept 5 years, then a minimal record (name, phone, date, outcome) so re-applicants are recognised.
  Deletion only on request (owner-triggered, logged). Consent to usage+privacy terms before anything, store text version + time.
- Candidate exam link: personal, one-time; binds to the FIRST device that opens it; resume only from that device
  (closing the page never submits; timer keeps running); closes on submit; default validity 7 days, owner can change per invite.
- Result link: separate, view-once, PDF/image download, owner can reissue. Candidate sees grade label + owner message only.
- v1 delivery = owner copies the link or uses a WhatsApp prefill (wa.me). Never call that «sending». Keep a
  `send_channel` field ('manual' now, 'email' later). No email provider exists; adding one needs owner approval + main chat.
- Exam-only grade: strong ≥80% & 0 risk flags; medium ≥60% & ≤1 flag (includes ≥80% with exactly 1 flag); else weak.
- Final decision: ready ≥80 & no blocking & <2 exam risk flags; ready_after_training 60–79.9 or ≥80 with ≥2 flags;
  not_ready <60 or any blocking flag.

## 4. PR status
| PR | What | Migration | Help | State |
|---|---|---|---|---|
| #599 | schema, assignments | 20261119100000 | — | live |
| #601 | course + server-timed exam | 20261119110000 | -52 | live (merged with #602 as 0a99f82) |
| #602 | grading + result view | 20261119120000 | -57 | live |
| #604 | owner bank pages + job bank tables | 20261119125000 | -60 | live, job bank loaded |
| #609 | interview, role-plays, 40/40/20 decision + «محتوى الدورة» preview | 20261119140000 | -63 | OPEN, head 748d1af, waiting «انشر 609» |
| PR4 | candidate one-time link | 20261119130000 (reserved) | -79 | NOT STARTED |
| PR6 | final report + «نتيجتي» + appeal | 20261119150000 (reserved) | ask | NOT STARTED |

Stamps used: `training-center-20261119-N` (last N = 10 on #609). Use a new N for each PR.

## 5. Open items
1. «انشر 609» from the owner → send main chat: PR, head, owner event uuid (list_events kinds=user on this session).
2. Interview content must be published as an owner-only artifact and loaded with
   `public.training_import_interview(json)`. My publish attempts hung on an approval prompt. JSON shape:
   `{version, scale:[{score,label,description}], competency_levels:[{competency, levels:{1..5}}],
     questions:[{id:"iq1".., axis, competency_code(ROLE|OPS|PX|HR|LEAD|ETHICS|KPI|CRISIS), text, listen_for[], red_flags[], follow_up}],
     roleplays:[{id:"rp1".., title, competency_code, candidate_card, reviewer_script, checklist[], red_flags[]}]}`
   Mapping from the source: iq1-2 ROLE, iq3-5 OPS, iq6-7 PX, iq8-10 HR, iq11-13 LEAD, iq14-17 ETHICS, iq18 KPI, iq19-20 CRISIS;
   rp1 موظف يشتكي LEAD, rp2 مريض متعصب PX, rp3 فرق في الخزنة ETHICS.
3. GAHAR edition unverified (no host access). Course/bank cite it generically until the owner confirms the PDF cover.
4. Privacy text needs the owner to fill [ ] placeholders and lawyer review; versioned so it can change later.

## 6. PR4 design (candidate one-time link)
- Separate public edge function `training-candidate` (main chat deploys; NOT the claude-automation gateway). Public, no JWT,
  accepts only the one-time token, rate-limit per token/IP, exposes only token-scoped RPCs.
- Tables: `training.candidates` (name, email, phone, experience, qualifications, link, consent_text_version, consent_at,
  purge_after = +5y, minimal_after_purge), `training.candidate_invites` (token_hash sha256, assignment_id, expires_at,
  device_hash bound on first open, status, opened_at, closed_at), `training.candidate_documents` (private storage only),
  `training.result_links` (token_hash, view-once, viewed_at, send_channel 'manual').
- `training.assignments`: allow candidate assignments: add `candidate_id`, make `trainee_admin_id` nullable with a CHECK
  (exactly one of trainee/candidate). Existing RPCs filter by trainee_admin_id: keep them correct.
- Candidate flow: open link → bind device → consent → profile (+ optional docs) → exam (reuse PR2 draw/save/submit logic
  through token-scoped wrappers) → submit closes the link. Candidate never sees a score.
- Owner UI: «دعوة مرشح» (name/phone/email, track, reviewer, validity days, default 7) → shows link + «نسخ اللينك» +
  «ابعت واتساب» (wa.me prefill; label it as preparing a message). Candidate profile view for owner/reviewer, owner notes,
  delete-on-request, re-applicant badge by normalized phone.
- Public candidate page: a separate static page (e.g. `candidate.html`) that talks only to the edge function.

## 7. PR6 design
- Trainee «نتيجتي»: after `decided`, grade label + weak competencies (learning phrasing) + owner message; no number;
  «طلب مراجعة النتيجة» with reason → owner sees requests.
- Candidate result link (view-once, PDF/image download via browser print/canvas), reissue by owner.
- Final report for the owner (per assignment summary, printable). Printing must use `assets/js/swnw-print.js` per CLAUDE.md rule 7 if it is a document.

## 8. How to test locally (no live DB access from this chat)
- Postgres 16 is installed: `initdb` into /var/tmp (scratchpad is not writable by the postgres user), port 5499.
- Stub `auth.users`, `auth.uid()` (from `request.jwt.claim.sub`), `public.admins`, `public.is_super()`,
  `public.my_admin_id()`, roles anon/authenticated; then apply the training migrations in order and run
  `tests/training-center-*-rollback.sql` (each is synthetic and rolls back; they also run on live as dry-runs).
- UI: `npm install --no-save jsdom` then `node tests/training-evaluation-ui.cjs`, help checks
  (`python3 scripts/build-dashboard-help.py --check`, `tests/dashboard-help-*.cjs`) and `node test/smoke.js`.
- Help conflicts after merging main: `docs/handoffs/training-resolve-help-conflicts.py <stamp> <help-version>`.

## 9. Rules learned
- Every user-visible change: help article (`training-center`) + `version` + `?v=` stamps; new form labels need `frule(TE, …)`
  entries in `scripts/build-dashboard-help.py` or `--check` fails.
- Use the site's `.btn.btn-primary`, not `.btn.primary`.
- jsonb object keys lose order (sort explicitly). PL/pgSQL: avoid variable names equal to column names.
- Send the owner screenshots (Playwright, scratchpad) before asking «انشر N».
