/* SSMPD — «جلسات ليزر من غير قراية عداد» (owner 2026-11-27 «موافق على النبضات من غير عداد مؤقتاً»; mig 20261127300000; help 346).
   A card on top of the reception screen for the owner / managers only (super admin, general manager, financial manager, or a workspace
   manager — the server decides: public.clinic_reception_no_meter_sessions returns allowed=false for anyone else, and then nothing shows).
   Last 30 days: date, device, service, employee, pulses, file no., «صورة» (signed link to the device-screen photo when one was attached).
   Search box when the list is long; ✕ hides the card for this visit of the page. Read only. */
(function(w,d){'use strict';
var hidden={};
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function num(v){return Number(v||0).toLocaleString('en-US',{maximumFractionDigits:3});}
function when(v){try{return v?new Date(v).toLocaleString('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',day:'numeric',month:'short',hour:'numeric',minute:'2-digit'}):'';}catch(e){return '';}}
function client(){return w.SSMPDDb&&w.SSMPDDb.client;}
function card(host,c){if(!host||!c||!c.workspace||hidden[c.workspace])return Promise.resolve(null);var cl=client();if(!cl)return Promise.resolve(null);
 return Promise.resolve(cl.rpc('clinic_reception_no_meter_sessions',{p_workspace:c.workspace})).then(function(r){var x=r&&r.data;if(r&&r.error)throw r.error;
  var old=host.querySelector('[data-no-meter-card]');if(old)old.remove();if(!x||!x.allowed||!(x.rows||[]).length||!host.isConnected)return null;
  var rows=x.rows,sec=d.createElement('section');sec.className='rnm-card';sec.setAttribute('data-no-meter-card','');
  sec.innerHTML='<div class="rnm-h"><h3>جلسات ليزر من غير قراية عداد <small>آخر 30 يوم · '+rows.length+'</small></h3><button type="button" class="btn rnm-x" data-no-meter-close aria-label="إغلاق">✕</button></div>'+
   '<p class="rnm-note">حل مؤقت لحد ما نقرا العدد من أجهزة الليزر: الموظف كتب عدد النبضات بس. راجع الأرقام والصورة لو موجودة.</p>'+
   (rows.length>=9?'<input type="search" class="rnm-q" data-no-meter-q placeholder="دوّر بالجهاز أو الموظف أو الخدمة أو رقم الملف" aria-label="دوّر">':'')+
   '<div class="table-wrap"><table class="data-table rnm-t"><thead><tr><th>التاريخ</th><th>الجهاز</th><th>الخدمة</th><th>الموظف</th><th>النبضات</th><th>الملف</th><th></th></tr></thead><tbody>'+
   rows.map(function(z){return '<tr data-no-meter-row><td dir="ltr">'+esc(when(z.at))+'</td><td>'+esc(z.device)+'</td><td>'+esc(z.service)+'</td><td>'+esc(z.by)+'</td><td dir="ltr"><b>'+num(z.pulses)+'</b></td><td dir="ltr">'+esc(z.file_no||'')+'</td><td>'+
    (z.evidence?'<button type="button" class="btn ghost" data-no-meter-photo="'+esc(z.evidence)+'">صورة</button>':'<span class="rnm-none">من غير صورة</span>')+'</td></tr>';}).join('')+'</tbody></table></div>';
  var anchor=host.querySelector('.rx-header');if(anchor)anchor.after(sec);else host.prepend(sec);
  sec.querySelector('[data-no-meter-close]').onclick=function(){hidden[c.workspace]=true;sec.remove();};
  var q=sec.querySelector('[data-no-meter-q]');if(q)q.oninput=function(){var t=q.value.trim();sec.querySelectorAll('[data-no-meter-row]').forEach(function(tr){tr.hidden=!!t&&tr.textContent.indexOf(t)<0;});};
  sec.querySelectorAll('[data-no-meter-photo]').forEach(function(b){b.onclick=function(){var p=b.getAttribute('data-no-meter-photo');
   Promise.resolve(cl.storage.from('shift-expense-receipts').createSignedUrl(p,120)).then(function(r){if(r&&r.error)throw r.error;w.open(r.data.signedUrl,'_blank','noopener');})
    .catch(function(e){if(w.SSMPDToast&&w.SSMPDToast.show)w.SSMPDToast.show((e&&e.message)||'مقدرتش أفتح الصورة','error');});};});
  return sec;}).catch(function(){return null;});}
w.SSMPDNoMeter={card:card,_t:{reset:function(){hidden={};}}};
})(window,document);
