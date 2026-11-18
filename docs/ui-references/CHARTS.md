# Charts kit — «ملف الشارتات»

Owner-approved chart patterns (2026-11-17). Reference implementation: `assets/js/employee-profile.js`
(functions `paint`, `calendar`, `line`, `bars`, sparklines, segmented bar, meters) + `assets/css/employee-profile.css`.
Live mockup: `docs/ui-references/mockups/employee-profile.html`. No chart library: hand-drawn inline SVG, no build step.

## Procedure (dataviz skill)
1. Pick the form by the job (below). Sometimes the answer is a tile, not a chart.
2. Colour by job: status = reserved palette, identity = department colour, magnitude = one hue.
3. Validate any new categorical / status palette (`node <dataviz>/scripts/validate_palette.js "<hex,...>" --mode light`)
   or with `docs/ui-references/color-picker.html`.
4. Thin marks: bars ≤ 24px with 4px rounded data end, lines 2px, end dots r ≥ 4 with a 2px white ring, area wash 10%.
5. Hover/focus/tap tooltip on every mark (crosshair on lines), keyboard ← → on lines, a table view where a chart is the only carrier.
6. Text never wears the series colour. Legend for ≥ 2 series. Time runs left→right (newest on the right) inside a `dir="ltr"` box,
   axis numbers without unit signs (unit goes in the subtitle), caption «الأسبوع ← الأحدث».
7. Motion: lines draw in (stroke-dashoffset), bars grow from the baseline, rings fill, numbers count up — first render only.

## Forms we use
| Job | Form | Example |
|---|---|---|
| One headline score | Ring 0–100 + band chip + delta | التقييم الشامل |
| A KPI and its trend | Tile + 6-point sparkline (end dot) | الالتزام / الغياب / التأخير / المهام |
| Daily status over a month | Calendar heat-grid (status colours + ✕ / minutes glyphs) + table view | الحضور يوم بيوم |
| Trend of a rate | Line + 10% area, crosshair tooltip | الالتزام الأسبوعي |
| Amount per period | Columns, emphasis on the latest 2 | دقايق التأخير |
| Parts of a whole (≤ 6) | Segmented bar with 2px gaps + legend | المهام |
| Several ratios with limits | Meter list (name, bar, figure) | توزيع الأيام / تفاصيل التقييم |
| Me vs group | Two meters (person vs department average) | مقارنة بالقسم |

## Palettes
- Status (validated): on time `#00B0BD`, late `#FF8800` (numbers on these two in grey-80% `#333333`), absent `#FF0000`, leave `#525B6F`, not scheduled `#F1F4F8` (owner's choice, 2026-11-17).
- Departments: `assets/js/hr-attendance-core.js` → `KNOWN` (one colour + icon each; unknown departments take the next unused colour).
- Brand: `#0F369D` primary, `#F15A22` accent/warning (never a department colour), red only for negative/absent.

## Next step
When a second screen needs these charts (home redesign), extract them from `employee-profile.js` into a shared
`assets/js/ui-charts.js` (`SSMPDCharts.line / columns / calendar / segbar / spark / meters / ring`) and switch both screens to it.
