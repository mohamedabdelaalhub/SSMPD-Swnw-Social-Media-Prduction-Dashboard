// Owner 2026-11-21: the lab (provider capacity > 1) shows a time as free until `capacity` bookings overlap it, without the
// doctor gap; a doctor (capacity 1) keeps one-at-a-time + gap. Same rule for the extra services planned in the modal.
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('node:assert/strict');
const src=fs.readFileSync('assets/js/reception-workspace.js','utf8');
const line=k=>{const i=src.indexOf(k);assert(i>=0,k);return src.slice(i,src.indexOf('\n',i));};
const dom=new JSDOM('',{runScripts:'outside-only'}),w=dom.window;
const T=m=>Date.UTC(2026,10,22,8,m);
w.eval('var data='+JSON.stringify({workspace:{booking_gap_minutes:5},providers:[{id:'lab',capacity:3},{id:'doc'}],appointments:[
 {id:'a',provider_id:'lab',status:'booked',starts_at:new Date(T(0)).toISOString(),ends_at:new Date(T(15)).toISOString()},
 {id:'b',provider_id:'lab',status:'booked',starts_at:new Date(T(0)).toISOString(),ends_at:new Date(T(15)).toISOString()},
 {id:'c',provider_id:'lab',status:'cancelled',starts_at:new Date(T(0)).toISOString(),ends_at:new Date(T(15)).toISOString()},
 {id:'d',provider_id:'doc',status:'booked',starts_at:new Date(T(0)).toISOString(),ends_at:new Date(T(15)).toISOString()}]})+';'
 +line('function gapMs(){')+'\n'+line('function capTaken(')+'\n'+line('function slotTaken(provider,t,end,taken)')+';window.cap=capTaken;window.st=slotTaken;');
assert.equal(w.cap('lab',T(0),T(15)),false,'2 of 3 taken → still free');
assert.equal(w.cap('lab',T(0),T(15),'a'),false);
assert.equal(w.cap('lab',T(15),T(30)),false,'no gap for the lab');
assert.equal(w.cap('doc',T(0),T(15)),true,'doctor one at a time');
assert.equal(w.cap('doc',T(17),T(30)),true,'doctor gap kept');
assert.equal(w.cap('doc',T(20),T(35)),false);
assert.equal(w.st('lab',T(0),T(15),[{provider_id:'lab',t:T(0),end:T(15)}]),true,'planned extra fills the 3rd place');
assert.equal(w.st('lab',T(0),T(15),[]),false);
assert.equal(w.st('doc',T(17),T(30),[]),true);
assert(/capTaken\(provider,t,end,appointment&&appointment\.id\)/.test(src)&&/if\(capTaken\(provider,t,end,ignoreId\)\)/.test(src),'used by the time list and next-free');
console.log('PASS lab capacity in the booking time list');
