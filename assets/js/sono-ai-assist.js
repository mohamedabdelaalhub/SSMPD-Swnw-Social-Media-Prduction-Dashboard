/* Employee entry to the smart Sono (Codex via the Contabo gateway). Hidden unless the owner switched it on
   and the gateway reports Codex connected for this account. Answers are plain text; nothing is executed. */
(function(w){
'use strict';
if(w.SSMPDSonoAI)return;
var base='/api/digital-team',TITLE='سونو الذكي — إرشاد',db=null,roomId=null,usable=false,probing=null;
function client(){if(db)return db;var c=w.SSMPD_CONFIG&&w.SSMPD_CONFIG.supabase;if(!c||!w.supabase)throw Error('سجّل الدخول أولًا');return db=w.supabase.createClient(c.url,c.anonKey,{auth:{persistSession:true,autoRefreshToken:true}});}
async function api(path,body){
 if(w.location.hostname!=='dashboard.swnwclinics.com'&&(!w.SSMPD_CONFIG||w.SSMPD_CONFIG.digitalTeamServer!==true))throw Error('غير متاح في هذه النسخة');
 var session=await client().auth.getSession(),token=session.data&&session.data.session&&session.data.session.access_token;
 if(!token)throw Error('سجّل الدخول أولًا');
 var r=await w.fetch(base+path,{method:body?'POST':'GET',headers:Object.assign({Authorization:'Bearer '+token},body?{'Content-Type':'application/json'}:{}),body:body?JSON.stringify(body):undefined,credentials:'same-origin',cache:'no-store'});
 var data;try{data=await r.json();}catch(_){throw Error('الخدمة غير متاحة الآن');}
 if(!r.ok)throw Error(data.error||'تعذر الوصول لسونو');return data;
}
function probe(){
 if(probing)return probing;
 probing=(async function(){try{var b=await api('/bootstrap');var a=(b.agents||[]).find(function(x){return x.code==='codex';});usable=!!(a&&a.chat&&a.connected);}catch(_){usable=false;}probing=null;return usable;})();
 return probing;
}
async function ensureRoom(){
 if(roomId)return roomId;
 var r=await api('/rooms'),found=(r.rooms||[]).find(function(x){return x.title===TITLE&&(x.agents||[]).length===1&&x.agents[0]==='codex';});
 if(found)return roomId=found.id;
 var c=await api('/rooms',{agents:['codex'],users:[],title:TITLE});return roomId=c.id;
}
function sleep(ms){return new Promise(function(r){setTimeout(r,ms);});}
async function ask(question,opts){
 opts=opts||{};var q=String(question||'').trim();if(!q)throw Error('اكتب سؤالك');
 var id=await ensureRoom(),key=(w.crypto&&w.crypto.randomUUID)?w.crypto.randomUUID():String(Date.now())+Math.random().toString(16).slice(2);
 var sent=await api('/rooms/'+id+'/messages',{body:q.slice(0,4000),kind:'question',targets:['codex'],request_key:key});
 var deadline=Date.now()+(opts.timeout||150000),wait=opts.interval||1500;
 while(Date.now()<deadline){
  await sleep(wait);
  var h=await api('/rooms/'+id+'/messages'),job=(h.jobs||[]).find(function(j){return j.message_id===sent.message_id;});
  if(!job)continue;
  if(job.state==='complete'&&job.text)return String(job.text);
  if(['failed','limited','cancelled','interrupted'].indexOf(job.state)>=0)throw Error(job.error||'تعذر الرد الآن');
 }
 throw Error('الرد تأخر؛ جرّب بعد قليل');
}
w.SSMPDSonoAI={probe:probe,ask:ask,enabled:function(){return usable;}};
})(window);
