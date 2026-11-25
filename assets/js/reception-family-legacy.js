/* 20261125140000 (owner 2026-11-25): «زيارات كارت العيلة السابقة (السيستم القديم)» — approvals card on the reception screen.
   Shown only when the server says the signed-in user is an approver (clinic_reception_family_legacy_pending → can_review; roles in
   clinic_reception.family_legacy_config) and something waits that they did not enter and did not approve yet.
   «اعتمد» / «ارفض (بسبب)» → clinic_reception_family_legacy_review. Hook: SSMPDFamilyLegacy.approvals(host, context). */
(function(w){'use strict';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function rpc(n,a){var c=w.SSMPDDb&&w.SSMPDDb.client;if(!c)return Promise.reject(new Error('تعذر الاتصال'));return Promise.resolve(c.rpc(n,a)).then(function(r){if(r&&r.error)throw r.error;return r?r.data:null;});}
function approvals(host,c){if(!host||!c)return;
 rpc('clinic_reception_family_legacy_pending',{}).then(function(r){if(!host.isConnected)return;var old=host.querySelector('[data-rfl-approvals]');if(old)old.remove();
  var list=(r&&r.pending||[]).filter(function(x){return !x.mine&&!x.i_approved;});if(!r||!r.can_review||!list.length)return;
  var sec=document.createElement('section');sec.className='rlp-appr';sec.setAttribute('data-rfl-approvals','');
  sec.innerHTML='<h3>زيارات كارت العيلة من السيستم القديم — مستنية اعتمادك</h3>'+list.map(function(x){return '<article class="rlp-req" data-rfl-req="'+esc(x.id)+'"><div><b>'+esc(x.patient)+'</b>'+(x.file_no?' — '+esc(x.file_no):'')+
   ' — <b>'+esc(x.visits)+'</b> زيارة قديمة'+(x.old_visits!=null?' <span class="rlp-badge">بدل '+esc(x.old_visits)+' معتمدة</span>':'')+
   '<small>السبب: '+esc(x.reason)+' · الإثبات: '+(x.proof_note?esc(x.proof_note):'')+(x.proof_path?(x.proof_note?' + ':'')+'مستند مرفوع':'')+(x.created_by?' · سجّلها: '+esc(x.created_by):'')+
   ((x.approved_by||[]).length?' · اعتمدها: '+esc(x.approved_by.filter(Boolean).join(' و ')||'—')+' (محتاجة '+esc(r.required)+')':'')+' · زيارات السيستم الجديد: '+esc(x.new_system)+'</small></div>'+
   '<div class="rlp-btns"><button type="button" class="btn btn-primary" data-rfl-ok>اعتمد</button><button type="button" class="btn rx-danger" data-rfl-no>ارفض (بسبب)</button></div></article>';}).join('');
  var anchor=host.querySelector('.rx-header');if(anchor)anchor.after(sec);else host.prepend(sec);
  sec.addEventListener('click',function(e){var art=e.target.closest('[data-rfl-req]');if(!art)return;var id=art.getAttribute('data-rfl-req'),approve=!!e.target.closest('[data-rfl-ok]'),reject=!!e.target.closest('[data-rfl-no]');if(!approve&&!reject)return;
   var note=null;if(reject){note=w.prompt('سبب الرفض');if(!note)return;}
   art.querySelectorAll('button').forEach(function(b){b.disabled=true;});
   rpc('clinic_reception_family_legacy_review',{p_id:id,p_approve:approve,p_note:note}).then(function(res){
     if(w.SSMPDToast)w.SSMPDToast.show(!approve?'اترفض الطلب':res&&res.status==='approved'?'اتعتمدت ✓ — خصم العيلة الجاي '+res.next_percent+'٪':'اتسجّل اعتمادك ✓ — مستني اعتماد تاني');
     art.remove();if(!sec.querySelector('[data-rfl-req]'))sec.remove();})
    .catch(function(err){art.querySelectorAll('button').forEach(function(b){b.disabled=false;});w.alert((err&&err.message)||'تعذر الحفظ');});});
 }).catch(function(){});}
w.SSMPDFamilyLegacy={approvals:approvals};
})(window);
