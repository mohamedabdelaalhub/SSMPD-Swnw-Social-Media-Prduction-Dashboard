/* Progressive enhancement for the personal-home welcome card. Keeps existing data and handlers intact. */
(function(w,d){
'use strict';
var VERSION='home-welcome-20261025-1';
var CSS_ID='home-welcome-redesign-css';
var retryTimer=0;

function ensureCss(){
 if(d.getElementById(CSS_ID))return;
 var link=d.createElement('link');
 link.id=CSS_ID;
 link.rel='stylesheet';
 link.href='assets/css/home-welcome-redesign.css?v='+VERSION;
 d.head.appendChild(link);
}

function currentAdmin(){
 return w.SSMPDAuth&&w.SSMPDAuth.currentAdmin?w.SSMPDAuth.currentAdmin:null;
}

function mountPhoto(profile){
 if(!profile||profile.dataset.photoMounted==='1')return;
 var admin=currentAdmin();
 if(admin&&w.SSMPDStaffProfile&&typeof w.SSMPDStaffProfile.mount==='function'){
  profile.dataset.photoMounted='1';
  w.SSMPDStaffProfile.mount(profile,admin.id);
  return;
 }
 clearTimeout(retryTimer);
 retryTimer=setTimeout(function(){
  if(profile.isConnected)mountPhoto(profile);
 },80);
}

function enhance(welcome){
 if(!welcome||welcome.dataset.welcomeRedesign==='1')return;
 var hello=welcome.querySelector('.ph-hello');
 var tools=welcome.querySelector('.ph-welcome-tools');
 if(!hello||!tools)return;

 welcome.dataset.welcomeRedesign='1';
 welcome.classList.add('ph-welcome-redesign');
 var admin=currentAdmin();
 if(admin&&admin.role==='super_admin')welcome.classList.add('ph-is-super-admin');

 var roles=hello.querySelector('.account-roles, .ph-role');
 var meta=d.createElement('div');
 meta.className='ph-welcome-meta';
 if(roles)meta.appendChild(roles);
 meta.appendChild(tools);
 hello.appendChild(meta);

 var settings=tools.querySelector('[data-home-settings]');
 if(settings){
  settings.title=d.documentElement.lang==='en'?'Settings':'الإعدادات';
  settings.setAttribute('aria-label',settings.title);
  var label=settings.querySelector('[data-home-label="settings"]');
  if(label)label.setAttribute('aria-hidden','true');
 }
 var reload=tools.querySelector('[data-home-reload]');
 if(reload){
  reload.title=d.documentElement.lang==='en'?'Refresh':'تحديث';
  reload.setAttribute('aria-label',reload.title);
 }

 var profile=d.createElement('div');
 profile.className='ph-welcome-profile';
 profile.setAttribute('aria-label',d.documentElement.lang==='en'?'Profile photo':'الصورة الشخصية');
 welcome.appendChild(profile);
 mountPhoto(profile);
}

function scan(root){
 if(!root)return;
 if(root.nodeType===1&&root.matches&&root.matches('.ph-welcome'))enhance(root);
 if(root.querySelectorAll)root.querySelectorAll('.ph-welcome').forEach(enhance);
}

function start(){
 ensureCss();
 scan(d);
 var target=d.getElementById('app-root')||d.body;
 if(!target)return;
 var observer=new MutationObserver(function(records){
  records.forEach(function(record){
   record.addedNodes.forEach(scan);
  });
 });
 observer.observe(target,{childList:true,subtree:true});
 d.addEventListener('ssmpd:languagechange',function(){
  d.querySelectorAll('.ph-welcome-redesign').forEach(function(welcome){
   var settings=welcome.querySelector('[data-home-settings]');
   var reload=welcome.querySelector('[data-home-reload]');
   var profile=welcome.querySelector('.ph-welcome-profile');
   var en=d.documentElement.lang==='en';
   if(settings){settings.title=en?'Settings':'الإعدادات';settings.setAttribute('aria-label',settings.title);}
   if(reload){reload.title=en?'Refresh':'تحديث';reload.setAttribute('aria-label',reload.title);}
   if(profile)profile.setAttribute('aria-label',en?'Profile photo':'الصورة الشخصية');
  });
 });
}

if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',start,{once:true});
else start();
})(window,document);
