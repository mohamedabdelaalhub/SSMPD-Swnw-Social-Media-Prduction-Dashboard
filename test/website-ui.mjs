import {JSDOM} from 'jsdom';import vm from 'node:vm';import fs from 'node:fs';import assert from 'node:assert/strict';
const dom=new JSDOM('<main></main>');let commands=[],workerCalls=0;
const state={content_id:'item',website_publish_status:'published',action:'upsert'};
const item={id:'item',title:'<unsafe>',stage:'ready_to_publish',publish_platforms:['website']};
const historyQuery={eq(){return this},order(){return this},limit:async()=>({data:[{attempted_at:'2026-10-08',http_status:200,outcome:'published'}]})};
const db={
 from:table=>({select:()=>table==='website_publications'?Promise.resolve({data:[state]}):historyQuery}),
 rpc:async(name,args)=>{commands.push([name,args]);return {}},
 functions:{invoke:async()=>{workerCalls++;return {data:{ok:true}}}}
};
const window={SSMPDDb:{client:db,getContentItem:async()=>item},SSMPDWorkflow:{canEditItem:()=>true},SSMPDAuth:{currentAdmin:{}},SSMPDContentText:{preview:async()=>true},SSMPDToast:{show(){}},confirm:()=>true};
const c={window,document:dom.window.document,console};vm.createContext(c);vm.runInContext(fs.readFileSync(new URL('../assets/js/website-publish.js',import.meta.url),'utf8'),c);
window.SSMPDWebsite.mount(c.document.querySelector('main'),[item]);await new Promise(r=>setTimeout(r,0));
assert.ok(c.document.querySelector('details'));assert.equal(c.document.querySelector('unsafe'),null);assert.match(c.document.body.textContent,/منشور على الموقع/);
c.document.querySelector('[data-web-send]').click();await new Promise(r=>setTimeout(r,0));assert.equal(commands[0][1].p_action,'upsert');assert.equal(workerCalls,1);
c.document.querySelector('[data-web-withdraw]').click();await new Promise(r=>setTimeout(r,0));assert.equal(commands[1][1].p_action,'unpublish');
c.document.querySelector('[data-web-log]').click();await new Promise(r=>setTimeout(r,0));assert.match(c.document.querySelector('[data-web-history]').textContent,/published/);
dom.window.close();console.log('PASS Website UI, escaped titles, confirm, withdrawal, attempt history and worker invocation');
