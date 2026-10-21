const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const leadUi = fs.readFileSync(path.join(root, 'assets/js/leads-edit-details.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261021_social_comments_read_performance.sql'), 'utf8');

assert.match(leadUi, /modal\.classList\.add\("lead-modal"\)/, 'lead dialogs need a dedicated responsive class');
assert.match(leadUi, /#lm-edit-details\{background:#fff;color:#0B2A7A/, 'edit action needs high contrast on the blue modal header');
assert.match(leadUi, /@media\(max-width:640px\)/, 'lead dialog needs a phone layout');
assert.match(leadUi, /grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\) 44px/, 'phone header must reserve a full title row and action row');
assert.match(leadUi, /roles\.canSeeTab\(admin, "leads"\)/, 'lead renderer must enforce the same tab permission before making data calls');
assert.match(leadUi, /القسم غير متاح لحسابك/, 'unauthorized access should render a clear local message rather than leak a backend 403');
assert.match(leadUi, /btn btn-primary sm[^\n]+lm-edit-save/, 'edit form save action should be visually primary');

assert.match(index, /roles\.js\?v=permissions-20261021-1/, 'roles cache must be busted for existing mobile sessions');
assert.match(index, /app\.js\?v=permissions-20261021-1/, 'shell cache must be busted for existing mobile sessions');
assert.match(index, /render-leads\.js\?v=leads-mobile-20261021-2/, 'lead renderer cache must be busted');
assert.match(index, /leads-edit-details\.js\?v=leads-mobile-20261021-2/, 'lead modal enhancement cache must be busted');
assert.match(index, /render-comments\.js\?v=comments-performance-20261021-1/, 'comments UI cache must be busted');

for (const table of ['social_comments', 'social_messages', 'social_reply_templates', 'social_settings']) {
  const re = new RegExp(`create policy [\\s\\S]*?on public\\.${table}[\\s\\S]*?using \\(\\(select public\\.social_comments_access\\(\\)\\)\\)`, 'i');
  assert.match(migration, re, `${table} read policy must evaluate the access helper once per query`);
}
assert.match(migration, /social_comments_commented_at_idx[\s\S]*commented_at desc/i, 'comments need an order-by index');
assert.match(migration, /social_messages_sent_at_idx[\s\S]*sent_at desc/i, 'messages need an order-by index');

new Function(leadUi);
console.log('Mobile lead layout, permission guard and comments performance checks passed');
