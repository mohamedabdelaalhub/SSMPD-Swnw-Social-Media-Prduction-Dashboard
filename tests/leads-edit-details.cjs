const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const ui = fs.readFileSync(path.join(root, 'assets/js/leads-edit-details.js'), 'utf8');
const edge = fs.readFileSync(path.join(root, 'supabase/functions/leads-update-details/index.ts'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261021_lead_details_edit.sql'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert.match(ui, /id=\"lm-edit-details\"/, 'lead modal must expose an edit-details action');
assert.match(ui, /id=\"lm-edit-name\"/, 'edit form must include customer name');
assert.match(ui, /id=\"lm-edit-phone\"/, 'edit form must include phone');
assert.match(ui, /id=\"lm-edit-source\"/, 'edit form must include source');
assert.match(ui, /id=\"lm-edit-service\"/, 'edit form must include interested service');
assert.match(ui, /id=\"lm-edit-acquisition\"/, 'edit form must include acquisition type');
assert.match(ui, /id=\"lm-edit-department\"/, 'edit form must include requested department');
assert.match(ui, /id=\"lm-edit-message\"/, 'edit form must include message or notes');
assert.match(ui, /functions\.invoke\("leads-update-details"/, 'frontend must use the secured edge function');
assert.match(ui, /#ld-sub-view \[data-open\]/, 'lead id must be captured from lead-list actions');
assert.match(ui, /api\.openLeadById = function/, 'unified-search lead opening must preserve lead id for editing');

assert.match(edge, /customer_service/, 'edge function must authorize lead-module roles');
assert.match(edge, /lead\.assigned_to !== caller\.id/, 'customer service must only edit assigned leads without wider role');
assert.match(edge, /normalizePhone/, 'phone edits must use canonical normalization');
assert.match(edge, /neq\("id", leadId\)/, 'duplicate-phone check must exclude the lead being edited');
assert.match(edge, /rpc_update_lead_details/, 'edge function must use audited database RPC');

assert.match(migration, /create or replace function public\.rpc_update_lead_details/, 'migration must create the details update RPC');
assert.match(migration, /lead_field_changes/, 'details changes must be audited');
assert.match(migration, /revoke all on function public\.rpc_update_lead_details/, 'RPC must not be directly callable by normal clients');
assert.match(migration, /grant execute on function public\.rpc_update_lead_details[^;]+to service_role/, 'service role must be the RPC caller');

const renderPos = index.indexOf('assets/js/render-leads.js');
const editPos = index.indexOf('assets/js/leads-edit-details.js');
assert.ok(renderPos >= 0 && editPos > renderPos, 'lead edit enhancement must load after the core lead renderer');

new Function(ui);
console.log('Lead details edit regression checks passed');
