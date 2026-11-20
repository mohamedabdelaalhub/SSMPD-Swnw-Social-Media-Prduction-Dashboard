// تقرير ماسا: التحصيل والمصروفات والصافي — طبقة فوق تاب «تحصيل ماسا» (المالية فقط، الصلاحية فعلاً في clinic_finance_masa_net)
(function(){'use strict';var prior=window.SSMPDFinanceControls;if(!prior||window.SSMPDMasaNet)return;
  var KINDS=[['operating','تشغيلي','op'],['advance','سلف','adv'],['partner_draw','مسحوبات شركاء','par'],['transfer','تحويلات بين خزن','tr'],['ignore','تجاهل','ig']];
  var KIND_LABEL={operating:'تشغيلي',advance:'سلف',partner_draw:'مسحوبات شركاء',transfer:'تحويلات بين خزن',ignore:'تجاهل',unclassified:'غير مصنّف'};
  var KIND_CLS={operating:'op',advance:'adv',partner_draw:'par',transfer:'tr',ignore:'ig',unclassified:'un'};
  var MONTHS=['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  var state={from:'',to:'',group:'month',source:'',preset:'year',data:null,view:'pay',month:''};
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function money(n){return Number(n||0).toLocaleString('en-US',{maximumFractionDigits:0});}
  function signed(n){var v=Number(n||0);return (v<0?'−':'')+money(Math.abs(v));}
  function today(){try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo'}).format(new Date());}catch(e){return new Date().toISOString().slice(0,10);}}
  function pad(n){return (n<10?'0':'')+n;}
  function rpc(action,p){var c=window.SSMPDDb&&window.SSMPDDb.client;if(!c)return Promise.reject(new Error('تعذر الاتصال'));
    return Promise.resolve(c.rpc('clinic_finance_masa_net',{p_action:action,p:p||{}})).then(function(r){if(r&&r.error)throw r.error;return r.data;});}
  function toast(m,k){if(window.SSMPDToast&&window.SSMPDToast.show)window.SSMPDToast.show(m,k||'success');}
  function setPreset(p){var t=today(),y=+t.slice(0,4),m=+t.slice(5,7);state.preset=p;state.month='';state.to=t;
    if(p==='month'){state.from=y+'-'+pad(m)+'-01';state.group='day';}
    else if(p==='quarter'){var d=new Date(Date.UTC(y,m-3,1));state.from=d.getUTCFullYear()+'-'+pad(d.getUTCMonth()+1)+'-01';state.group='month';}
    else{state.from=y+'-01-01';state.group='month';}}
  function periodLabel(p){if(!p)return '';if(p.length===7){return MONTHS[+p.slice(5)-1]+' '+p.slice(0,4);}return p;}
  function icon(n){var P={in:'<path d="M12 3v14M7 12l5 5 5-5M5 21h14"/>',out:'<path d="M12 21V7M7 12l5-5 5 5M5 3h14"/>',net:'<rect x="3" y="6" width="18" height="13" rx="3"/><path d="M3 10h18M16 14.5h2"/>',gear:'<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',pen:'<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>',x:'<path d="m6 6 12 12M18 6 6 18"/>'};
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+P[n]+'</svg>';}
  /* ---------- الرسم ---------- */
  function chart(rows){if(!rows.length)return '';var W=760,H=250,L=44,B=30,T=10,n=rows.length,gw=(W-L)/n,max=1;
    rows.forEach(function(r){var out=(+r.operating||0)+(+r.advance||0)+(+r.partner_draw||0);max=Math.max(max,+r.income||0,out);});
    var raw=max/4,mag=Math.pow(10,Math.floor(Math.log10(raw))),nz=raw/mag,st=(nz<=1?1:nz<=2?2:nz<=2.5?2.5:nz<=5?5:10)*mag;max=st*4;
    function y(v){return T+(H-T-B)*(1-v/max);}
    var s='';[0,.25,.5,.75,1].forEach(function(f){var v=max*f;s+='<line x1="'+L+'" x2="'+W+'" y1="'+y(v)+'" y2="'+y(v)+'" stroke="#E3E9F4"/><text x="'+(L-8)+'" y="'+(y(v)+4)+'" font-size="11" fill="#65748a" text-anchor="end">'+Math.round(v/1000)+'</text>';});
    var pts=[];rows.forEach(function(r,k){var x=L+k*gw+gw/2,out=(+r.operating||0)+(+r.advance||0)+(+r.partner_draw||0),last=k>=n-2,bw=Math.min(16,gw/2-4),op=last?1:.78;
      var tip=periodLabel(r.period)+' — التحصيل '+money(r.income)+' · المصروفات '+money(out)+' · صافي النقد '+signed(r.net_cash);
      s+='<g tabindex="0" role="img" aria-label="'+esc(tip)+'"><title>'+esc(tip)+'</title><rect x="'+(x-bw-1)+'" y="'+y(+r.income||0)+'" width="'+bw+'" height="'+Math.max(0,H-B-y(+r.income||0))+'" rx="4" fill="#0F369D" opacity="'+op+'"/><rect x="'+(x+1)+'" y="'+y(out)+'" width="'+bw+'" height="'+Math.max(0,H-B-y(out))+'" rx="4" fill="#9AA7BD" opacity="'+op+'"/></g>';
      var lab=r.period.length===7?MONTHS[+r.period.slice(5)-1]:r.period.slice(8);if(n<=16||k%Math.ceil(n/16)===0)s+='<text x="'+x+'" y="'+(H-10)+'" font-size="11" fill="#65748a" text-anchor="middle">'+esc(lab)+'</text>';
      pts.push([x,y(Math.max(0,+r.net_cash||0))]);});
    s+='<polyline points="'+pts.map(function(p){return p[0]+','+p[1];}).join(' ')+'" fill="none" stroke="#00B0BD" stroke-width="2"/>';
    var lp=pts[pts.length-1];s+='<circle cx="'+lp[0]+'" cy="'+lp[1]+'" r="4.5" fill="#00B0BD" stroke="#fff" stroke-width="2"/>';
    return '<div class="mn-chart" dir="ltr"><svg viewBox="0 0 '+W+' '+H+'" width="100%" role="group" aria-label="التحصيل مقابل المصروفات">'+s+'</svg></div>';}
  /* ---------- الشاشة ---------- */
  function tile(key,ic,label,val,sub,hero){return '<button type="button" class="btn mn-tile'+(hero?' hero':'')+'" data-mn-tile="'+key+'"><span class="mn-ic">'+icon(ic)+'</span><small>'+esc(label)+'</small><b dir="ltr">'+esc(val)+'</b><em>'+esc(sub)+'</em><span class="mn-go">التفاصيل ›</span></button>';}
  function totalsOut(t){return (+t.operating||0)+(+t.advance||0)+(+t.partner_draw||0)+(+t.unclassified||0);}
  function paint(box,d){var t=d.totals||{},rows=d.by_period||[],un=d.unclassified_accounts||[],top=d.top_accounts||[],all=totalsOut(t)+(+t.transfer||0)+(+t.ignored||0)||1;
    state.data=d;var kindsList=[['operating',(+t.operating||0)+(+t.unclassified||0)-(+t.unclassified||0)],['advance',t.advance],['partner_draw',t.partner_draw],['transfer',t.transfer],['ignore',t.ignored],['unclassified',t.unclassified]];
    var h='<div class="mn-card"><div class="mn-top"><div><h3>تقرير ماسا: التحصيل والمصروفات والصافي</h3><p class="mn-sub">من إيصالات ماسا المنسوخة · الأرقام بالجنيه</p></div>'+
      '<div class="mn-seg" role="group" aria-label="التجميع"><button type="button" class="btn'+(state.group==='month'?' on':'')+'" data-mn-group="month">شهور</button><button type="button" class="btn'+(state.group==='day'?' on':'')+'" data-mn-group="day">أيام</button></div></div>'+
      '<div class="mn-filters"><div class="mn-seg" role="group" aria-label="المصدر">'+[['','الكل'],['current','ماسا الحالية'],['old','الفرع القديم (2024 – مارس 2026)']].map(function(s){return '<button type="button" class="btn'+(state.source===s[0]?' on':'')+'" data-mn-source="'+s[0]+'">'+s[1]+'</button>';}).join('')+'</div>'+
      '<label class="mn-dt"><b>من</b><input type="date" data-mn-from value="'+esc(state.from)+'"></label><label class="mn-dt"><b>إلى</b><input type="date" data-mn-to value="'+esc(state.to)+'"></label>'+
      '<div class="mn-seg" role="group" aria-label="الفترة">'+[['month','الشهر ده'],['quarter','٣ شهور'],['year','السنة']].map(function(s){return '<button type="button" class="btn'+(state.preset===s[0]?' on':'')+'" data-mn-preset="'+s[0]+'">'+s[1]+'</button>';}).join('')+'</div></div></div>';
    if(un.length)h+='<div class="mn-warn" role="status"><b>'+un.length+'</b><span>حساب مصروفات لسه ماتصنفش — بيتحسبوا «تشغيلي» لحد ما تصنّفهم</span><button type="button" class="btn" data-mn-classify>صنّف الحسابات</button></div>';
    h+='<div class="mn-tiles">'+tile('inc','in','التحصيل',money(t.income),'إجمالي الإيصالات')+tile('out','out','المصروفات (بدون تحويلات وتجاهل)',money(totalsOut(t)),'تشغيلي + سلف + مسحوبات')+tile('net','net','صافي النقد',signed(t.net_cash),'التحصيل − كل المصروفات',true)+tile('op','net','صافي التشغيل',signed(t.net_operating),'التحصيل − التشغيلي فقط')+'</div>';
    h+='<div class="mn-cols"><div class="mn-card"><div class="mn-top"><h3>التحصيل مقابل المصروفات — '+(state.group==='day'?'يومياً':'شهرياً')+'</h3><div class="mn-legend"><span><i style="background:#0F369D"></i>التحصيل</span><span><i style="background:#9AA7BD"></i>المصروفات</span><span><i style="background:#00B0BD"></i>صافي النقد</span></div></div>'+(rows.length?chart(rows):'<p class="mn-empty">مفيش حركة في الفترة دي.</p>')+'<p class="mn-sub">الأقدم ← الأحدث · الأرقام بالألف جنيه</p></div>';
    h+='<div class="mn-card"><h3>المصروفات حسب النوع</h3><div class="mn-segbar" dir="ltr">'+kindsList.map(function(k){var v=+k[1]||0;return v>0?'<i class="k-'+KIND_CLS[k[0]]+'" style="flex:'+(v/all*100).toFixed(2)+'" title="'+esc(KIND_LABEL[k[0]]+' '+money(v))+'"></i>':'';}).join('')+'</div><div class="mn-kl">'+kindsList.map(function(k){var v=+k[1]||0;return '<div><i class="k-'+KIND_CLS[k[0]]+'"></i>'+KIND_LABEL[k[0]]+'<span>'+(v/all*100).toFixed(0)+'%</span><b dir="ltr">'+money(v)+'</b></div>';}).join('')+'</div><p class="mn-sub">التحويلات والتجاهل مش داخلين في صافي النقد.</p></div></div>';
    h+='<div class="mn-card"><div class="mn-top"><div class="mn-crumb">'+(state.month?'<button type="button" class="btn ghost" data-mn-back>← كل الشهور</button><b>'+esc(periodLabel(state.month))+'</b>':'<span class="mn-sub">دوس على أي شهر يفتح أيامه</span>')+'</div></div>'+
      (rows.length?'<div class="mn-tw"><table class="mn-t"><thead><tr><th>'+(state.group==='day'?'اليوم':'الشهر')+'</th><th class="n">التحصيل</th><th class="n">تشغيلي</th><th class="n">سلف</th><th class="n">مسحوبات</th><th class="n">تحويلات</th><th class="n">صافي النقد</th><th class="n">صافي التشغيل</th></tr></thead><tbody>'+
      rows.slice().reverse().map(function(r){var drill=state.group==='month';return '<tr'+(drill?' class="row" tabindex="0" role="button" data-mn-month="'+esc(r.period)+'"':'')+'><td><b>'+esc(drill?periodLabel(r.period):r.period)+'</b></td><td class="n">'+money(r.income)+'</td><td class="n">'+money(r.operating)+'</td><td class="n">'+money(r.advance)+'</td><td class="n">'+money(r.partner_draw)+'</td><td class="n">'+money(r.transfer)+'</td><td class="n '+(r.net_cash<0?'neg':'pos')+'"><b>'+signed(r.net_cash)+'</b></td><td class="n"><b>'+signed(r.net_operating)+'</b></td></tr>';}).join('')+'</tbody></table></div>':'<p class="mn-empty">مفيش حركة في الفترة دي.</p>')+'</div>';
    h+='<div class="mn-card"><div class="mn-top"><h3>أعلى الحسابات صرفاً</h3><button type="button" class="btn ghost" data-mn-classify>'+icon('gear')+' تصنيف الحسابات</button></div>'+
      (top.length?top.slice(0,8).map(function(a,i){return '<div class="mn-acc"><div class="nm"><b>'+esc(a.account)+'</b><small>'+money(a.payouts)+' إذن صرف</small></div><span class="mn-chip k-'+KIND_CLS[a.kind]+'">'+KIND_LABEL[a.kind]+'</span><span class="amt" dir="ltr">'+money(a.amount)+'</span><button type="button" class="btn mn-edit" data-mn-edit="'+i+'" aria-label="تغيير تصنيف '+esc(a.account)+'">'+icon('pen')+'</button></div>';}).join(''):'<p class="mn-empty">مفيش مصروفات في الفترة دي.</p>')+'</div>';
    box.innerHTML=h;}
  function load(box){box.setAttribute('aria-busy','true');if(!state.from)setPreset('year');
    var p={from:state.from,to:state.to,group_by:state.group};if(state.source)p.source=state.source;
    return rpc('report',p).then(function(d){box.removeAttribute('aria-busy');paint(box,d||{});}).catch(function(e){box.removeAttribute('aria-busy');
      box.innerHTML='<div class="mn-err" role="alert"><b>تقرير الصافي ما اتحمّلش.</b><p>'+esc(e&&e.message||'تعذر تحميل التقرير')+'</p><button type="button" class="btn" data-mn-retry>حاول تاني</button></div>';});}
  /* ---------- النوافذ ---------- */
  var lastFocus=null;
  function modal(title,body,onMount){closeModal();lastFocus=document.activeElement;var b=document.createElement('div');b.className='mn-backdrop';b.innerHTML='<div class="mn-modal" role="dialog" aria-modal="true" aria-label="'+esc(title)+'"><div class="mn-mh"><h3>'+esc(title)+'</h3><button type="button" class="btn mn-x" data-mn-close aria-label="إغلاق">'+icon('x')+'</button></div><div class="mn-mb">'+body+'</div></div>';
    b.addEventListener('click',function(e){if(e.target===b||e.target.closest('[data-mn-close]'))closeModal();});document.body.appendChild(b);var f=b.querySelector('button,input,select');if(f)f.focus();if(onMount)onMount(b);}
  function closeModal(){var m=document.querySelector('.mn-backdrop');if(m){m.remove();if(lastFocus&&lastFocus.focus&&lastFocus.isConnected)lastFocus.focus();}}
  document.addEventListener('keydown',function(e){if(e.key==='Escape')closeModal();});
  function tilePopup(key){var d=state.data||{},t=d.totals||{},rows=d.by_period||[];var title={inc:'التحصيل',out:'المصروفات',net:'صافي النقد',op:'صافي التشغيل'}[key],h='';
    if(key==='out'){h='<div class="mn-kl">'+[['operating',(+t.operating||0)],['advance',t.advance],['partner_draw',t.partner_draw],['unclassified',t.unclassified]].map(function(k){return '<div><i class="k-'+KIND_CLS[k[0]]+'"></i>'+KIND_LABEL[k[0]]+'<b dir="ltr">'+money(k[1])+'</b></div>';}).join('')+'</div><p class="mn-sub">التحويلات ('+money(t.transfer)+') والتجاهل ('+money(t.ignored)+') خارج الحساب.</p>';}
    else{var f={inc:function(r){return r.income;},net:function(r){return r.net_cash;},op:function(r){return r.net_operating;}}[key];
      h=(key==='net'?'<p class="mn-sub">التحصيل ('+money(t.income)+') − تشغيلي ('+money((+t.operating||0)+(+t.unclassified||0))+') − سلف ('+money(t.advance)+') − مسحوبات ('+money(t.partner_draw)+')</p>':key==='op'?'<p class="mn-sub">التحصيل ('+money(t.income)+') − التشغيلي ('+money((+t.operating||0)+(+t.unclassified||0))+')</p>':'')+
      '<div class="mn-tw"><table class="mn-t"><thead><tr><th>'+(state.group==='day'?'اليوم':'الشهر')+'</th><th class="n">'+title+'</th></tr></thead><tbody>'+rows.slice().reverse().map(function(r){return '<tr><td>'+esc(periodLabel(r.period))+'</td><td class="n"><b>'+signed(f(r))+'</b></td></tr>';}).join('')+'</tbody></table></div>';}
    modal(title,h);}
  function kindPicker(cur){return '<div class="mn-kinds" role="radiogroup" aria-label="نوع الحساب">'+KINDS.map(function(k){return '<button type="button" class="btn mn-kind'+(cur===k[0]?' on':'')+'" role="radio" aria-checked="'+(cur===k[0])+'" data-kind="'+k[0]+'"><i class="k-'+k[2]+'"></i>'+k[1]+'</button>';}).join('')+'</div>';}
  function editModal(name,cur,after){var sel=cur&&cur!=='unclassified'?cur:'';
    modal('تصنيف حساب','<div class="mn-field"><span>الحساب</span><div class="mn-val">'+esc(name)+'</div></div><div class="mn-field"><span>نوع الحساب</span></div>'+kindPicker(sel)+'<label class="mn-field"><span>فئة (اختياري)</span><input type="text" maxlength="80" data-mn-cat></label><p class="mn-sub">التغيير بيطبق على كل صرف الحساب ده، قديم وجديد، وأرقام التقرير بتتحدث فوراً.</p><div class="mn-actions"><button type="button" class="btn" data-mn-save>حفظ</button><button type="button" class="btn ghost" data-mn-close>إلغاء</button></div>',function(b){
      b.addEventListener('click',function(e){var k=e.target.closest('.mn-kind');if(k){b.querySelectorAll('.mn-kind').forEach(function(x){x.classList.toggle('on',x===k);x.setAttribute('aria-checked',String(x===k));});sel=k.dataset.kind;}
        if(e.target.closest('[data-mn-save]')){if(!sel){toast('اختار نوع الحساب الأول','error');return;}var btn=e.target.closest('button');btn.disabled=true;
          rpc('classify',{account_name:name,kind:sel,category:(b.querySelector('[data-mn-cat]').value||'').trim()}).then(function(){closeModal();toast('اتحفظ تصنيف الحساب');if(after)after();}).catch(function(er){btn.disabled=false;toast(er&&er.message||'تعذر الحفظ','error');});}});});}
  function classifyListModal(){var d=state.data||{},un=d.unclassified_accounts||[];
    modal('تصنيف الحسابات',(un.length?'<p class="mn-sub">الحسابات اللي لسه ماتصنفتش — دوس على الحساب علشان تختار نوعه.</p>':'<p class="mn-empty">كل الحسابات متصنفة.</p>')+'<div class="mn-list">'+un.map(function(a,i){return '<button type="button" class="btn mn-li" data-mn-un="'+i+'"><span class="nm"><b>'+esc(a.account)+'</b><small>'+money(a.payouts)+' إذن صرف</small></span><span class="amt" dir="ltr">'+money(a.amount)+'</span></button>';}).join('')+'</div>',function(b){
      b.addEventListener('click',function(e){var li=e.target.closest('[data-mn-un]');if(!li)return;var a=un[+li.dataset.mnUn];editModal(a.account,'unclassified',refresh);});});}
  /* ---------- ربط ---------- */
  function box(){return document.querySelector('[data-masa-net]');}
  function refresh(){var b=box();if(b)load(b);}
  document.addEventListener('click',function(e){var t=e.target;if(!t.closest)return;
    var sw=t.closest('[data-mn-view]');if(sw){state.view=sw.dataset.mnView;document.querySelectorAll('[data-mn-pane]').forEach(function(p){p.hidden=p.dataset.mnPane!==state.view;});document.querySelectorAll('[data-mn-view]').forEach(function(x){x.classList.toggle('on',x===sw);});if(state.view==='net'){var b=box();if(b&&!b.hasAttribute('data-ready')){b.setAttribute('data-ready','');load(b);}}return;}
    var b=box();if(!b||!b.contains(t))return;
    var el;
    if((el=t.closest('[data-mn-group]'))){state.group=el.dataset.mnGroup;state.month='';load(b);}
    else if((el=t.closest('[data-mn-source]'))){state.source=el.dataset.mnSource;load(b);}
    else if((el=t.closest('[data-mn-preset]'))){setPreset(el.dataset.mnPreset);load(b);}
    else if((el=t.closest('[data-mn-tile]'))){tilePopup(el.dataset.mnTile);}
    else if(t.closest('[data-mn-classify]')){classifyListModal();}
    else if((el=t.closest('[data-mn-edit]'))){var a=(state.data.top_accounts||[])[+el.dataset.mnEdit];if(a)editModal(a.account,a.kind,refresh);}
    else if((el=t.closest('[data-mn-month]'))){drill(b,el.dataset.mnMonth);}
    else if(t.closest('[data-mn-back]')){state.month='';state.group='month';setPreset(state.preset||'year');load(b);}
    else if(t.closest('[data-mn-retry]')){load(b);}});
  document.addEventListener('keydown',function(e){if(e.key!=='Enter'&&e.key!==' ')return;var r=e.target.closest&&e.target.closest('tr[data-mn-month]');if(r){e.preventDefault();drill(box(),r.dataset.mnMonth);}});
  document.addEventListener('change',function(e){var b=box();if(!b||!b.contains(e.target))return;if(e.target.matches('[data-mn-from],[data-mn-to]')){var f=b.querySelector('[data-mn-from]').value,t=b.querySelector('[data-mn-to]').value;if(f&&t&&f<=t){state.from=f;state.to=t;state.preset='';state.month='';load(b);}}});
  function drill(b,m){var y=+m.slice(0,4),mo=+m.slice(5,7),last=new Date(Date.UTC(y,mo,0)).getUTCDate();state.month=m;state.group='day';state.from=m+'-01';state.to=m+'-'+pad(last);state.preset='';load(b);}
  function panel(tab,d,h){var p=prior.panel(tab,d,h);if(tab!=='masa-payments')return p;
    return '<div class="mn-switch" role="tablist"><button type="button" class="btn'+(state.view==='pay'?' on':'')+'" role="tab" data-mn-view="pay">دفعات التحصيل</button><button type="button" class="btn'+(state.view==='net'?' on':'')+'" role="tab" data-mn-view="net">تقرير الصافي</button></div>'+
      '<div data-mn-pane="pay"'+(state.view==='pay'?'':' hidden')+'>'+p+'</div><div data-mn-pane="net"'+(state.view==='net'?'':' hidden')+'><div class="mn" data-masa-net><p class="mn-sub">جاري التحميل…</p></div></div>';}
  function autoload(){var b=box();if(b&&state.view==='net'&&!b.hasAttribute('data-ready')){b.setAttribute('data-ready','');load(b);}}
  var panelOrig=panel;panel=function(tab,d,h){var r=panelOrig(tab,d,h);if(tab==='masa-payments')setTimeout(autoload,0);return r;};
  window.SSMPDFinanceControls={panel:panel,act:prior.act,due:prior.due,ledger:prior.ledger};
  window.SSMPDMasaNet={load:load,state:state};
})();
