/* Legal documents hub (read-only): lists the public privacy/terms pages per system with view + copy-link actions. No data access, no editing. */
(function(root){'use strict';
var DOCS=[
 {system:'Swnw Server Backups',note:'النسخ الاحتياطي لخوادم المركز على Google Drive (تطبيق داخلي للمسؤول) — يُنشر على نطاق مستقل legal.swnwclinics.com.',items:[
  {kind:'الخصوصية',title:'سياسة الخصوصية',url:'https://legal.swnwclinics.com/privacy'},
  {kind:'الشروط',title:'شروط الاستخدام',url:'https://legal.swnwclinics.com/terms'}]},
 {system:'لوحة إنتاج المحتوى SSMPD',note:'لوحة تنظيم ونشر محتوى السوشيال ميديا (ربط TikTok).',items:[
  {kind:'الخصوصية',title:'سياسة الخصوصية',file:'privacy.html'},
  {kind:'الشروط',title:'شروط الاستخدام',file:'terms.html'}]},
 {system:'Swnw Social Publisher',note:'النشر الآلي على صفحات Meta (Facebook وInstagram).',items:[
  {kind:'الخصوصية',title:'Privacy Policy',file:'privacy-policy.html',en:true},
  {kind:'حذف البيانات',title:'Data Deletion Instructions',file:'data-deletion.html',en:true}]}
];
function node(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;}
function publicUrl(file){return new URL(file,document.baseURI).href;}
function copyText(text){
 if(root.navigator&&navigator.clipboard&&navigator.clipboard.writeText&&root.isSecureContext)return navigator.clipboard.writeText(text);
 return new Promise(function(resolve,reject){var t=document.createElement('textarea');t.value=text;t.setAttribute('readonly','');t.style.position='fixed';t.style.opacity='0';document.body.appendChild(t);t.select();var ok=false;try{ok=document.execCommand('copy');}catch(e){}document.body.removeChild(t);ok?resolve():reject(new Error('copy failed'));});
}
function mount(host){
 if(!host||host.querySelector('.ld-hub'))return;
 var hub=node('div','ld-hub'),status=node('p','ld-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 hub.append(node('p','ld-intro','صفحات الخصوصية والشروط العامة لكل نظام. الصفحات متاحة للعامة بدون تسجيل دخول، ويمكن عرضها ونسخ روابطها (للقراءة فقط).'),status);
 DOCS.forEach(function(group){
  var card=node('section','ld-group');card.setAttribute('aria-label',group.system);
  var head=node('header','ld-head'),title=node('strong','',group.system);
  if(/^[A-Za-z]/.test(group.system))title.className='ld-en';
  head.append(title,node('span','',group.note));card.appendChild(head);
  group.items.forEach(function(doc){
   var url=doc.url||publicUrl(doc.file),row=node('div','ld-row'),info=node('div','ld-info'),name=node('span',doc.en?'ld-en':'',doc.title),kind=node('small','',doc.kind),link=node('code','ld-url',url);
   info.append(name,kind,link);
   var actions=node('div','ld-actions'),view=node('a','btn ghost sm','عرض');view.href=url;view.target='_blank';view.rel='noopener';view.setAttribute('aria-label','عرض '+doc.title+' — '+group.system);
   var copy=node('button','btn ghost sm','نسخ الرابط');copy.type='button';copy.setAttribute('aria-label','نسخ رابط '+doc.title+' — '+group.system);
   copy.onclick=function(){copyText(url).then(function(){status.textContent='تم نسخ رابط: '+doc.title+' ('+group.system+')';status.className='ld-status ok';}).catch(function(){status.textContent='تعذّر النسخ تلقائيًا؛ انسخ الرابط يدويًا من السطر الظاهر.';status.className='ld-status err';});};
   actions.append(view,copy);row.append(info,actions);card.appendChild(row);
  });
  hub.appendChild(card);
 });
 host.appendChild(hub);
}
root.SSMPDLegalDocs={mount:mount,docs:DOCS,publicUrl:publicUrl};
})(window);
