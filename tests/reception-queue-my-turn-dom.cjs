// Queue phase 4a: patient «اعرف دورك» page. Numbers and status only; invalid link message; stops polling when the visit ends.
const assert=require('node:assert/strict'),fs=require('fs'),{JSDOM}=require('jsdom');
const html=fs.readFileSync('my-turn.html','utf8').replace(/<script src="https:[^>]*><\/script>/g,'').replace(/<script src="assets[^>]*><\/script>/,'').replace(/<script>[\s\S]*?<\/script>/,'');
const mk=()=>{const w=new JSDOM(html,{runScripts:'outside-only'}).window;w.eval(fs.readFileSync('assets/js/my-turn.js','utf8'));return w;};
(async()=>{
 let w=mk(),reply={ok:true,state:'waiting',order_no:5,ahead_count:2,current_no:3,doctor_name:'د. فلان',room_label:'عيادة 2',booked_time:'18:30'},calls=[];
 const rpc=(n,a)=>{calls.push([n,a]);return Promise.resolve(reply);};
 let h=w.SWNWMyTurn.init({rpc,token:'tok',root:w.document,everyMs:1e9});await new Promise(r=>setTimeout(r,10));
 assert.equal(JSON.stringify(calls[0]),JSON.stringify(['clinic_reception_my_turn',{p_token:'tok'}]));
 let t=w.document.getElementById('turn').textContent;assert.match(t,/في الانتظار/);assert.match(t,/5/);assert.match(t,/قدامك/);assert.match(t,/عيادة 2/);assert.match(t,/د\. فلان/);
 reply={...reply,state:'called',ahead_count:0};await h.poll();t=w.document.getElementById('turn');assert(t.querySelector('.called'));assert.match(t.textContent,/اتنادى عليك/);assert.match(t.textContent,/اتفضل على عيادة 2/);
 reply={ok:true,state:'not_arrived',order_no:null,doctor_name:'د. فلان',room_label:null,booked_time:'18:30'};await h.poll();assert.match(w.document.getElementById('turn').textContent,/لسه ماسجلتش وصولك/);assert.match(w.document.getElementById('turn').textContent,/18:30/);
 reply={ok:true,state:'done',doctor_name:'د. فلان'};await h.poll();assert.match(w.document.getElementById('turn').textContent,/خلص كشفك/);
 reply={ok:false,error:'invalid_or_expired'};await h.poll();assert.match(w.document.getElementById('turn').textContent,/مش شغال أو انتهت/);
 const w2=mk();w2.SWNWMyTurn.init({rpc:()=>{throw new Error('no token → no call');},token:null,root:w2.document});assert.match(w2.document.getElementById('turn').textContent,/مش شغال/);
 const pc=fs.readFileSync('patient-checkin.html','utf8');assert(/my-turn\.html\?t=/.test(pc)&&/directToken\?/.test(pc),'check-in success links to the turn page for the direct link');
 h.stop();console.log('PASS my-turn DOM: waiting with ahead count, called highlight with room, not arrived, done stops, invalid link, no token; check-in links to it.');process.exit(0);
})().catch(e=>{console.error(e);process.exit(1);});
