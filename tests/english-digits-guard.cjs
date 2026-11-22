// Owner rule 2026-11-22 (CLAUDE.md rule 8): every number in the dashboard and its prints uses English digits 0-9, never ٠-٩.
// 1) No toLocale*/Intl.* call passes an Arabic locale without «-u-nu-latn».
// 2) Every page that runs scripts loads latin-digits.js (the global safety net).
// 3) The safety net really turns ar-EG numbers, dates and screen text into English digits.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const roots=['assets/js','patient-portal','.'];const files=[];
for(const r of roots)for(const f of fs.readdirSync(r)){const p=path.join(r,f);if(fs.statSync(p).isFile()&&/\.(js|html)$/.test(f))files.push(p);}
const bad=[];const rx=/(toLocale(?:String|DateString|TimeString)|Intl\.(?:NumberFormat|DateTimeFormat|RelativeTimeFormat|PluralRules))\(\s*(['"`])(ar(?:-[A-Za-z]{2})?(?:-u-[a-z0-9-]+)?)\2/g;
for(const f of files){const s=fs.readFileSync(f,'utf8');let m;while((m=rx.exec(s)))if(!/-u-(?:[a-z0-9-]*-)?nu-latn/.test(m[3]))bad.push(f+': '+m[0]);}
assert.deepEqual(bad,[],'use \'ar-EG-u-nu-latn\' (English digits):\n'+bad.join('\n'));
const pages=files.filter(f=>f.endsWith('.html'));const missing=[];
for(const p of pages){const s=fs.readFileSync(p,'utf8');const scripts=(s.match(/<script[^>]*src="([^"]+)"/g)||[]).filter(x=>!/pages-redirect/.test(x));if(scripts.length&&!/latin-digits\.js/.test(s))missing.push(p);}
assert.deepEqual(missing,[],'pages that run scripts must load assets/js/latin-digits.js');
const dom=new JSDOM('<body><p id="t">موعد ٣:٤٥ — ١٢٠ ج.م</p><input id="i" value="٥"></body>',{runScripts:'outside-only'}),w=dom.window;
w.eval(fs.readFileSync('assets/js/latin-digits.js','utf8'));
const out=w.eval("[(1234.5).toLocaleString('ar-EG'),new Intl.NumberFormat('ar').format(98),new Date(Date.UTC(2026,10,22,10,5)).toLocaleDateString('ar-EG',{timeZone:'UTC',day:'numeric',month:'long'}),new Date(Date.UTC(2026,10,22,10,5)).toLocaleTimeString('ar-EG',{timeZone:'UTC',hour:'numeric',minute:'2-digit'})].join(' | ')");
assert(!/[٠-٩۰-۹]/.test(out),'formatters give English digits: '+out);
setTimeout(()=>{assert.equal(w.document.getElementById('t').textContent,'موعد 3:45 — 120 ج.م','screen text converted');assert.equal(w.document.getElementById('i').value,'٥','typed input left alone');
 console.log('PASS english digits: no Arabic-locale call without -u-nu-latn ('+files.length+' files), every script page loads latin-digits.js, formatters + screen text show 0-9.');process.exit(0);},50);
