const fs=require('fs'),assert=require('node:assert/strict'),r=f=>fs.readFileSync(__dirname+'/../assets/js/'+f+'.js','utf8');
for(const f of ['workflow','render-production','publication-preview'])assert(r(f).includes('ريل شخصيات كارتونية'),f+' shows the friendly label');
assert(/function angleLabel\(v\)\s*\{\s*return v === "character_reel"/.test(r('workflow')),'helper maps only character_reel');
assert(!/escapeHtml\(p\.content_angle \|\|/.test(r('workflow')),'no raw angle left in the pattern card');
assert(r('workflow').includes('id="ed-angle" value="\' + escapeAttr(item.content_angle'),'the edit form keeps the raw value (managers edit the real field)');
console.log('PASS: character_reel shows as «ريل شخصيات كارتونية» in item details, publication preview and pattern cards; the edit field keeps the raw value.');
