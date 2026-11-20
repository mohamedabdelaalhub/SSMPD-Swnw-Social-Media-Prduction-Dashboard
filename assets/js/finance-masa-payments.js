// «تحصيل ماسا» (المالك 2026-11-19، التصور docs/ui-references/mockups/masa-payments-report.html): اللي اتحصّل على ماسا للمتابعة والمطابقة.
// للمالية بس، ومش بيدخل ورديات الخزنة ولا أي رصيد. البيانات بتيجي من الوكيل كل ٥ دقايق (public.clinic_finance_masa_payments).
// طبقة على SSMPDFinanceControls: التاب «masa-payments» بيرجّع حاوية وبيملاها لما تتعرض.
(function(){'use strict';var prior=window.SSMPDFinanceControls;if(!prior)return;
  var METHODS=[['','الكل'],['cash','نقدي'],['card','فيزا'],['wallet','محافظ (انستا باي / فودافون كاش)']];
  var state={from:'',to:'',method:'',deleted:false};
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function money(n){var v=Number(n||0);return v.toLocaleString('en-US',{maximumFractionDigits:2});}
  function today(){try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date());}catch(e){return new Date().toISOString().slice(0,10);}}
  function hm(iso){try{return new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(iso));}catch(e){return '';}}
  function ago(iso){if(!iso)return 'لسه ما وصلش تحديث من ماسا';var m=Math.max(0,Math.round((Date.now()-new Date(iso).getTime())/60000));return 'آخر تحديث من ماسا '+(m<1?'دلوقتي':m<60?'من '+m+' دقيقة':'من '+Math.round(m/60)+' ساعة');}
  function rpc(action,p){var c=window.SSMPDDb&&window.SSMPDDb.client;if(!c)return Promise.reject(new Error('تعذر الاتصال'));
    return Promise.resolve(c.rpc('clinic_finance_masa_payments',{p_action:action,p:p||{}})).then(function(r){if(r&&r.error)throw r.error;return r.data;});}
  function toast(m,k){if(window.SSMPDToast&&window.SSMPDToast.show)window.SSMPDToast.show(m,k||'success');}
  function table(head,rows){return '<div class="mp-tw"><table class="mp-t"><thead><tr>'+head.map(function(h){return '<th>'+esc(h)+'</th>';}).join('')+'</tr></thead><tbody>'+
    (rows.length?rows.join(''):'<tr><td colspan="'+head.length+'">مفيش بيانات في الفترة دي</td></tr>')+'</tbody></table></div>';}
  function paint(box,d){var tt=(d&&d.totals)||{},bm=tt.by_method||{},canName=Array.isArray(d.admins);
    var k=function(l,v,hero){return '<div class="mp-k'+(hero?' hero':'')+'"><span>'+esc(l)+'</span><b dir="ltr">'+money(v)+'</b></div>';};
    var html='<div class="mp-bar"><label>من<input type="date" data-mp="from" value="'+esc(state.from)+'"></label><label>إلى<input type="date" data-mp="to" value="'+esc(state.to)+'"></label>'+
      '<label>الطريقة<select data-mp="method">'+METHODS.map(function(m){return '<option value="'+m[0]+'"'+(m[0]===state.method?' selected':'')+'>'+m[1]+'</option>';}).join('')+'</select></label>'+
      '<label><input type="checkbox" data-mp="deleted"'+(state.deleted?' checked':'')+'> اعرض الإيصالات الملغية</label><button type="button" class="btn" data-mp-csv>تصدير Excel</button></div>'+
      '<p class="mp-note">ده اللي اتحصّل على ماسا، للمتابعة والمطابقة بس. مش بيدخل ورديات الخزنة ولا بيغيّر أي رصيد في الحسابات. '+esc(ago(d.synced_at))+'.</p>'+
      (!(d.receipts||[]).length?'<p class="mp-empty">مفيش إيصالات من ماسا من '+esc(state.from)+' لـ '+esc(state.to)+'. غيّر التاريخ من فوق.</p>':'')+'<div class="mp-kpis">'+k('إجمالي المحصّل',tt.all,true)+k('نقدي',bm.cash)+k('فيزا',bm.card)+k('محافظ',bm.wallet)+(Number(bm.other)?k('طرق تانية',bm.other):'')+'</div>'+
      '<div class="mp-grid"><section><h4>حسب الكاشير (من ماسا)</h4>'+table(['الكاشير','الخزنة','إيصالات','المبلغ'],(d.by_cashier||[]).map(function(c){
        var nm=c.name?esc(c.name):'مستخدم ماسا #'+esc(c.cashier_user_id)+(canName&&c.cashier_user_id!=null?' <button type="button" class="mp-link" data-mp-name="'+esc(c.cashier_user_id)+'">اربطه باسم</button>':'');
        var sf=c.safe?esc(c.safe):(c.safe_id!=null?'خزنة #'+esc(c.safe_id)+(canName?' <button type="button" class="mp-link" data-mp-safe="'+esc(c.safe_id)+'">سمّيها</button>':''):'—');
        return '<tr><td>'+nm+'</td><td>'+sf+'</td><td dir="ltr">'+esc(c.receipts)+'</td><td dir="ltr">'+money(c.amount)+'</td></tr>';}))+'</section>'+
      '<section><h4>حسب الدكتور</h4>'+table(['الدكتور','إيصالات','منهم تأمين','المبلغ'],(d.by_doctor||[]).map(function(x){
        return '<tr><td>'+esc(x.doctor)+'</td><td dir="ltr">'+esc(x.receipts)+'</td><td dir="ltr">'+esc(x.insured||0)+'</td><td dir="ltr">'+money(x.amount)+'</td></tr>';}))+'</section></div>'+
      '<section><h4>الإيصالات</h4>'+table(['الوقت','رقم الإيصال','المريض / الحجز','الدكتور','الطريقة','الكاشير','المبلغ'],(d.receipts||[]).map(function(r){
        return '<tr'+(r.deleted?' class="mp-void"':'')+'><td dir="ltr">'+esc(hm(r.paid_at))+'</td><td dir="ltr">'+esc(r.receipt_no||r.id)+'</td><td>'+esc(r.patient||'—')+
          (r.phone?' · <bdi dir="ltr">'+esc(r.phone)+'</bdi>':'')+(r.booking?' · حجز '+esc(r.booking):'')+(r.insured?' <span class="mp-tag ins">'+esc(r.insurance||'تأمين')+'</span>':'')+
          (r.deleted?' <span class="mp-tag void">ملغي على ماسا</span>':'')+'</td><td>'+esc(r.doctor||'—')+'</td><td>'+esc(r.methods||'—')+'</td><td>'+esc(r.cashier||'—')+'</td><td dir="ltr">'+money(r.amount)+'</td></tr>';}))+'</section>';
    box.innerHTML=html;
    box.querySelectorAll('[data-mp]').forEach(function(el){el.onchange=function(){var k=el.getAttribute('data-mp');state[k]=k==='deleted'?el.checked:el.value;load(box);};});
    var csv=box.querySelector('[data-mp-csv]');if(csv)csv.onclick=function(){var rows=[['الوقت','رقم الإيصال','المريض','التليفون','الحجز','الدكتور','الطريقة','الكاشير','المبلغ','ملغي']].concat((d.receipts||[]).map(function(r){
        return [hm(r.paid_at),r.receipt_no||r.id,r.patient||'',r.phone||'',r.booking||'',r.doctor||'',r.methods||'',r.cashier||'',r.amount,r.deleted?'نعم':''];}));
      var text='﻿'+rows.map(function(r){return r.map(function(v){v=String(v==null?'':v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;}).join(',');}).join('\n');
      var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));a.download='masa-payments-'+state.from+'-'+state.to+'.csv';document.body.appendChild(a);a.click();a.remove();};
    box.querySelectorAll('[data-mp-name]').forEach(function(b){b.onclick=function(){var uid=b.getAttribute('data-mp-name'),opts=(d.admins||[]).map(function(a,i){return (i+1)+'- '+a.name;}).join('\n');
      var ans=window.prompt('مستخدم ماسا #'+uid+' — اكتب رقم الموظف من القايمة، أو اكتب الاسم:\n'+opts);if(!ans||!ans.trim())return;var n=parseInt(ans,10),a=(d.admins||[])[n-1];
      rpc('name_cashier',a&&String(n)===ans.trim()?{cashier_user_id:+uid,admin_id:a.id}:{cashier_user_id:+uid,label:ans.trim()}).then(function(){toast('اتربط الاسم');load(box);}).catch(function(e){toast(e.message||'تعذر الحفظ','error');});};});
    box.querySelectorAll('[data-mp-safe]').forEach(function(b){b.onclick=function(){var sid=b.getAttribute('data-mp-safe'),ans=window.prompt('اسم خزنة ماسا #'+sid+'؟');if(!ans||ans.trim().length<2)return;
      rpc('name_safe',{safe_id:+sid,label:ans.trim()}).then(function(){toast('اتسمّت الخزنة');load(box);}).catch(function(e){toast(e.message||'تعذر الحفظ','error');});};});}
  function load(box){if(!state.from){state.to=today();state.from=state.to.slice(0,8)+'01';}box.setAttribute('aria-busy','true');
    return rpc('list',{from:state.from,to:state.to||state.from,method:state.method,include_deleted:state.deleted}).then(function(d){box.removeAttribute('aria-busy');paint(box,d||{});})
      .catch(function(e){box.removeAttribute('aria-busy');box.innerHTML='<div class="mp-err" role="alert"><b>تقرير تحصيل ماسا ما اتحمّلش.</b><p>'+esc(e&&e.message||'تعذر تحميل تحصيل ماسا')+'</p><button type="button" class="btn" data-mp-retry>حاول تاني</button></div>';var rb=box.querySelector('[data-mp-retry]');if(rb)rb.onclick=function(){load(box);};});}
  function fill(){document.querySelectorAll('[data-masa-payments]:not([data-ready])').forEach(function(box){box.setAttribute('data-ready','');load(box);});}
  function panel(tab,d,h){if(tab!=='masa-payments')return prior.panel(tab,d,h);setTimeout(fill,0);return '<div class="mp" data-masa-payments><p class="mp-note">جاري التحميل…</p></div>';}
  window.SSMPDFinanceControls={panel:panel,act:prior.act,due:prior.due,ledger:prior.ledger};
  window.SSMPDMasaPayments={load:load,state:state};
})();
