// Queue phase 3: waiting-screen board. New call → banner with number + room, once; first load never alarms; no patient fields rendered.
const assert=require('node:assert/strict'),fs=require('fs'),{JSDOM}=require('jsdom');
const html=fs.readFileSync('queue-display.html','utf8').replace(/<script src="https:[^>]*><\/script>/g,'').replace(/<script src="assets[^>]*><\/script>/,'').replace(/<script>[\s\S]*?<\/script>/,'');
const dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true});const {window}=dom;
window.eval(fs.readFileSync('assets/js/queue-display.js','utf8'));
let calls=[{call_id:'c1',ticket_no:'3',room_label:'عيادة 1',called_at:'2026-11-19T10:00:00Z'}];
const board=()=>({doctors:[{name:'د. أول',specialty:'جلدية',room_label:'عيادة 1',current_no:3,waiting_nos:[4,5,6,7,8,9,10,11,12,13],waiting_count:10,done_count:2},{name:'د. تاني',specialty:'باطنة',room_label:null,current_no:null,waiting_nos:[],waiting_count:0,done_count:0}],
 departments:[{name:'غرفة سحب العينات',room_label:'غرفة سحب العينات',ticket_prefix:'L',current_no:'L2',waiting_nos:['L3'],waiting_count:1,done_count:1}],calls});
const seenArgs=[];const rpc=(n,a)=>{seenArgs.push([n,a]);return Promise.resolve(board());};
(async()=>{
 const h=window.SWNWQueueDisplay.init({rpc,token:'tok-1',root:window.document,bannerMs:30,everyMs:1e9});
 await new Promise(r=>setTimeout(r,20));
 assert.equal(JSON.stringify(seenArgs[0]),JSON.stringify(['clinic_reception_queue_display',{p_display_token:'tok-1'}]));
 const cards=window.document.querySelectorAll('.card');assert.equal(cards.length,3);
 assert.match(cards[0].textContent,/د\. أول/);assert.match(cards[0].textContent,/عيادة 1/);assert.equal(cards[0].querySelector('[data-cur]').textContent,'3');
 assert.equal(cards[0].querySelectorAll('.chip').length,9,'8 numbers + «+2»');assert.match(cards[1].textContent,/بدون غرفة محددة/);assert.match(cards[2].textContent,/L2/);
 assert.equal(window.document.querySelector('[data-banner]').hidden,true,'first load: existing calls never alarm');
 calls=[{call_id:'c2',ticket_no:'L3',room_label:'غرفة سحب العينات',called_at:'x'}].concat(calls);
 h.poll();await new Promise(r=>setTimeout(r,10));
 const b=window.document.querySelector('[data-banner]');assert.equal(b.hidden,false);assert.match(b.textContent,/L3/);assert.match(b.textContent,/غرفة سحب العينات/);
 await new Promise(r=>setTimeout(r,60));assert.equal(b.hidden,true,'banner closes by itself');
 h.poll();await new Promise(r=>setTimeout(r,10));assert.equal(b.hidden,true,'same call is not announced twice');
 assert.match(window.document.querySelector('[data-recent]').textContent,/L3/);
 assert(!/patient|مريض|phone|01\d{9}/i.test(window.document.body.textContent),'no patient data on the board');
 // missing token → clear message, no polling
 const w2=new JSDOM(html,{runScripts:'outside-only'}).window;w2.eval(fs.readFileSync('assets/js/queue-display.js','utf8'));
 w2.SWNWQueueDisplay.init({rpc:()=>{throw new Error('must not poll')},token:null,root:w2.document});assert.match(w2.document.querySelector('[data-status]').textContent,/غير مكتمل/);
 h.stop();console.log('PASS queue display DOM: board cards, waiting chips cap, room-less doctor, new-call banner once, first load silent, no patient data, missing token.');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
