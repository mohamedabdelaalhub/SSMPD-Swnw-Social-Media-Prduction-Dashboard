# UI references — مراجع التصميم

Every UI/UX change in this repo should cite the reference it draws from here.
References inspire layout, density and motion. They never replace the Swnw
identity: local WOFF2 fonts only, colours `#0F369D` / `#F15A22` / `#16212E` /
`#2F7D5C` / `#D0402A`, the name «Swnw», Arabic RTL first.

Status: **Motion & sound foundations APPROVED by the owner (2026-11-17).** Employee performance profile mockup approved; home mockup to be revised with the motion/sound/chart additions.

## Saved kits (use these first)

| Kit | File | Live page (owner only) |
|---|---|---|
| Sounds & motion «ملف الأصوات» | `interaction-kit.html` (spec) → shipped as `assets/js/ui-motion.js` + `assets/css/ui-motion.css` (#544) | https://claude.ai/artifact/RpYG3EJJHNKdi1DJwnfgwu |
| Colours «ملف الألوان» | `color-picker.html` (department + status colours, live checks) | https://claude.ai/artifact/RWub6YLdDyXQQJ5yovUJjw |
| Charts «ملف الشارتات» | `CHARTS.md` → reference code `assets/js/employee-profile.js` (#545) | https://claude.ai/artifact/4rzx6VYe8uVPFKavrPb3Fo |
| Layout QA | `tools/layout-check.cjs` (one gutter, aligned edges, equal column ends, no clipping) | — |
| Mockups | `mockups/` (presence, home, employee profile) | — |

## Sources

| Folder | Source | What it is |
|---|---|---|
| `code-xr-ember-v29/` | Instagram `code.xr` — "Ember Dashboard V29" reel (owner screenshots, 2026-11-17) | CRM-style admin dashboard: overview, Saved, Tasks, Messages screens. React + Tailwind + framer-motion. Full source is gated behind "comment Code" on the post. |
| — | Instagram `felvrabr` | Not received yet. |
| — | Pinterest boards | Not received yet. |

Instagram, Pinterest, CodePen, Dribbble and Gumroad are blocked from the
build sandbox. Only GitHub is reachable, so template code can be reused only
if the owner forwards a GitHub link.

## Principles taken from Ember V29

1. **Slim dark icon rail.** A narrow (≈56px) rounded dark rail with icon-only
   items, a tooltip on hover, and the active item as a filled accent circle.
   For us: the rail sits on the **right** (RTL); active = brand orange.
2. **One quiet page header.** Small date line, small breadcrumb title, then a
   large page title (≈2× body) with a muted one-line subtitle
   ("10 open · 2 overdue"). Search, notifications and avatar float top-left (RTL).
3. **Pale canvas, white cards, big radius.** Light grey background, white
   cards with ≈16–20px radius, hairline borders, almost no shadow. Generous
   inner padding (≈20–24px), consistent 16px gaps.
4. **One hero card per screen.** Exactly one card is filled with the accent
   gradient (e.g. "Due today") — everything else is white. The accent is
   rare, so it marks the single most important number.
5. **Big numbers, small labels.** KPI tiles: tiny muted label above, large
   number below, optional thin progress bar. Tabular numerals.
6. **Pill filters with counts.** Segmented pills "All 12 · Calls 4 · Emails 4";
   the active pill is dark-filled.
7. **Soft status chips.** High / Medium / Low and Today / Tomorrow as pale
   tinted pills, not saturated blocks. Completed rows get strike-through and
   reduced opacity.
8. **Motion is small and functional.** Cards lift ≈5px on hover
   (`whileHover y:-5`), smooth tab/page transitions, progress bars fill on
   load. No long or decorative animations; respect `prefers-reduced-motion`.
9. **Density.** Lists are compact (one row ≈44–52px) with icon, title,
   one-line meta, chips and avatar aligned on one line.

## How this maps to Swnw

- Ember's coral accent → Swnw orange `#F15A22` (hero card, active rail item,
  primary buttons). Blue `#0F369D` stays the brand/heading colour.
- Dark rail → `#16212E`.
- Positive/negative chips → `#2F7D5C` / `#D0402A` tinted backgrounds.
- No React/Tailwind/framer-motion: the dashboard is plain HTML/CSS/JS with no
  build step, so hover lifts and transitions are done in CSS
  (`transform`, `transition`) inside `assets/css/dashboard-theme.css`.

## QA gate before any screenshot is shown to the owner

1. `node docs/ui-references/tools/layout-check.cjs <page> [cardSelector] 1440 1024 390` must print PASS at every width:
   one gutter value, no near-miss edges between rows, side-by-side columns end on the same line,
   no clipped text, no horizontal overflow.
2. Review against the Refactoring UI checklist (hierarchy, spacing scale, grouping, button hierarchy,
   clutter, shadows, contrast, empty states). Counts sit next to their titles; numbers sit under their labels.
3. Spacing tokens: 16px gap on desktop, 12px on phones (presence board uses 14/12, matching the attendance hub).

## Motion & sound foundations (owner-approved 2026-11-17)

Live reference: `docs/ui-references/interaction-kit.html`. Every screen follows this table.

| Interaction | Motion | Duration | Sound |
|---|---|---|---|
| Press any button / card | scale 0.97 + ripple from the press point | 120ms | soft «tick» |
| Mouse hover on button / card | lift 2–4px + shadow + icon nudge (only on `@media (hover:hover)`) | 180–240ms | none |
| Pick a filter / tab | colour slides, count bumps | 240–420ms | toggle |
| Save / finish succeeded | spinner → drawn check → green | 420ms | two rising notes |
| Field error | shake + red ring + message under the field | 380ms | low tone |
| New notification | bell rings, badge pops in | 700ms | notification chime |
| Page opens | cards rise in sequence, numbers count up | 500ms | none |
| Automatic refresh | no motion | — | none |

Tokens: `--ease-out: cubic-bezier(.22,1,.36,1)`, `--ease-spring: cubic-bezier(.34,1.56,.64,1)`, `--ease-in: cubic-bezier(.55,0,1,.45)`.
Sounds: one shared Web Audio library (no files), master gain ≤ 0.22, per-user on/off in «إعداداتي». Light haptic tick (8ms) on touch devices that support it.
`prefers-reduced-motion` disables motion. Never a sound on hover.

## Charts

Use the dataviz skill procedure: pick the form first, validate any categorical/status palette with its validator, thin marks, hover tooltips + table view, time runs left→right (newest on the right) inside an LTR chart box, axis numbers without unit signs (unit in the subtitle).
Attendance status palette (validated): on time `#1F9D6B`, late `#E08A1E`, absent `#D0402A`, leave `#4F75CF`, not scheduled `#E3E6EC` — always with a legend/label.
