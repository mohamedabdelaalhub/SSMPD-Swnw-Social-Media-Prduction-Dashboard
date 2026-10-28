/* SWNW — lightweight client-side error monitor for System Diagnostics */
(function () {
  "use strict";
  if (window.__SWNWSystemErrorMonitor) return;
  window.__SWNWSystemErrorMonitor = true;

  var STORAGE_KEY = "swnw_system_errors_v1";
  var MAX_ITEMS = 24;
  var STATUS_WINDOW = 24 * 60 * 60 * 1000;
  var lastAction = null, lastFingerprint = "", lastFingerprintAt = 0;
  var requestVersion = 0, mutationVersion = 0, errorVersion = 0;

  function cleanText(value, max) {
    var s = String(value == null ? "" : value);
    s = s.replace(/eyJ[A-Za-z0-9_\-.]{20,}/g, "[token-hidden]");
    s = s.replace(/([?&](?:apikey|api_key|token|access_token|refresh_token|key|secret)=)[^&#\s]+/ig, "$1[hidden]");
    s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, "[email-hidden]");
    s = s.replace(/https?:\/\/([^\s/?#]+)([^\s?#]*)[^\s]*/ig, function (_, host, path) { return "https://" + host + (path || ""); });
    return s.replace(/\s+/g, " ").trim().slice(0, max || 260);
  }
  function load() { try { var x=JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]"); return Array.isArray(x)?x:[]; } catch (_) { return []; } }
  function save(items) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0,MAX_ITEMS))); } catch (_) {} emitStatus(); }
  function currentPage() {
    var n=document.querySelector("#view-container h1,#view-container h2,main h1,main h2");
    return cleanText(n?n.textContent:document.title,90)||"الداشبورد";
  }
  function classify(message, meta) {
    var m=String(message||""), lower=m.toLowerCase(), status=meta&&meta.status;
    if(/failed to fetch|networkerror|network request failed|load failed|fetch failed/.test(lower)) return {severity:"red",title:"مشكلة اتصال",simple:"الجهاز لم يستطع الوصول إلى الخدمة المطلوبة.",solution:"افتح تشخيص النظام. جرّب شبكة أخرى أو أوقف VPN/Content Filter ثم أعد المحاولة."};
    if(/timeout|timed out|aborterror/.test(lower)) return {severity:"red",title:"الاتصال استغرق وقتًا طويلًا",simple:"الطلب لم يكتمل في الوقت المتوقع.",solution:"أعد المحاولة مرة واحدة. لو تكرر، شغّل تشخيص النظام وافحص الشبكة والخدمة المتأثرة."};
    if(status===401||/unauthorized|jwt|session.*expired|invalid.*token/.test(lower)) return {severity:"orange",title:"الجلسة تحتاج تجديد",simple:"الجلسة الحالية لم تعد صالحة لتنفيذ العملية.",solution:"حدّث الصفحة وسجّل الدخول من جديد، ثم أعد نفس الخطوة."};
    if(status===403||/forbidden|permission|row.level|rls|not allowed|access denied/.test(lower)) return {severity:"orange",title:"صلاحية غير كافية",simple:"الحساب الحالي لا يملك الصلاحية المطلوبة لهذه العملية.",solution:"اطلب من المسؤول منح الصلاحية المناسبة، ثم أعد نفس الخطوة. عند نجاحها يعود المؤشر للأخضر."};
    if(status===404||/not found|does not exist/.test(lower)) return {severity:"orange",title:"العنصر غير موجود",simple:"البيانات أو المسار المطلوب غير موجود أو لم يتم تحميله.",solution:"حدّث الصفحة وابحث عن العنصر من جديد. لو استمر، أرسل تقرير التشخيص."};
    if(status===409||/duplicate|unique constraint|already exists/.test(lower)) return {severity:"orange",title:"بيانات مكررة",simple:"النظام رفض إنشاء سجل مكرر.",solution:"ابحث عن السجل الموجود وعدّله بدل إنشاء نسخة جديدة."};
    if(status===429||/rate limit|too many requests/.test(lower)) return {severity:"orange",title:"طلبات كثيرة في وقت قصير",simple:"الخدمة طلبت تقليل عدد المحاولات مؤقتًا.",solution:"انتظر قليلًا ثم أعد المحاولة مرة واحدة."};
    if((status&&status>=500)||/internal server|service unavailable|bad gateway|gateway timeout/.test(lower)) return {severity:"red",title:"عطل مؤقت بالخادم",simple:"الخادم استقبل الطلب لكنه لم يستطع إكماله.",solution:"أعد المحاولة بعد تحديث الصفحة. لو تكرر، شغّل تشخيص النظام."};
    if(/cannot read|undefined|null is not|is not a function|typeerror|referenceerror/.test(lower)) return {severity:"red",title:"خطأ في واجهة الداشبورد",simple:"جزء من الواجهة واجه خطأ برمجيًا أثناء التنفيذ.",solution:"حدّث الصفحة وجرب نفس الخطوة. لو تكرر بنفس الزر، أرسل تقرير التشخيص."};
    if(meta&&meta.kind==="noop") return {severity:"orange",title:"الزر لم يستجب",simple:"تم الضغط على الزر لكن لم يظهر تنفيذ أو طلب شبكة خلال الوقت المتوقع.",solution:"جرّب الزر مرة أخرى. لو ظل بلا استجابة افتح تشخيص النظام؛ قد تكون صلاحية أو خطأ في الواجهة."};
    return {severity:"orange",title:"العملية لم تكتمل",simple:"حدث خطأ أثناء تنفيذ العملية.",solution:"أعد المحاولة مرة واحدة. لو تكرر افتح تشخيص النظام وأرسل التقرير."};
  }
  function activeItems() {
    var now=Date.now(); return load().filter(function(x){return !x.resolved && (!x.ts||now-new Date(x.ts).getTime()<STATUS_WINDOW);});
  }
  function status() {
    var items=activeItems();
    if(items.some(function(x){return x.severity==="red";})) return {level:"red",count:items.length};
    if(items.length) return {level:"orange",count:items.length};
    return {level:"green",count:0};
  }
  function emitStatus() { try { window.dispatchEvent(new CustomEvent("swnw:diagnostic-status",{detail:status()})); } catch (_) {} }
  function showHint(entry) {
    var old=document.getElementById("swnw-error-diagnostic-hint"); if(old)old.remove();
    var box=document.createElement("button"); box.id="swnw-error-diagnostic-hint"; box.type="button";
    box.textContent=(entry.severity==="red"?"🔴 ":"🟠 ")+entry.title+" — عرض الحل";
    box.style.cssText="position:fixed;z-index:2147483000;left:16px;bottom:16px;max-width:min(420px,calc(100vw - 32px));padding:11px 14px;border:1px solid #f0b4ae;border-radius:12px;background:#fff7f6;color:#8f261d;font:700 13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Tahoma,Arial,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.12);cursor:pointer;";
    box.onclick=function(){window.open("connection-test.html#recent-errors","_blank","noopener,noreferrer");}; document.body.appendChild(box);
    setTimeout(function(){if(box.isConnected)box.remove();},9000);
  }
  function record(kind,message,meta) {
    var safe=cleanText(message,320); if(!safe)return; meta=meta||{}; meta.kind=meta.kind||kind;
    var cls=classify(safe,meta), action=lastAction&&Date.now()-lastAction.ts<12000?lastAction.label:"";
    var fp=kind+"|"+safe+"|"+action+"|"+(meta.status||""); var now=Date.now();
    if(fp===lastFingerprint&&now-lastFingerprintAt<5000)return; lastFingerprint=fp; lastFingerprintAt=now; errorVersion++;
    var entry={id:"e"+now+Math.random().toString(36).slice(2,7),ts:new Date(now).toISOString(),kind:cleanText(kind,40),severity:cls.severity,title:cls.title,simple:cls.simple,solution:cls.solution,action:cleanText(action,100),page:currentPage(),technical:safe,status:meta.status||null,endpoint:meta.endpoint?cleanText(meta.endpoint,160):"",resolved:false,resolvedAt:null};
    var items=load(); items.unshift(entry); save(items); if(document.body)showHint(entry);
    try{window.dispatchEvent(new CustomEvent("swnw:diagnostic-error",{detail:entry}));}catch(_){}
  }
  function resolveWhere(predicate) {
    var items=load(), changed=false, now=new Date().toISOString();
    items.forEach(function(x){if(!x.resolved&&predicate(x)){x.resolved=true;x.resolvedAt=now;changed=true;}}); if(changed)save(items);
  }
  function resolveEndpoint(endpoint) { if(endpoint)resolveWhere(function(x){return x.endpoint===endpoint;}); }
  function resolveAction(action) { if(action)resolveWhere(function(x){return x.action===action;}); }
  function actionLabel(el) { if(!el)return ""; return cleanText(el.getAttribute("aria-label")||el.getAttribute("title")||el.textContent||el.value||"",100); }

  var observer=new MutationObserver(function(){mutationVersion++;});
  if(document.documentElement)observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:["class","hidden","disabled","aria-expanded"]});

  document.addEventListener("click",function(event){
    var target=event.target&&event.target.closest?event.target.closest("button,[role='button'],input[type='submit'],a"):null; if(!target)return;
    if(target.closest("#swnw-error-diagnostic-hint")||target.id==="system-diagnostics-toggle")return;
    var label=actionLabel(target); if(!label)return; lastAction={label:label,ts:Date.now()};
    if(target.tagName==="A"&&target.getAttribute("href"))return;
    var m0=mutationVersion,r0=requestVersion,e0=errorVersion,action=label;
    setTimeout(function(){
      if(errorVersion!==e0)return;
      if(requestVersion!==r0||mutationVersion!==m0){resolveAction(action);return;}
      if(target.isConnected&&!target.disabled)record("noop","No visible response after action: "+action,{kind:"noop"});
    },3200);
  },true);

  window.addEventListener("error",function(event){var m=event&&(event.message||(event.error&&event.error.message));if(m)record("javascript",m,{});});
  window.addEventListener("unhandledrejection",function(event){var r=event&&event.reason;record("promise",r&&r.message?r.message:r,{});});

  if(window.fetch&&!window.fetch.__swnwErrorMonitorWrapped){
    var nativeFetch=window.fetch;
    var wrapped=function(input,init){
      requestVersion++; var method=(init&&init.method)||"GET",endpoint="";
      try{var u=new URL(typeof input==="string"?input:input.url,location.href);endpoint=u.origin+u.pathname;}catch(_){}
      return nativeFetch.apply(this,arguments).then(function(res){
        if(res&&res.ok)resolveEndpoint(endpoint); else if(res&&res.status>=400)record("http","HTTP "+res.status+" أثناء "+method,{status:res.status,endpoint:endpoint}); return res;
      }).catch(function(err){record("network",err&&err.message?err.message:err,{endpoint:endpoint});throw err;});
    };
    wrapped.__swnwErrorMonitorWrapped=true; window.fetch=wrapped;
  }
  function patchToast(){
    var T=window.SSMPDToast;if(!T||typeof T.show!=="function"||T.show.__swnwErrorMonitorWrapped)return false;
    var original=T.show,wrapped=function(message,type){if(String(type||"").toLowerCase()==="error")record("toast",message,{});return original.apply(this,arguments);};
    wrapped.__swnwErrorMonitorWrapped=true;T.show=wrapped;return true;
  }
  var tries=0;(function waitToast(){tries++;if(patchToast()||tries>=24)return;setTimeout(waitToast,250);})();
  window.addEventListener("storage",function(e){if(e.key===STORAGE_KEY)emitStatus();});

  window.SWNWErrorMonitor={getRecent:load,getActive:activeItems,getStatus:status,clear:function(){try{localStorage.removeItem(STORAGE_KEY);}catch(_){}emitStatus();},resolveEndpoint:resolveEndpoint,resolveAction:resolveAction,resolveWhere:resolveWhere,record:record,storageKey:STORAGE_KEY};
  emitStatus();
})();
