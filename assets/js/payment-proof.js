/* Owner 2026-11-19: every non-cash collection (card / InstaPay / wallet / bank) needs the transaction number AND a photo of the
   machine slip or the transfer. The photo goes to the private bucket payment-proofs (<workspace>/<me>/<file>), is registered with
   clinic_reception_payment_proof, and the database attaches it to the payment on save (and refuses a live non-cash payment without it). */
(function(){'use strict';
var MAX=10*1024*1024,TYPES=['image/jpeg','image/png','image/webp','application/pdf'];
function field(n){var name='proof_file'+(n?'_'+n:'');return '<label data-pay-proof="'+name+'" hidden>صورة إيصال الماكينة أو التحويل (إجبارية لغير النقدي)<input type="file" name="'+name+'" accept="image/jpeg,image/png,image/webp,application/pdf"><small class="fc-hint">صوّر إيصال ماكينة الفيزا أو سكرين شوت رسالة التحويل، واكتب رقم العملية اللي عليه في خانة المرجع.</small></label>';}
function bind(form,n){var f=form&&(form.tagName==='FORM'?form:form.querySelector('form')),name='proof_file'+(n?'_'+n:''),method=f&&f.elements[n?'method_'+n:'method'],input=f&&f.elements[name];if(!method||!input)return null;var box=f.querySelector('[data-pay-proof="'+name+'"]');
 function sync(){var need=method.value!=='cash'&&box.dataset.optional!=='1';box.hidden=!need;input.required=need;input.disabled=!need;}
 method.addEventListener('change',sync);sync();return sync;}
function ext(file){var m=/\.([a-z0-9]{2,5})$/i.exec(file.name||'');return m?m[1].toLowerCase():file.type==='application/pdf'?'pdf':'jpg';}
/* uploads + registers the photo; resolves the values without the file so they can go straight to the command */
async function upload(workspace,method,reference,file){
 if(!method||method==='cash')return String(reference||'');
 if(!file||!file.size)throw new Error('ارفع صورة إيصال الماكينة أو التحويل قبل الحفظ');
 if(file.size>MAX)throw new Error('الصورة أكبر من ١٠ ميجا — صوّرها تاني بجودة أقل');
 if(file.type&&TYPES.indexOf(file.type)<0)throw new Error('ارفع صورة (JPG / PNG / WEBP) أو PDF');
 var ref=String(reference||'').trim();if(ref.length<3)throw new Error('اكتب رقم العملية من إيصال الماكينة أو رسالة التحويل');
 var me=window.SSMPDAuth&&window.SSMPDAuth.currentAdmin&&window.SSMPDAuth.currentAdmin.id;if(!me)throw new Error('سجّل الدخول من جديد');
 var client=window.SSMPDDb.client,path=workspace+'/'+me+'/'+(crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(16).slice(2))+'.'+ext(file);
 var up=await client.storage.from('payment-proofs').upload(path,file,{upsert:false,contentType:file.type||undefined});if(up&&up.error)throw new Error('تعذر رفع الصورة — جرّب تاني');
 var r=await client.rpc('clinic_reception_payment_proof',{p_workspace:workspace,p_reference:ref,p_path:path});if(r&&r.error)throw r.error;
 return ref;}
async function attach(workspace,values){var v=Object.assign({},values),file=v.proof_file;delete v.proof_file;if(v.method&&v.method!=='cash')v.reference=await upload(workspace,v.method,v.reference,file);return v;}
function open(path){var c=window.SSMPDDb.client,win=window.open('','_blank');return Promise.resolve(c.storage.from('payment-proofs').createSignedUrl(path,300)).then(function(r){if(r.error)throw r.error;if(win){win.opener=null;win.location.href=r.data.signedUrl;}else window.location.assign(r.data.signedUrl);},function(e){if(win)win.close();throw e;});}
window.SSMPDPaymentProof={field:field,bind:bind,upload:upload,attach:attach,open:open};
})();
