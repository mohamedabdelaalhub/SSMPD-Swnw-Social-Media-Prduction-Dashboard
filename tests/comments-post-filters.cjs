const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const filters = fs.readFileSync(path.join(root, 'assets/js/comments-post-filters.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'assets/js/comments.js'), 'utf8');

assert.match(bootstrap, /comments-post-filters\.js\?v=comments-post-filters-20261021-1/, 'global comments bootstrap must load the social inbox filter enhancement');
assert.match(filters, /cm-category/, 'comments inbox must expose a classification filter');
assert.match(filters, /cm-post-ref/, 'comments inbox must expose a post filter');
assert.match(filters, /post_ref/, 'post filtering must use the platform post reference');
assert.match(filters, /content_items/, 'post labels should reuse dashboard content titles where available');
assert.match(filters, /غير مصنف/, 'classification filter must include unclassified comments');
assert.match(filters, /كل البوستات/, 'post filter must provide an all-posts option');
assert.match(filters, /BRANDS/, 'post labels should identify the owning brand/page');
assert.match(filters, /g\.count \+ " تعليق"/, 'post options should show comment counts');
assert.match(filters, /row\.post_ref === filterState\.postRef/, 'selected post must filter cards by exact post_ref');
assert.match(filters, /row\.category === filterState\.category/, 'selected classification must filter by category');
assert.match(filters, /@media\(max-width:640px\)/, 'new filters must remain usable on mobile');
new Function(filters);
new Function(bootstrap);

console.log('Comment classification and post filter checks passed');
