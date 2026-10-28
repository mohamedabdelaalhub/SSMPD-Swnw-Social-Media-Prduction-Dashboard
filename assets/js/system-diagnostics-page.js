(function(){
  'use strict';

  var ERROR_KEY='swnw_system_errors_v1';
  var SUPER_MARKER='swnw_diag_super_v1';
  var SUPA='https://uuijfbpgvtdxgaosqpxo.supabase.co';
  var DRIVE='https://script.google.com/macros/s/AKfycbzEs73BE101-gIlSx_qwdF625nSalQ2i6mob7mGqH3oN4x40NlZoowjNta3KtKaXYjTYA/exec';
  var results={};
  var isSuper=false;

  var E={
    overall:document.getElementById('overall'),
    report:document.getElementById('report'),
    diag:document.getElementById('diagnosis'),
    steps:document.getElementById('steps'),
    errors:document.getElementById('errors'),
    copy:document.getElementById('copy'),
    download:document.getElementById('download'),
    services:document.getElementById('service-details-panel')
  };

  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function loadErrors(){try{var x=JSON.parse(localStorage.getItem(ERROR_KEY)||'[]');return Array.isArray(x)?x:[];}catch(_){return[];}}
  function renderErrors(){
    var items=loadErrors().slice(0,12);
    if(!items.length){E.errors.innerHTML='<div class="empty">لا توجد أخطاء مسجلة على هذا الجهاز حاليًا.</div>';return;}
    E.errors.innerHTML=items.map(function(x){
      var t='';try{t=new Date(x.ts).toLocaleString('ar-EG');}catch(_){}
      var cls=x.resolved?'green':(x.severity==='red'?'red':'orange');
      return '<article class="error-card '+(x.resolved?'resolved':'')+'"><div class="error-head"><div class="error-title '+cls+'">'+(x.resolved?'✓ تم الحل — ':'')+esc(x.title||'خطأ')+'</div><span class="error-time">'+esc(t)+'</span></div>'+
        (x.action?'<div class="line"><b>أثناء:</b> '+esc(x.action)+'</div>':'')+
        (x.page?'<div class="line"><b>القسم:</b> '+esc(x.page)+'</div>':'')+
        '<div class="line"><b>المعنى:</b> '+esc(x.simple||'')+'</div><div class="solution"><b>الحل المقترح:</b> '+esc(x.solution||'')+'</div>'+
        (isSuper?'<details class="tech"><summary>التفاصيل التقنية</summary><pre>'+esc(x.technical||'')+'</pre></details>':'')+'</article>';
    }).join('');
  }

  function browser(){
    var u=navigator.userAgent||'';
    if(/Firefox\//.test(u))return'Firefox '+((u.match(/Firefox\/([\d.]+)/)||[])[1]||'');
    if(/Edg\//.test(u))return'Edge '+((u.match(/Edg\/([\d.]+)/)||[])[1]||'');
    if(/Chrome\//.test(u))return'Chrome '+((u.match(/Chrome\/([\d.]+)/)||[])[1]||'');
    if(/Safari\//.test(u))return'Safari '+((u.match(/Version\/([\d.]+)/)||[])[1]||'');
    return'غير محدد';
  }
  function net(){
    var c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;if(!c)return'غير متاح';
    var p=[];if(c.effectiveType)p.push(c.effectiveType);if(c.downlink)p.push(c.downlink+' Mbps');if(c.rtt)p.push('RTT '+c.rtt+'ms');return p.join(' • ')||'غير متاح';
  }
  function card(id){return document.querySelector('.test[data-id="'+id+'"]');}
  function setCard(id,state,title,detail,ms){var n=card(id);if(!n)return;n.className='test '+state;n.querySelector('.status').textContent=title;n.querySelector('.detail').textContent=detail;n.querySelector('.latency').textContent=typeof ms==='number'?'زمن الاستجابة: '+ms+' ms':'';}

  async function ping(url,opt,timeout){
    var c=new AbortController(),timer=setTimeout(function(){c.abort();},timeout||7000),s=performance.now();
    try{var r=await fetch(url,Object.assign({cache:'no-store',signal:c.signal},opt||{}));if(r.body&&r.body.cancel)try{r.body.cancel();}catch(_){}return{ok:true,status:r.status,ms:Math.round(performance.now()-s)};}
    catch(e){return{ok:false,error:String((e&&e.name?e.name+': ':'')+(e&&e.message?e.message:e)),ms:Math.round(performance.now()-s)};}
    finally{clearTimeout(timer);}
  }
  async function httpTest(id,url,opt){
    setCard(id,'','جاري…','يتم الاختبار الآن.',null);
    var r=await ping(url,opt&&opt.fetch,opt&&opt.timeout);
    var ok=r.ok&&(!opt||!opt.require2xx||(r.status>=200&&r.status<400));
    results[id]={ok:ok,status:r.status||null,ms:r.ms,error:r.error||''};
    setCard(id,ok?'ok':'bad',ok?'سليم':'فشل',ok?((opt&&opt.ok)||'الاتصال ناجح'):(r.error||('HTTP '+r.status)),r.ms);
    return results[id];
  }
  function storageTest(){
    var s=performance.now(),k='__swnw_diag_'+Date.now();
    try{localStorage.setItem(k,'1');localStorage.removeItem(k);var ms=Math.round(performance.now()-s);results.storage={ok:true,ms:ms};setCard('storage','ok','سليم','Local Storage يعمل بدون قراءة أي بيانات محفوظة.',ms);}
    catch(e){var ms=Math.round(performance.now()-s);results.storage={ok:false,ms:ms,error:String(e)};setCard('storage','bad','فشل','المتصفح يمنع Local Storage.',ms);}
  }

  function diagnosis(){
    var bad=Object.keys(results).filter(function(k){return !results[k].ok;});
    var supa=bad.indexOf('supabase-auth')>=0||bad.indexOf('supabase-api')>=0;
    var gh=bad.indexOf('pages')>=0||bad.indexOf('asset')>=0;
    var cdn=bad.indexOf('jsdelivr')>=0||bad.indexOf('cdnjs')>=0;
    var txt,steps=[];E.overall.className='health-badge';
    if(!bad.length){txt='كل الاختبارات الأساسية سليمة.';steps=['لو المشكلة متقطعة، شغّل الفحص وقت ظهورها وشارك التقرير.'];E.overall.classList.add('ok');E.overall.textContent='النظام سليم';}
    else if(supa&&!gh){txt='الموقع يصل للجهاز لكن خدمات النظام الأساسية لا تصل.';steps=['جرّب Hotspot من الموبايل.','أوقف VPN أو Content Filter مؤقتًا.','أعد الفحص ثم أرسل التقرير إذا استمرت المشكلة.'];E.overall.classList.add('bad');E.overall.textContent='مشكلة اتصال';}
    else if(gh){txt='فيه مشكلة في الوصول إلى موقع الداشبورد أو ملفاته.';steps=['جرّب شبكة مختلفة.','أعد تحميل الصفحة ثم شغّل الفحص مرة أخرى.'];E.overall.classList.add('bad');E.overall.textContent='مشكلة تحميل الموقع';}
    else if(cdn){txt='الموقع يعمل لكن إحدى خدمات التحميل الخارجية لا تصل.';steps=['جرّب شبكة أخرى أو أوقف فلتر المحتوى مؤقتًا.','أرسل التقرير للدعم إذا استمرت المشكلة.'];E.overall.classList.add('warn');E.overall.textContent='عطل جزئي';}
    else{txt='فيه عطل جزئي يحتاج مراجعة.';steps=['انسخ تقرير التشخيص وأرسله للدعم.'];E.overall.classList.add('warn');E.overall.textContent='عطل جزئي';}
    E.diag.textContent=txt;E.steps.innerHTML=steps.map(function(s){return'<li>'+s+'</li>';}).join('');
  }

  function report(){
    var lines=['SWNW SYSTEM DIAGNOSTICS','Time: '+new Date().toISOString(),'Browser: '+browser(),'Online: '+String(navigator.onLine),'Network: '+net(),''];
    if(isSuper){
      lines.push('Service details:');
      Object.keys(results).forEach(function(k){var r=results[k];lines.push(k+': '+(r.ok?'OK':'FAIL')+' | '+(r.status||'')+' | '+(typeof r.ms==='number'?r.ms+'ms':'')+(r.error?' | '+r.error:''));});
    }else{
      var failed=Object.keys(results).filter(function(k){return !results[k].ok;}).length;
      lines.push('Overall: '+(failed?'ISSUE DETECTED':'OK'));
      lines.push('Failed checks count: '+failed);
    }
    var active=loadErrors().filter(function(x){return !x.resolved;}).slice(0,8);
    if(active.length){lines.push('','Recent unresolved errors:');active.forEach(function(x){lines.push('- '+(x.title||'Error')+' | '+(x.action||'')+' | '+(x.simple||''));});}
    E.report.value=lines.join('\n');E.copy.disabled=false;E.download.disabled=false;
  }

  async function run(){
    document.getElementById('when').textContent=new Date().toLocaleString('ar-EG');
    E.overall.className='health-badge';E.overall.textContent='جاري الفحص…';results={};storageTest();
    await Promise.all([
      httpTest('pages','./?diag='+Date.now(),{ok:'GitHub Pages متاح.'}),
      httpTest('asset','assets/img/mark.svg?diag='+Date.now(),{ok:'ملفات المشروع تتحمل بنجاح.'}),
      httpTest('supabase-auth',SUPA+'/auth/v1/health',{ok:'خدمة Auth قابلة للوصول.'}),
      httpTest('supabase-api',SUPA+'/rest/v1/',{ok:'واجهة البيانات قابلة للوصول.'}),
      httpTest('jsdelivr','https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js',{fetch:{mode:'no-cors'},ok:'jsDelivr قابل للوصول.'}),
      httpTest('cdnjs','https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',{fetch:{mode:'no-cors'},ok:'cdnjs قابل للوصول.'}),
      httpTest('drive',DRIVE,{fetch:{mode:'no-cors'},ok:'Google Apps Script قابل للوصول.'})
    ]);
    diagnosis();report();
  }

  function findSession(x){
    if(!x||typeof x!=='object')return null;
    if(x.access_token&&x.user&&x.user.id)return x;
    if(Array.isArray(x)){for(var i=0;i<x.length;i++){var a=findSession(x[i]);if(a)return a;}}
    else{for(var k in x){if(Object.prototype.hasOwnProperty.call(x,k)){var b=findSession(x[k]);if(b)return b;}}}
    return null;
  }
  function storedSession(){
    for(var i=0;i<localStorage.length;i++){
      var key=localStorage.key(i)||'';
      if(key.indexOf('sb-')===0&&key.indexOf('-auth-token')>0){try{var s=findSession(JSON.parse(localStorage.getItem(key)||'null'));if(s)return s;}catch(_){}}
    }
    return null;
  }
  function applyAccess(){
    if(E.services)E.services.hidden=!isSuper;
    renderErrors();
  }
  async function verifySuper(){
    try{isSuper=sessionStorage.getItem(SUPER_MARKER)==='1';}catch(_){}
    applyAccess();
    try{
      var session=storedSession();
      if(!session||!session.access_token)return;
      var cfg=await fetch('config.js?diag-role='+Date.now(),{cache:'no-store'}).then(function(r){return r.text();});
      var m=cfg.match(/anonKey\s*:\s*["']([^"']+)["']/);if(!m)return;
      var headers={apikey:m[1],Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'};
      var rpc=await fetch(SUPA+'/rest/v1/rpc/is_super',{method:'POST',headers:headers,body:'{}',cache:'no-store'});
      if(rpc.ok){
        var value=await rpc.json();
        isSuper=(value===true||value==='true');
      }else if(session.user&&session.user.id){
        var url=SUPA+'/rest/v1/admins?select=role,active&user_id=eq.'+encodeURIComponent(session.user.id)+'&limit=1';
        var res=await fetch(url,{headers:headers,cache:'no-store'});
        if(res.ok){var rows=await res.json();isSuper=!!(rows&&rows[0]&&rows[0].active&&rows[0].role==='super_admin');}
      }
      try{sessionStorage.setItem(SUPER_MARKER,isSuper?'1':'0');}catch(_){}
      applyAccess();
    }catch(_){applyAccess();}
  }

  document.getElementById('online').textContent=navigator.onLine?'متصل':'غير متصل';
  document.getElementById('browser').textContent=browser();
  document.getElementById('network').textContent=net();
  document.getElementById('run').onclick=run;
  document.getElementById('clear').onclick=function(){try{localStorage.removeItem(ERROR_KEY);}catch(_){}renderErrors();};
  E.copy.onclick=async function(){try{await navigator.clipboard.writeText(E.report.value);this.textContent='✓ تم النسخ';setTimeout(()=>this.textContent='📋 نسخ التقرير',1500);}catch(_){E.report.select();document.execCommand('copy');}};
  E.download.onclick=function(){var b=new Blob([E.report.value],{type:'text/plain;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='swnw-system-diagnostics.txt';a.click();setTimeout(function(){URL.revokeObjectURL(a.href);},1000);};
  if(location.hash==='#recent-errors')document.getElementById('recent-errors').scrollIntoView({behavior:'smooth'});
  verifySuper();
})();