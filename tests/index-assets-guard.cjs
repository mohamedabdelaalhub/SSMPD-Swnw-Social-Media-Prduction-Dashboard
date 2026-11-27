// Owner 2026-11-27 («احنا بنعمل سيستم ادارة مؤسسة طبية لا يجوز فيها نقول ماحدش خد باله»): the #860 merge silently dropped
// <script src="assets/js/reception-visit-supplies.js"> from index.html and three features died on live for a day.
// Every JS/CSS file the page loads is listed in tests/index-assets.txt. This test fails when:
//   - a listed file is no longer loaded by index.html (dropped — usually by a merge-conflict resolution), or
//   - index.html loads a file that is not listed (a new file must be added to the list in the same PR).
// Removing a line from the list is a visible deletion in the PR diff → rule 11: only with the owner's explicit order.
const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const loaded = new Set(html.match(/assets\/[a-z]+\/[A-Za-z0-9._-]+\.(?:js|css)/g) || []);
const listed = fs.readFileSync(path.join(__dirname, 'index-assets.txt'), 'utf8').split('\n').map(s => s.trim()).filter(Boolean);
const dropped = listed.filter(f => !loaded.has(f));
const added = [...loaded].filter(f => !listed.includes(f));
const missingFile = [...loaded].filter(f => !fs.existsSync(path.join(root, f)));
assert.deepStrictEqual(dropped, [], 'index.html STOPPED loading (dropped by a merge?): ' + dropped.join(', '));
assert.deepStrictEqual(added, [], 'index.html loads files not in tests/index-assets.txt — add them in this PR: ' + added.join(', '));
assert.deepStrictEqual(missingFile, [], 'index.html loads files that do not exist: ' + missingFile.join(', '));
console.log('index-assets-guard: OK (' + listed.length + ' files)');
