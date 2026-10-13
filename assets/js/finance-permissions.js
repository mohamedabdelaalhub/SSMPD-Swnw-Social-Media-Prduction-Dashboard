/* Per-account module grants for the two financial roles. Supabase enforces every grant. */
(function(){
 'use strict';
 var MODULES=[['accounting','الحسابات — المستلزمات والخدمات والباقات'],['contracting_entities','جهات التعاقد'],['tasks','المهام — داخل نطاق التكليف وإدارة المشروع']];
 var ACTIONS=[['view','عرض'],['create','إضافة'],['update','تعديل'],['delete','حذف']];
 function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 async function open(admin){
  if(!window.SSMPDRoles.isSuperAdmin(window.SSMPDAuth.currentAdmin))return;
  var root=document.createElement('div');root.className='modal-backdrop';root.style.zIndex=10003;
  root.innerHTML='<section class="modal" style="width:min(720px,96vw)" dir="rtl"><div class="modal-head"><h3>صلاحيات '+esc(admin.name||admin.email)+'</h3><button class="modal-close" type="button" aria-label="إغلاق">×</button></div><p>اختار صلاحيات كل قسم لهذا الحساب. العرض مطلوب قبل تفعيل أي إجراء. الدور المالي وحده لا يمنح صلاحيات.</p><div data-permission-list>جاري تحميل الصلاحيات…</div><p role="status" data-permission-status></p><button class="btn" data-permission-save disabled>حفظ الصلاحيات</button></section>';
  root.querySelector('.modal-close').onclick=function(){root.remove();};document.body.appendChild(root);
  var save=root.querySelector('[data-permission-save]'),status=root.querySelector('[data-permission-status]');
  try{var rows=await window.SSMPDDb.listModulePermissions(admin.id);if(!root.isConnected)return;
   root.querySelector('[data-permission-list]').innerHTML=MODULES.map(function(m){var row=(rows||[]).find(function(r){return r.module_key===m[0];})||{};return '<fieldset data-permission-module="'+m[0]+'" style="margin:12px 0;padding:12px;border:1px solid var(--c-border);border-radius:10px"><legend>'+m[1]+'</legend><div style="display:flex;flex-wrap:wrap;gap:16px">'+ACTIONS.map(function(a){var unsupported=m[0]==='tasks'&&a[0]==='delete';return '<label style="display:inline-flex;align-items:center;gap:6px"><input type="checkbox" data-permission-action="'+a[0]+'" '+(row['can_'+a[0]]&&!unsupported?'checked ':'')+(unsupported?'disabled ':'')+'>'+a[1]+(unsupported?' — غير متاح':'')+'</label>';}).join('')+'</div>'+(m[0]==='tasks'?'<p>التعديل يشمل تحديث الحالة والمراجعة عندما يكون الحساب مدير المشروع. لا يمنح رؤية مهام الموظفين الآخرين خارج هذا النطاق.</p>':'')+'</fieldset>';}).join('');
   function sync(){root.querySelectorAll('[data-permission-module]').forEach(function(group){var view=group.querySelector('[data-permission-action="view"]').checked;group.querySelectorAll('[data-permission-action]').forEach(function(input){if(input.dataset.permissionAction==='view')return;var unsupported=group.dataset.permissionModule==='tasks'&&input.dataset.permissionAction==='delete';input.disabled=!view||unsupported;if(!view||unsupported)input.checked=false;});});}
   root.querySelectorAll('[data-permission-action="view"]').forEach(function(input){input.onchange=sync;});sync();save.disabled=false;
   save.onclick=async function(){save.disabled=true;root.querySelectorAll('input').forEach(function(input){input.disabled=true;});var permissions=MODULES.map(function(m){var group=root.querySelector('[data-permission-module="'+m[0]+'"]'),out={module_key:m[0]};ACTIONS.forEach(function(a){out['can_'+a[0]]=group.querySelector('[data-permission-action="'+a[0]+'"]').checked;});return out;});try{await window.SSMPDDb.saveModulePermissions(admin.id,permissions);status.textContent='تم حفظ الصلاحيات. تظهر في حساب الموظف بعد تحديث الصفحة.';}catch(e){status.textContent=e.message||'تعذر حفظ الصلاحيات';}finally{save.disabled=false;root.querySelectorAll('[data-permission-action="view"]').forEach(function(i){i.disabled=false;});sync();}};
  }catch(e){status.textContent='تعذر تحميل الصلاحيات. شغّل ملف تفعيل الأدوار المالية في Supabase ثم أعد فتح النافذة.';}
 }
 window.SSMPDFinancePermissions={open:open};
})();
