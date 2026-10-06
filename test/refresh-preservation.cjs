const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{
 const dom=new JSDOM('<body><div id="view-container"></div></body>',{runScripts:'outside-only',url:'https://example.test'}),w=dom.window,d=w.document;
 let renders=0,confirmed=false,scrolled;
 const renderer={render(view){renders++;view.innerHTML='<textarea id="draft"></textarea><select id="pick"><option value="a">a</option><option value="b">b</option></select>';}};
 w.SSMPDRoles={};w.SSMPDAuth={currentAdmin:{id:'a'}};w.SSMPDRenderProduction=renderer;w.SSMPDRenderReview=renderer;w.SSMPDToast={show(){}};w.confirm=()=>confirmed;w.scrollTo=(x,y)=>scrolled=[x,y];Object.defineProperty(w,'scrollY',{value:620});
 let source=fs.readFileSync('assets/js/app.js','utf8');source=source.slice(0,source.indexOf('  // ---------- تشغيل ----------'))+'window.__test={refresh:refreshCurrentTab,switchTab:switchTab};})();';w.eval(source);
 w.__test.switchTab('production');const first=d.getElementById('view-container'),draft=d.getElementById('draft');draft.value='مسودة';draft.dispatchEvent(new w.Event('input',{bubbles:true}));d.getElementById('pick').value='b';d.getElementById('pick').dispatchEvent(new w.Event('change',{bubbles:true}));
 w.__test.refresh({eventType:'UPDATE'});w.__test.refresh({eventType:'INSERT'});w.__test.refresh();assert.equal(renders,1);assert.equal(d.getElementById('view-container'),first);assert.equal(d.getElementById('draft').value,'مسودة');assert.equal(d.getElementById('pick').value,'b');assert.equal(d.querySelectorAll('#ssmpd-refresh-notice').length,1);assert.equal(w.sessionStorage.getItem('ssmpd_active_tab'),'production');
 d.querySelector('#ssmpd-refresh-notice button').click();assert.equal(renders,1);confirmed=true;d.querySelector('#ssmpd-refresh-notice button').click();assert.equal(renders,2);assert.notEqual(d.getElementById('view-container'),first);assert(!d.getElementById('ssmpd-refresh-notice'));await new Promise(r=>setTimeout(r,180));assert.equal(scrolled[1],620);
 const old=d.getElementById('view-container');w.__test.switchTab('review');old.innerHTML='late response';assert(!d.getElementById('view-container').textContent.includes('late response'));assert.equal(w.sessionStorage.getItem('ssmpd_active_tab'),'review');
 dom.window.close();console.log('PASS realtime/polling preserve drafts, selections and view; one notice; cancelled refresh; manual scroll restoration and stale-response isolation');
})().catch(e=>{console.error(e);process.exitCode=1;});
