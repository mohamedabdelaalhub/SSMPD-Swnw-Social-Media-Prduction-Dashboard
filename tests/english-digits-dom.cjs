// Owner 2026-11-22 «كل الأرقام إنجليزي»: text, attributes, read-only values, options and print windows show 0-9 only;
// typed input stays as typed; scripts/styles untouched; idempotent.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const dom=new JSDOM('<!doctype html><html><head><title>تقرير ٢٠٢٦</title></head><body><p id="a">الساعة ١٠:٣٠ — ٣٠٪ · ۱۲</p><input id="ro" readonly value="٤٥"><input id="ed" value="٥٦"><input id="ph" placeholder="مثلاً ٧"><select><option>خيار ٩</option></select><script id="s">var x="٣";</script></body></html>',{runScripts:'outside-only'});
const w=dom.window,d=w.document;let written='';
w.open=function(){const doc={write:function(s){written+=s;},writeln:function(s){written+=s+'\n';}};return {document:doc};};
w.eval(fs.readFileSync('assets/js/english-digits.js','utf8'));
const tick=()=>new Promise(r=>setTimeout(r,10));
(async()=>{
 assert.equal(d.getElementById('a').textContent,'الساعة 10:30 — 30٪ · 12');assert.equal(d.title,'تقرير 2026');
 assert.equal(d.getElementById('ro').value,'45','read-only value');assert.equal(d.getElementById('ed').value,'٥٦','typed input kept');
 assert.equal(d.getElementById('ph').getAttribute('placeholder'),'مثلاً 7');assert.equal(d.querySelector('option').text,'خيار 9');
 assert.equal(d.getElementById('s').textContent,'var x="٣";','scripts untouched');
 // later DOM changes
 const div=d.createElement('div');div.innerHTML='<b>عدد ٣</b><span title="رقم ٨">x</span>';d.body.appendChild(div);await tick();
 assert.equal(div.querySelector('b').textContent,'عدد 3');assert.equal(div.querySelector('span').getAttribute('title'),'رقم 8');
 div.querySelector('b').firstChild.nodeValue='بقى ١١';await tick();assert.equal(div.querySelector('b').textContent,'بقى 11');
 d.getElementById('a').setAttribute('aria-label','زر ٢');await tick();assert.equal(d.getElementById('a').getAttribute('aria-label'),'زر 2');
 // print windows
 const win=w.open('','_blank');win.document.write('<p>فاتورة رقم ١٢٣ — ٤٥٠ ج</p>');win.document.writeln('٧');
 assert.equal(written,'<p>فاتورة رقم 123 — 450 ج</p>7\n');
 assert.equal(w.SSMPDDigits.en('٠١٢٣٤٥٦٧٨٩ ۰۱۲'),'0123456789 012');assert.equal(w.SSMPDDigits.en(null),null);
 const html=fs.readFileSync('index.html','utf8');const i=html.indexOf('english-digits.js');assert(i>0&&i<html.indexOf('supabase-js'),'loaded first');
 w.close();console.log('PASS english digits: text, title, attributes, read-only values, options, later changes, print windows; typed input and scripts untouched');
})().catch(e=>{console.error(e);process.exit(1);});
