/* One back arrow for every main screen (owner 2026-11-26 «وفي كل الشاشات الرئيسية كذلك», mockup docs/ui-references/mockups/accounting-back-arrow.html, help 298).
   Client-only session history: app.js switchTab() calls SSMPDBackNav.record(tab); the arrow goes back to the previous main screen via
   SSMPDGotoTab. A screen with its own sub-history (the accounting shell sections) registers it with setLocal({canBack, back}) and the
   same arrow steps through it first. Always present (rule 10), greyed when there is nowhere to go. No RPC, no storage. */
(function(w,d){'use strict';
var stack=[],cur='',going=false,local=null,MAX=30;
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function canBack(){return !!((local&&local.canBack&&local.canBack())||stack.length);}
function button(){var b=d.getElementById('back-nav-btn');if(b)return b;var tools=d.querySelector('.topbar-tools');if(!tools)return null;
 b=d.createElement('button');b.type='button';b.id='back-nav-btn';b.className='btn ghost sm header-icon back-nav-btn';b.setAttribute('aria-label','رجوع للصفحة السابقة');b.title='رجوع';
 b.innerHTML='<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>';
 b.onclick=function(){back();};tools.appendChild(b);return b;}
function paint(){var b=button();if(b)b.disabled=!canBack();var s=d.querySelector('[data-acs-back]');if(s)s.disabled=!canBack();}
function record(tab){if(!tab)return;d.body.classList.toggle('bn-in-acs',tab==='accounting');
 if(tab!==cur&&!going){if(cur){stack.push(cur);if(stack.length>MAX)stack.shift();}local=null;}
 else if(tab!==cur){local=null;}
 cur=tab;paint();}
function back(){if(local&&local.canBack&&local.canBack()){local.back();paint();return true;}
 var prev=stack.pop();if(!prev){paint();return false;}
 going=true;try{if(w.SSMPDGotoTab)w.SSMPDGotoTab(prev);}finally{going=false;}paint();return true;}
w.SSMPDBackNav={record:record,back:back,canBack:canBack,setLocal:function(l){local=l||null;paint();},repaint:paint,_t:{stack:function(){return stack.slice();},current:function(){return cur;}}};
})(window,document);
