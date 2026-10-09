/* Arrange existing controls without cloning fields or changing design settings. */
(function(){
 'use strict';
 var serial=0;
 function mount(root){
  var modal=root.querySelector('.modal'),layout=root.querySelector('.design-layout'),tools=layout.children[0],preview=layout.children[1];
  root.classList.add('design-editor-backdrop');modal.classList.add('design-editor');modal.removeAttribute('style');
  layout.removeAttribute('style');tools.removeAttribute('style');preview.removeAttribute('style');
  tools.className='design-editor__tools';preview.className='design-editor__preview';
  var canvas=preview.querySelector('canvas');canvas.removeAttribute('style');
  var wrap=document.createElement('div');wrap.className='design-editor__canvas';var frame=document.createElement('div');frame.className='design-editor__frame';frame.append(canvas);wrap.append(frame);preview.append(wrap);
  function sizeFrame(){var w=Math.max(0,wrap.clientWidth-20),h=Math.max(0,wrap.clientHeight-20);var width=Math.min(w,h*1080/1350);frame.style.width=width+'px';frame.style.height=(width*1350/1080)+'px';}
  var frameObserver=typeof ResizeObserver!=='undefined'?new ResizeObserver(sizeFrame):null;if(frameObserver)frameObserver.observe(wrap);
  var expand=document.createElement('button');expand.type='button';expand.className='btn ghost sm design-editor__expand';expand.textContent='تكبير التصميم';expand.setAttribute('aria-expanded','false');var toolbar=document.createElement('div');toolbar.className='design-editor__preview-toolbar';toolbar.append(expand);var boundsLabel=document.createElement('span');boundsLabel.className='design-editor__bounds-label';boundsLabel.textContent='حدود التصميم · 1080 × 1350';toolbar.append(boundsLabel);preview.prepend(toolbar);
  var tabs=document.createElement('nav');tabs.className='design-editor__tabs';tabs.setAttribute('aria-label','عناصر التصميم');layout.append(tabs);
  var footer=document.createElement('footer');footer.className='design-editor__footer';modal.append(footer);
  var feedback=document.createElement('div');feedback.className='design-editor__feedback';footer.append(feedback);
  ['[data-status]','[data-draft-status]'].forEach(function(selector){feedback.append(root.querySelector(selector));});
  var actions=document.createElement('div');actions.className='design-editor__actions';actions.append(root.querySelector('[data-download]'),root.querySelector('[data-save]'));footer.append(actions);
  var definitions=[
   ['headline','العنوان',['headline','headlineSize','headlineOffset','[data-headline-colors]']],
   ['secondaryHeadline','عنوان ثانوي',['secondaryHeadline','secondaryHeadlineSize','secondaryHeadlineOffset','[data-secondary-headline-colors]']],
   ['body','نص التصميم',['designBody','designBodySize']],
   ['subtitle','السطر التوضيحي',['subtitle','subtitleSize','subtitleOffset']],
   ['cta','التفاعل',['cta','ctaSize','ctaOffset']],
   ['image','الصورة',['[data-upload]','[data-library]','[data-images]','zoom','x','imageOffsetY','fadeStartY','fadeEndY','doctorZoom','doctorPhotoX','doctorPhotoY']],
   ['logo','اللوجو',['logoVariant','[data-logo-status]']],
   ['layout','القالب والترتيب',['layoutTemplate','dinaVariant','textOrder','titlePosition','textWidth']],
   ['generation','التوليد',['[data-prompt]','[data-quality]','.design-ai-actions']],
   ['versions','النسخ',['[data-versions]']],
   ['doctor','بيانات الدكتور',['doctorPrefix','doctorName','doctorTitle','doctorNameSize','doctorTitleSize']],
   ['schedule','المواعيد',['doctorDays','doctorTimeFrom','doctorTimeTo']],
   ['panel','بوكس النص',['[data-panel-colors]']],
   ['edges','كتلة لونية',['[data-edge-blocks]']]
  ];
  var panels=[],buttons=[],prefix='design-tool-'+(++serial)+'-';
  definitions.forEach(function(def){
   var panel=document.createElement('section');panel.className='design-editor__panel';panel.dataset.toolPanel=def[0];panel.id=prefix+def[0];
   var heading=document.createElement('h4');heading.textContent=def[1];panel.append(heading);
   def[2].forEach(function(key){
    var node=tools.querySelector(key[0]==='['||key[0]==='.'?key:'[data-field="'+key+'"]');if(!node)return;
    var unit=node.closest('.design-offset-control')||node.closest('label')||node;
    var hint=unit.nextElementSibling;
    if(['zoom','x','imageOffsetY','fadeStartY','fadeEndY','textOrder','titlePosition','textWidth','[data-library]','[data-images]'].includes(key))unit.dataset.standardOnly='';
    if(key.startsWith('doctor'))unit.dataset.doctorOnly='';
    panel.append(unit);
    if(hint&&hint.tagName==='P'&&!hint.hasAttribute('data-logo-status')&&!hint.hasAttribute('data-status')&&!hint.hasAttribute('data-draft-status')){if(unit.hasAttribute('data-standard-only'))hint.dataset.standardOnly='';if(unit.hasAttribute('data-doctor-only'))hint.dataset.doctorOnly='';panel.append(hint);}
   });
   var button=document.createElement('button');button.type='button';button.className='btn ghost sm';button.dataset.toolTab=def[0];button.textContent=def[1];button.setAttribute('aria-controls',panel.id);button.setAttribute('aria-pressed','false');button.setAttribute('aria-expanded','false');tabs.append(button);
   if(def[0]==='body'&&!panel.querySelector('[data-field=designBody]')){panel.hidden=true;button.hidden=true;}
   if(['doctor','schedule'].includes(def[0])){panel.dataset.doctorOnly='';button.dataset.doctorOnly='';panel.hidden=true;button.hidden=true;}
   if(['headline','secondaryHeadline','subtitle','cta','logo','generation','panel','edges'].includes(def[0])){panel.dataset.standardOnly='';button.dataset.standardOnly='';}
   panels.push(panel);buttons.push(button);
  });
  var help=document.createElement('details');var summary=document.createElement('summary');summary.textContent='إرشادات التعديل';help.append(summary);
  Array.from(tools.children).forEach(function(node){if(node.tagName==='DETAILS'){node.querySelectorAll('p').forEach(function(p){help.append(p);});node.remove();}else help.append(node);});
  if(help.children.length>1)panels.find(function(p){return p.dataset.toolPanel==='layout';}).append(help);
  // Move existing fields, preserving their listeners and saved values.
  function subgroups(panel){
   var key=panel.dataset.toolPanel;
   if(['headline','secondaryHeadline','subtitle','cta'].includes(key)){
    var groups=[['النص',[key]],['الحجم',[key+'Size']],['الموضع',[key+'Offset']],['اللون',[key==='secondaryHeadline'?'[data-secondary-headline-colors]':'[data-headline-colors]']]];
    groups.forEach(function(g){var nodes=[];g[1].forEach(function(k){var node=panel.querySelector(k[0]==='['?k:'[data-field="'+k+'"]');if(node)nodes.push(node.closest('.design-offset-control')||node.closest('label')||node);});if(nodes.length){var d=document.createElement('details');d.className='design-editor__subgroup';var summary=document.createElement('summary');summary.textContent=g[0];d.append(summary);nodes.forEach(function(n){d.append(n);});panel.append(d);}});
   }else if(key==='panel'){
    var container=panel.querySelector('[data-panel-colors]');
    [['نوع الخلفية',[':scope>label']],['لون الخلفية',['[data-color-control=panelColor]','[data-gradient-controls]']],['لون النص',['[data-color-control=panelTextColor]']]].forEach(function(g){var d=document.createElement('details');d.className='design-editor__subgroup';var summary=document.createElement('summary');summary.textContent=g[0];d.append(summary);g[1].forEach(function(selector){var node=container.querySelector(selector);if(node)d.append(node);});container.append(d);});
   }else if(!['edges','schedule','versions'].includes(key)){
    Array.from(panel.children).forEach(function(n){if(n.tagName==='H4'||n.tagName==='P')return;var d=document.createElement('details');d.className='design-editor__subgroup';var summary=document.createElement('summary');summary.textContent=n.tagName==='LABEL'?n.childNodes[0].textContent.trim():n.matches('[data-panel-colors]')?'ألوان خلفية النص':n.matches('[data-images]')?'الصور المتاحة':n.matches('[data-library]')?'مكتبة الصور':n.matches('[data-upload]')?'رفع صورة':n.matches('.design-ai-actions')?'توليد الصورة':n.tagName==='DETAILS'?'إرشادات التعديل':n.textContent.trim().slice(0,45)||'الإعدادات';var hint=n.nextElementSibling;['standardOnly','doctorOnly'].forEach(function(flag){if(flag in n.dataset)d.dataset[flag]='';});panel.insertBefore(d,n);d.append(summary,n);if(hint&&hint.tagName==='P'&&!hint.hasAttribute('data-logo-status'))d.append(hint);});
   }
   panel.querySelectorAll('details>summary').forEach(function(summary){summary.addEventListener('click',function(){var d=summary.parentElement;if(d.open)return;Array.from(d.parentElement.children).forEach(function(other){if(other!==d&&other.tagName==='DETAILS')other.open=false;});});});
   panel.addEventListener('toggle',function(e){var d=e.target;if(d.tagName!=='DETAILS'||!d.open)return;Array.from(d.parentElement.children).forEach(function(other){if(other!==d&&other.tagName==='DETAILS')other.open=false;});},true);
  }
  var order=['layout','image','doctor','schedule','headline','secondaryHeadline','subtitle','body','cta','panel','edges','logo','generation','versions'];
  order.forEach(function(key){var panel=panels.find(function(p){return p.dataset.toolPanel===key;}),button=buttons.find(function(b){return b.dataset.toolTab===key;});panel.querySelector('h4').remove();subgroups(panel);tools.append(button,panel);});tabs.remove();
  function select(key){var next=panels.find(function(panel){return panel.dataset.toolPanel===key;});if(root.contains(document.activeElement)&&next&&!next.contains(document.activeElement))document.activeElement.blur();panels.forEach(function(panel){panel.classList.toggle('is-active',panel.dataset.toolPanel===key);});buttons.forEach(function(button){var active=button.dataset.toolTab===key;button.setAttribute('aria-pressed',String(active));button.setAttribute('aria-expanded',String(active));});root.dataset.activeTool=key||'';}
  buttons.forEach(function(button){button.onclick=function(){select(root.dataset.activeTool===button.dataset.toolTab?null:button.dataset.toolTab);if(root.dataset.activeTool)button.scrollIntoView({block:'nearest'});};});select(null);
  function expanded(value){if(value&&root.contains(document.activeElement))document.activeElement.blur();modal.classList.toggle('is-preview-expanded',value);expand.textContent=value?'رجوع للأدوات':'تكبير التصميم';expand.setAttribute('aria-expanded',String(value));}
  expand.onclick=function(){expanded(!modal.classList.contains('is-preview-expanded'));};
  function onKey(event){if(event.key==='Escape'&&modal.classList.contains('is-preview-expanded')){event.preventDefault();event.stopImmediatePropagation();expanded(false);expand.focus();}}
  root.addEventListener('keydown',onKey,true);
  var viewport=window.visualViewport,baseline=viewport?viewport.height:window.innerHeight,viewportWidth=viewport?viewport.width:window.innerWidth;
  function fit(){
   var height=viewport?viewport.height:window.innerHeight,width=viewport?viewport.width:window.innerWidth;
   var focused=root.contains(document.activeElement)&&document.activeElement.matches('textarea,input:not([type=range]):not([type=file]),select');
   if(!focused||Math.abs(width-viewportWidth)>80){baseline=height;viewportWidth=width;}
   root.style.setProperty('--design-vh',height+'px');root.style.setProperty('--design-top',(viewport?viewport.offsetTop:0)+'px');
   root.classList.toggle('has-keyboard',width<=900&&focused&&baseline-height>100);
   if(focused){var field=document.activeElement,fieldRect=field.getBoundingClientRect(),bounds=tools.getBoundingClientRect();if(fieldRect.bottom>bounds.bottom)tools.scrollTop+=fieldRect.bottom-bounds.bottom+8;else if(fieldRect.top<bounds.top)tools.scrollTop+=fieldRect.top-bounds.top-8;}
  }
  root.addEventListener('focusin',fit);root.addEventListener('focusout',fit);window.addEventListener('resize',fit);
  if(viewport){viewport.addEventListener('resize',fit);viewport.addEventListener('scroll',fit);}fit();
  var observer=new MutationObserver(function(){if(root.isConnected)return;window.removeEventListener('resize',fit);if(frameObserver)frameObserver.disconnect();if(viewport){viewport.removeEventListener('resize',fit);viewport.removeEventListener('scroll',fit);}observer.disconnect();});observer.observe(document.body,{childList:true,subtree:true});
 }
 window.SSMPDDesignEditorLayout={mount:mount};
})();


