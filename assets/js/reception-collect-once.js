/* SSMPD — «التحصيل بضغطة واحدة» (owner 2026-11-27 «طبّق منع التحصيل المكرر», mig 20261127110000, help 327).
   The server refuses a second «تحصيل» for the same patient, amount and method within 2 minutes (hint 'duplicate_collect').
   ask(e) shows that refusal as a red box INSIDE the open «تسجيل تحصيل» window with two buttons:
     «حصّل تاني برضه» → resolves true (the caller resends with confirm_duplicate)   ·   «لأ، ماتسجلش» → resolves false.
   Without an open window it falls back to window.confirm. No RPC here. */
(function(w){'use strict';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function isDuplicate(e){return !!(e&&e.hint==='duplicate_collect');}
function ask(e){var d=w.document,root=d.querySelector('.rx-modal'),status=root&&root.querySelector('[data-rx-status]'),msg=(e&&e.message)||'اتسجل للمريض ده نفس المبلغ من شوية.';
 if(!status)return Promise.resolve(!!w.confirm(msg));
 return new Promise(function(done){var old=root.querySelector('[data-collect-once]');if(old)old.remove();
  var box=d.createElement('div');box.className='rx-collect-once';box.setAttribute('data-collect-once','');box.setAttribute('role','alert');
  box.innerHTML='<p>'+esc(msg)+'</p><div class="rx-collect-once-btns"><button type="button" class="btn btn-danger" data-collect-again>حصّل تاني برضه</button><button type="button" class="btn" data-collect-no>لأ، ماتسجلش</button></div>';
  status.parentNode.insertBefore(box,status);status.textContent='';
  function finish(v){box.remove();done(v);}
  box.querySelector('[data-collect-again]').onclick=function(){finish(true);};
  box.querySelector('[data-collect-no]').onclick=function(){finish(false);};
  var b=box.querySelector('[data-collect-again]');if(b&&b.focus)b.focus();});}
w.SSMPDCollectOnce={isDuplicate:isDuplicate,ask:ask};
})(window);
