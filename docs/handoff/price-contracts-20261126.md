# Handoff — «ربط أسعار التعاقدات» → «ربط أسعار التعاقدات 2» (2026-11-26)

## Contents
1. [Scope](#1-scope)
2. [Owner rules (binding)](#2-owner-rules-binding)
3. [Open PRs and unmerged branches](#3-open-prs-and-unmerged-branches)
4. [Allocations held](#4-allocations-held)
5. [Owner decisions, last 3 days](#5-owner-decisions-last-3-days)
6. [Pending owner questions](#6-pending-owner-questions)
7. [Live facts relied on](#7-live-facts-relied-on)
8. [Traps and lessons](#8-traps-and-lessons)
9. [Exact next steps](#9-exact-next-steps)

---

## 1. Scope
Linking uploaded insurer and union price lists to the center's services, plus everything that hangs off center prices:
- **Center anchor.** The center list «قائمة أسعار سونو / دار النقاهة» is the anchor (`list_kind='center'`, ACTIVE, 1,363 items, approved by Dr Dina). Every insurer or union row links to a center service. This is the same model as the lab services.
- **Insurer/union matching.**
  - Read-only matcher scripts: `tests/price-matching/01…28` on `claude/contract-price-auto-matcher`.
  - The owner review screen «مراجعة أسماء الجهات»: `assets/js/price-name-review.js` (PR #797, live), help 228.
- **Offers.** Offer price lists (mig 160000, help 229) and «خصم واحد بس» (mig 190000, PR #806).
- **Fixed-price packages.** Mig 20261125120000, editor UI, help 263 (PR #848, merged).
- **Claims service names.** entity / center / both: PR #879, mig 20261126080000, help 289.
- **Reception search by both names.** This is Part A, built by the **reception chat** (mig 20261126090000, help 290). The spec was sent through main chat 5. Required snapshot keys: `entity_service_name` / `entity_service_code` in `clinic_reception.order_quotes.snapshot`.
- **Not mine:**
  - the reception discount flow (B2), the doctor departments and the package «من الباكج» partial draw (#850): reception chat;
  - finance screens: finance chat.

## 2. Owner rules (binding)
- **Language:** reply to the owner (Mohamed) **in Egyptian Arabic only**, never English. Code, commits, PRs and messages to other chats may be English.
- **Approvals:** the owner is the only approver. **«انشر N» / «طبق …» must be typed by the owner in the MAIN chat** (main chat 5, `session_01UqVZHZzCVF6etDBvPkF2nc`). An approval relayed through this chat does not count.
- **Live access:** never write live data yourself.
  - Live DB writes, dry-runs, merges and releases are done by the main chat.
  - This container cannot reach `api.swnwclinics.com` (proxy 403).
  - The main chat posts outputs to branch `claude/price-matcher-output` (`relay/…`).
  - Do not use Supabase MCP for dashboard tables.
- **Models:** the main chat assigns models. Never change your model unless the main chat agrees.
- **Numbers:** migration and help numbers come only from the main chat.
- **CLAUDE.md:**
  - rule 6: a help article plus version bump for any user-visible change;
  - rule 8: English digits 0-9;
  - rule 9: every button tested with the real role on live (as-role rollback test) plus a table in the PR;
  - bump the `?v=` cache-buster;
  - don't rewrite `config.js`;
  - rule 7: no center name in document titles. The claim print test asserts there is no «سونو» in document text.
- **Mockups:** mockup first (`docs/ui-references/mockups/`). Build only after the owner types «طبقه». Check the layout with `docs/ui-references/tools/layout-check.cjs`.

## 3. Open PRs and unmerged branches
| PR / branch | Head | Mig (md5) | Tests (md5) | Live status | Owner approval |
|---|---|---|---|---|---|
| **#879** `claude/claims-entity-names` | `e4f4e539` | `20261126080000_entity_claim_name_mode.sql` (ad7ffb22…); rollback (7948d8d6…) | `tests/entity-claim-name-mode-live-rollback.sql` (18942d69…); `tests/entity-claims-name-mode-browser.cjs` | Mig **APPLIED 00:39Z 2026-11-26**. As-role dry-run passed (owner and FM can_save=true, save/read back/bad-mode refused/audit 1; anon no execute). CI «tests» was running at handoff. | «انشر 879» typed in main chat. Main chat merges on green CI. Re-merge onto main if it conflicts and send the new head. |
| **#806** `claude/offer-no-stacking` | `0bc8b73f` | `20261123190000_offer_no_stacking.sql` (02acd2c1…); rollback (b3897af2…) | `tests/offer-no-stacking-live-rollback.sql` (e171acc4…) | Mig v2 **live since 2026-11-24**. Synthetic union check 120 ✅. | Approved (White Friday «انشر»). Only the merge is left; the main chat merges on green. |
| `claude/contract-price-auto-matcher` (no open PR; #792 merged at 4f38b75) | `f6d1df54` | none | step files 21-28, below | All applied live by main chats 4/5 | Already approved. These are record-only files: open a small PR «price-matching step files 21–28 (record)» if the main chat wants them on main. |
| `claude/center-list-rules` (no PR) | `dc15d9f2` | none | `docs/CENTER-PRICE-LIST.md` | docs only | Main chat to open a PR if wanted. Records allow_extra_discount=true (see §5). |
| `claude/entity-names-mockup` (no PR) | `848957a1` | none | mockup `entity-service-names.html` + PNGs | — | «طبقه» given. Part B is built (#879); Part A is with the reception chat. |
| #848 `claude/packages-sheet-2026-11-25` | `df2ed0a9` | `20261125120000_package_fixed_price.sql` (20407931…) | 29 (225f1d32), 30 (f0afa8d0), 31 (31abc664), 32 (b9ae711d), 33 (437ef99c); `tests/package-fixed-price-save-as-role-live-rollback.sql` (82fd16f1…) | **MERGED**. Mig + 29 + 31 applied 16:23Z, 32 applied 16:26Z (2026-11-25) | done |

Step files on `claude/contract-price-auto-matcher` (tests/price-matching):
- 21: laser catalogue, read-only.
- 22/23: White Friday offer list steps (5feba0f4…) and dry-run.
- 24/25: 15 White Friday packages (3f625f57…) and dry-run.
- 26/27: chin laser 0001402 at a fixed 200. The final 26 is md5 `ca73c2d5…`.
- 28: packages-sheet mapping, read-only (09c89a15…).

## 4. Allocations held
- Mig `20261126080000` and help `289`: used by #879 (live).
- Mig `20261126090000` and help `290`: **allocated to the reception chat** for Part A, not to this chat.
- No other unused numbers are held.

## 5. Owner decisions, last 3 days
All quotes are the owner's own words.
- **2026-11-24**
  - «العروض ملهاش اي خصومات تانية يعني المريض يسري عليه خصم واحد اما العروض او النقابات واحد منهم فقط». This is mig 190000.
  - White Friday Candela offer and 15 «3 جلسات» packages were published (offer valid until 2026-11-30).
- **2026-11-25, chin laser** (main chat): a new service at a fixed 200, in no offer. Live as **0001402** «جلسة ليزر تحديد الذقن (إزالة شعر الذقن والشارب) كانديلا», الجلدية والتجميل, with the same booking setup as 0001239.
- **2026-11-25, packages sheet:**
  - The 15 area offers become permanent as «عروض المناطق لليزر — كانديلا 3 جلسات — …»: «عرض ثابت معانا», «خليها صلاحيتها 3 شهور». Minimum first payment 25%: «سيب أقل دفعة 25% في أول جلسة زي دلوقتي».
  - Physio: «400 ج الجلسة لو المريض هياخد 6 جلسات / 350 لو … 12 جلسة»; 12 sessions = 4200 over 3 months.
  - «باقات النبضات دي كانديلا فقط / الدايود زي ماهو».
  - Cosmetic packages: «صالحة … لمدة شهر». Cleaning in the 1000 package is «عادي (500) مش عميق». «ديرما بن للوش» = «ديرما بن ميزوثيرابي (500)». Fractional 400 = «فراكشنال لمنطقة واحدة (نضارة وتقشير) ايوه».
  - «ضيف خدمة العنبر» + «تنضيف عميق 800 عمبر 1500»:
    - new service **0001403** «جلسة ديرما بن أمبر» at 1500;
    - package «تنظيف بشرة عميق + ديرما بن أمبر» fixed at 2000;
    - **0001260 deep cleaning 600→800** in the active center list («والتنظيف 800», typed in the main chat).
  - «طبقه» on the fixed-price package editor mockup, then «انشر 848» in the main chat.
- **2026-11-25, «افتح الخصم على قايمة المركز»** (main chat): center list `allow_extra_discount` set to true at 19:15Z. The offer list stays false.
- **2026-11-25/26, claims names:** «ابدأ تصور بحث الاستقبال والمطالبات», then «طبقه» on `entity-service-names.html`, then «انشر 879» in the main chat.
- **Dr Dina's «اتربط 0 سطر … ميد نت / ميد شور» conflict:** **this chat has no record of that message.** It never reached this session. The main chat holds it.
  - Context the next chat needs: ميد نت (858 rows) and ميد شور (863 rows) are separate draft reference lists with near-identical row sets.
  - The «مراجعة أسماء الجهات» screen groups the same normalized name across ALL editable draft reference lists and confirms through `price_service_mapping_command` `source_review` per list row.
  - «اتربط 0 سطر» therefore suggests the rows were refused or skipped. Possible causes:
    - the batch revision changed between load and confirm;
    - an `item_conflict` (the list already holds that service at another price/unit);
    - the rows were already confirmed or deferred by an earlier action.
  - First step: ask the main chat for her exact screen and time, then run a read-only check of those rows' `confirmed` / `deferred` keys and audit entries for both lists.

## 6. Pending owner questions
- None blocking in this chat.
- Waiting on the owner (no question outstanding):
  - reviewing about 3,426 remaining rows in «مراجعة أسماء الجهات»;
  - then closing each insurer/union batch (`discard_batch` once all rows are decided), approving it and activating the contract.

## 7. Live facts relied on
- **Center list**
  - «قائمة أسعار سونو / دار النقاهة» is active, `fallback='base'`, `allow_extra_discount=true` (since 2026-11-25 19:15Z), revision +2 on 2026-11-25 (deep-cleaning item, then discount).
  - Services not listed in it (0001402 at 200, 0001403 at 1500) are priced by base.
- **Offers:** White Friday offer list «عرض وايت فرايداي — ليزر كانديلا جنتل برو» is valid until **2026-11-30**. On 2026-12-01 the cash prices return by themselves (for example 0001239 goes 140→150 and 0001228 pulses 0.50→1.00).
- **Packages**
  - 27 packages with `booking_fixed_price`. Every template equals the fixed price, so they do not move on 2026-12-01.
  - The margin-priced packages DO move: the editor shows «طريقة السعر».
  - Pulse packages: 0001228 × N at visit 1. Partial draws per session work through `clinic_reception.laser_pulse_services` (0001227, 0001228). «من الباكج» partial draw: #850 (merged).
- **Reception catalogue:** sync is `clinic_reception.sync_catalog(<live workspace>)`. Template price = Σ reception prices × (1 + margin), unless a fixed price is set.
- **Claims:** every claim snapshot has `price_terms.item_terms.external_name/external_code`, the contract list item used. That is the source of entity names for old claims.
- **Owner actor in step files:** admin `bd5a528f-af8d-4ada-afe9-ce64e68b1d92`; JWT sub as used in files 22/26/29/31.
- **Financial manager admin:** `cfa7a0c3…`.

## 8. Traps and lessons
- **Offer-based margins drift.** A package priced by margin on offer prices rises when the offer ends. Use `booking_fixed_price` for any agreed package price.
- **Overlapping center lists.** `decide_list` refuses an overlapping active center version. Small owner price changes are done in place on the active list item, with a revision bump and audit (`owner_item_price_change`, file 32). A new version means ending the current one and re-reviewing 1,363 items.
- **Clone defaults.** The clone form copies `allow_extra_discount` from the source (now «نعم»). A brand-new center list defaults to «لا», which blocks every desk discount at arrival (`guard_order_discount`).
- **Copying service rows.** New services copy the template service row generically (`jsonb_populate_record(... to_jsonb(src) || overrides)`), set supplies `[]` and margin 0, and assert department/device. The device guard must compare against sibling services (Candela services have `requires_device=false` live).
- **Matcher accuracy.** Prefix keys over-match: use anchored regexes. Fuzzy links need the noise-word rule (a single digit counts as a difference). PDF damage: ٌ/ً→ي.
- **Fixtures.** Local PG fixture DBs live under the scratchpad (`pg/data`, socket `/tmp`). If the server stops, restart it with `pg_ctl` after `chmod o+x` on every path component.
- **Playwright.** The repo-pinned Playwright browser is missing in the sandbox. Run with `executablePath:/opt/pw-browsers/chromium-1243/real/chrome-linux64/chrome` (the new test reads `PW_CHROMIUM`).
- **GitHub outages.** Pushes can fail with 503 «credential service temporarily unavailable». Retry in the background; it recovered after about 30 min on 2026-11-25.
- **Approvals.** The main chat rejects relayed approvals: the owner must type «انشر N» there.
- **Unrelated repos.** Do not read `swnw-infra` (outside scope). Ask the main chat to copy outputs to SSMPD `claude/price-matcher-output`.

## 9. Exact next steps
1. **#879:** confirm the main chat merged it after CI. If main moved and it conflicts, merge `origin/main` into `claude/claims-entity-names`, rerun `tests/entity-claims-document-contract.test.cjs` and `tests/entity-claims-name-mode-browser.cjs` (`PW_CHROMIUM=…`), push, and send the head.
2. **#806:** ask the main chat to merge it (mig already live). If it conflicts, re-merge main.
3. **Record PRs** (only if the main chat wants them): step files 21–28 from `claude/contract-price-auto-matcher`, and `claude/center-list-rules` (`docs/CENTER-PRICE-LIST.md`).
4. **Part A** (reception chat): when it lands, check that claims pick up `entity_service_name/code`. Print reads them first, then `price_terms.item_terms`.
5. **Dr Dina «اتربط 0 سطر» (ميد نت / ميد شور):** get the details from the main chat, then do the read-only diagnosis described in §5. No writes.
6. **Owner name review:** when the owner finishes rows in «مراجعة أسماء الجهات», guide him per list in Egyptian Arabic: close the batch, approve the list, then activate the contract.
7. **2026-12-01:** White Friday ends by itself. Nothing to do. If asked, confirm with a read-only cash-price check (0001239 = 150, 0001228 = 1.00, fixed packages unchanged).
