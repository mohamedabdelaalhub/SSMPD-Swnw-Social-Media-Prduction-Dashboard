// Owner 2026-11-22: «مؤشرات الحجز من الليدز» table (English digits, step %), mounted under «داشبورد الإدارة» / «خدمة العملاء»;
// reception card tag «من الليدز · <agent>»; lead modal button «احجز للمريض».
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const dom=new JSDOM('<div><div id="ld-sub-view"></div></div>',{runScripts:'outside-only'}),w=dom.window,d=w.document;let args=null;
w.SSMPDDb={client:{rpc:(n,a)=>{args=[n,a];return Promise.resolve({data:[{agent_id:'a1',agent:'منى',leads:120,booked:48,attended:36,paid:33},{agent_id:'a2',agent:'دينا',leads:95,booked:30,attended:21,paid:20}]});}}};
w.eval(fs.readFileSync('assets/js/leads-booking-funnel.js','utf8'));
w.SSMPDLeadFunnel.mount(d.getElementById('ld-sub-view'));
setTimeout(()=>{const box=d.getElementById('ld-funnel');assert(box&&box.previousElementSibling.id==='ld-sub-view');
 assert.equal(args[0],'lead_booking_funnel');assert.match(args[1].p_from,/^\d{4}-\d{2}-01$/);

 const rows=[...box.querySelectorAll('tbody tr')].map(r=>[...r.children].map(c=>c.textContent));
 assert.deepEqual(rows[0],['منى','120','4840%','3675%','3392%']);assert.deepEqual(rows[2],['الإجمالي','215','7836%','5773%','5393%']);
 assert(!/[٠-٩]/.test(box.textContent),'no Arabic-Indic digits');
 w.SSMPDLeadFunnel.mount(d.getElementById('ld-sub-view'));assert.equal(d.querySelectorAll('#ld-funnel').length,1,'no duplicates');w.SSMPDLeadFunnel.unmount();assert(!d.getElementById('ld-funnel'));
 const leads=fs.readFileSync('assets/js/render-leads.js','utf8');assert(/textContent='احجز للمريض'/.test(leads)&&/SSMPDLeadFunnel\.mount\(subView\)/.test(leads));
 const ws=fs.readFileSync('assets/js/reception-workspace.js','utf8');assert(ws.includes("rx-lead-tag")&&ws.includes("من الليدز · "));
 const html=fs.readFileSync('index.html','utf8');assert(html.indexOf('leads-booking-funnel.js')<html.indexOf('render-leads.js'));
 w.close();console.log('PASS lead booking funnel UI: table + step %, English digits, mount once, lead button, reception tag');},20);
