# Shared dashboard presentation

`assets/css/dashboard-theme.css` extends the personal homepage's visual language across the dashboard. `index.html` loads it after the common module sheets. It contains screen-only CSS, with no JavaScript or backend changes.

- Brand blue page/dialog/menu headers, pale background, white cards, fine borders and restrained shadows.
- Shared main/inner tabs, navigation/search menus, form controls and table spacing.
- Legacy social pages and content preview use their existing DOM. Accounting, reception, patient profile, psychology, tasks, reports, inventory and administration retain their module structure.
- Keep native controls, disabled/readonly styles, current/pressed tabs, danger/status colors, hidden rules, permission visibility, ordering, navigation positions, workflow and print rules intact.
- The card accent widths and hierarchy in tasks and the existing specialized editing/canvas layouts stay in their own stylesheets. No universal class-substring selectors or blanket heading overrides.

Run `node test/smoke.js` and `node tests/dashboard-theme-ui.cjs` with Playwright Chromium installed. The latter loads the real shell/renderers and CSS cascade against the existing smoke fixture's in-memory client. It checks 1280/390/320 widths, content and native form-state invariance, menus, dialog close, navigation, status colors, overflow and print exclusion. Optional `RECEPTION_QA` writes local QA screenshots. It makes no real API calls and does not authenticate as staff.

For future components use the existing shared classes, or explicitly extend the selector families here. Never move business logic or permission rules into CSS. Bump the theme URL when changing it. A module with a bespoke stylesheet may need an explicit selector rather than increased global specificity.
