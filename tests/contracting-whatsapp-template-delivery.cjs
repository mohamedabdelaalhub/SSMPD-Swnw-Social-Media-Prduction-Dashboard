const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const template = fs.readFileSync(path.join(root, 'supabase/functions/contracting-document-template-send/index.ts'), 'utf8');
const router = fs.readFileSync(path.join(root, 'supabase/functions/contracting-document-send-router/index.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261022_contracting_whatsapp_document_template.sql'), 'utf8');

assert.match(migration, /whatsapp_waba_id/, 'settings must persist the WABA id');
assert.match(migration, /whatsapp_template_id/, 'settings must persist the template id');
assert.match(migration, /whatsapp_template_name/, 'settings must persist the template name');
assert.match(migration, /swnw_partnership_document_ar_v1/, 'migration must configure the submitted partnership template');

assert.match(template, /message_templates\?name=/, 'template sender must read live approval state from Meta');
assert.match(template, /templateStatus !== "APPROVED"/, 'template sender must never use a pending or rejected template');
assert.match(template, /type:\s*"template"/, 'closed-window send must use a WhatsApp template message');
assert.match(template, /type:\s*"document"/, 'template header must carry the PDF document');
assert.match(template, /parameters:\s*\[\{ type: "text", text:/, 'template body must receive the institution name');
assert.match(template, /whatsapp_template_accepted/, 'Meta acceptance must be audited separately from delivery');
assert.doesNotMatch(template, /from\("contracting_agreements"\)\s*\.update/, 'template acceptance must not mark the agreement delivered');

assert.match(router, /contracting-document-send-core/, 'router must preserve normal 24-hour-window delivery through the existing core');
assert.match(router, /WHATSAPP_WINDOW_EXPIRED/, 'router must switch paths only when the customer-service window is closed');
assert.match(router, /contracting-document-template-send/, 'router must automatically use the approved template outside the window');
assert.match(router, /WHATSAPP_TEMPLATE_\(PENDING\|REJECTED\|PAUSED\|DISABLED/, 'not-ready templates must preserve the existing manual-share path');
assert.doesNotThrow(() => new Function(router.replace(/^import[^\n]*\n/gm, '')), 'router source must remain syntactically valid after imports');

console.log('Contracting WhatsApp template delivery checks passed');
