'use strict';
(async()=>{
const assert=require('node:assert/strict');
const C=await import('../supabase/functions/service-report-notify/core.mjs');
const U='00000000-0000-0000-0000-000000000001';
assert.deepEqual(C.parseBody({workspace:U,order:U}),{workspace:U,order:U});
for(const bad of [null,{}, {workspace:'x',order:U},{workspace:U,order:'1; drop'},'str'])assert.throws(()=>C.parseBody(bad));
const m=C.buildEmail();
assert.ok(m.text.includes(C.PORTAL_URL)&&m.html.includes(C.PORTAL_URL));
assert.ok(!/تحليل|أشعة|CBC|نتيجة|تشخيص/.test(m.subject+m.text+m.html));           // no medical detail
assert.ok(C.buildEmail('https://x/"><script>').html.includes('&quot;&gt;&lt;script&gt;'));
assert.equal(C.senderEmail('Swnw <a@b.com>'),'a@b.com');assert.equal(C.senderEmail('a@b.com'),'a@b.com');
assert.equal(C.pickProvider({from:'',resend:'k'}).error,'EMAIL_FROM_NOT_CONFIGURED');
assert.equal(C.pickProvider({from:'a@b.com'}).error,'EMAIL_NOT_CONFIGURED');
assert.equal(C.pickProvider({from:'a@b.com',brevo:'k',sendgrid:'s'}).name,'brevo');
assert.equal(C.pickProvider({from:'a@b.com',resend:'r',brevo:'k'}).name,'resend');
const calls=[];const ok=async(u,o)=>{calls.push([u,o]);return {ok:true};};
let r=await C.sendEmail({from:'Swnw <a@b.com>',resend:'rk'},'p@x.com',m,ok);
assert.deepEqual(r,{ok:true,provider:'resend'});assert.equal(calls[0][0],'https://api.resend.com/emails');
assert.equal(JSON.parse(calls[0][1].body).to[0],'p@x.com');assert.equal(calls[0][1].headers.Authorization,'Bearer rk');
r=await C.sendEmail({from:'a@b.com',sendgrid:'sg'},'p@x.com',m,ok);assert.equal(r.provider,'sendgrid');
r=await C.sendEmail({from:'a@b.com',brevo:'bk'},'p@x.com',m,ok);assert.equal(r.provider,'brevo');
r=await C.sendEmail({from:'a@b.com',resend:'rk'},'p@x.com',m,async()=>({ok:false,status:429}));
assert.deepEqual(r,{ok:false,code:'EMAIL_SEND_FAILED',provider:'resend',status:429});
r=await C.sendEmail({from:'a@b.com',resend:'rk'},'p@x.com',m,async()=>{throw new Error('net');});assert.equal(r.code,'EMAIL_SEND_FAILED');
r=await C.sendEmail({from:'a@b.com'},'p@x.com',m,ok);assert.equal(r.code,'EMAIL_NOT_CONFIGURED');
assert.ok(!JSON.stringify(r).includes('rk'));                                                        // never echoes keys
console.log('service-report-notify tests passed');
})().catch(e=>{console.error(e);process.exit(1);});
