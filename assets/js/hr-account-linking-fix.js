/* SWNW HR account linking fix — show all active users and safely continue preliminary profiles. */
(function(){
'use strict';
if(window.__SWNWHRAccountLinkingFix)return;
window.__SWNWHRAccountLinkingFix=true;

var cache=null,loading=null;
function cairoMonth(){
  var parts={};
  new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit'}).formatToParts(new Date()).forEach(function(p){parts[p.type]=p.value;});
  return parts.year+'-'+parts.month+'-01';
}
function workspace(){
  if(cache)return Promise.resolve(cache);
  if(loading)return loading;
  if(!window.SSMPDDb||!window.SSMPDDb.client)return Promise.reject(Error('قاعدة البيانات غير جاهزة'));
  loading=window.SSMPDDb.client.rpc('hr_workspace',{p_month:cairoMonth()}).then(function(r){
    if(r.error)throw r.error;
    cache=r.data||{};
    return cache;
  }).finally(function(){loading=null;});
  return loading;
}
function displayName(a){return String(a.name||a.email||'مستخدم');}
function enhance(select){
  if(!select||select.dataset.allHrAccounts==='1')return;
  select.dataset.allHrAccounts='1';
  var original=select.value||'';
  workspace().then(function(data){
    if(!select.isConnected)return;
    var people=data.people||[],accounts=(data.accounts||[]).filter(function(a){return a.active!==false;});
    accounts.sort(function(a,b){return displayName(a).localeCompare(displayName(b),'ar');});
    var frag=document.createDocumentFragment();
    var empty=document.createElement('option');empty.value='';empty.textContent='بدون ربط';frag.appendChild(empty);
    accounts.forEach(function(a){
      var linked=people.find(function(p){return p.admin_id===a.id;}),opt=document.createElement('option'),label=displayName(a);
      opt.value=a.id;
      if(linked){
        if(a.id===original){
          label+=' — الحساب الحالي';
        }else if(linked.status==='needs_setup'&&linked.kind==='unclassified'){
          label+=' — استكمال الملف المبدئي';
          opt.dataset.preliminaryPerson=linked.id;
        }else{
          label+=' — مرتبط بملف '+String(linked.full_name||'موظف');
          opt.disabled=true;
        }
      }
      opt.textContent=label;
      frag.appendChild(opt);
    });
    select.replaceChildren(frag);
    if(original&&Array.from(select.options).some(function(o){return o.value===original&&!o.disabled;}))select.value=original;
    var label=select.closest('label');
    if(label&&!label.querySelector('[data-hr-account-help]')){
      var help=document.createElement('small');
      help.dataset.hrAccountHelp='1';
      help.style.display='block';help.style.marginTop='8px';help.style.lineHeight='1.6';help.style.color='#667085';
      help.textContent='تظهر كل الحسابات النشطة. الحساب المرتبط بملف مبدئي يمكن استكماله، والحساب المرتبط بملف مكتمل يظهر للمعرفة فقط.';
      label.appendChild(help);
    }
  }).catch(function(){select.dataset.allHrAccounts='';});
}
function scan(root){
  if(root&&root.matches&&root.matches('select[name="admin_id"]'))enhance(root);
  (root||document).querySelectorAll&& (root||document).querySelectorAll('select[name="admin_id"]').forEach(enhance);
}
var observer=new MutationObserver(function(records){records.forEach(function(r){r.addedNodes.forEach(function(n){if(n.nodeType===1)scan(n);});});});
observer.observe(document.documentElement,{childList:true,subtree:true});
scan(document);
})();
