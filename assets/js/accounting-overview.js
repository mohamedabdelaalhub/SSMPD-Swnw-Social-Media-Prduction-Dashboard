/* «الحسابات ← نظرة عامة» (owner-approved mockup, 2026-11-18). Real numbers only, from clinic_finance_overview():
   a tile, chart or list is drawn only when its field is present — nothing is estimated or faked. */
(function(){
'use strict';
var SVGNS='http://www.w3.org/2000/svg';
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function num(v){var n=Number(v);return v==null||v===''||isNaN(n)?null:n;}
function fmt(v){var n=num(v)||0;return n.toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:Math.round(n)===n?0:2});}
function reduced(){return !!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);}
function el(tag,attrs,parent){var e=document.createElementNS(SVGNS,tag);for(var k in attrs)e.setAttribute(k,attrs[k]);if(parent)parent.appendChild(e);return e;}
var IC={cash:'<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',today:'<path d="M12 3v18M7 8h7a3 3 0 0 1 0 6H8"/>',doctors:'<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5M17 8v6M14 11h6"/>',requests:'<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',shift:'<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',handover:'<path d="M4 12h12M12 6l6 6-6 6"/>',cases:'<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/>',insurance:'<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/>',bank:'<path d="M4 21V9l8-6 8 6v12M8 21v-7M12 21v-7M16 21v-7M3 21h18"/>'};
function icon(k){return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(IC[k]||IC.requests)+'</svg>';}
var NEED={shift_review:['shift','#2563EB','#E5ECFD','مراجعة'],handover:['handover','#0F369D','#E8EEFB','استلام'],requests:['requests','#C2410C','#FDECE4',''],cash_cases:['cases','#D0402A','#FBE7E4',''],insurance_overdue:['insurance','#B400E6','#F6E0FC',''],bank_reconcile:['bank','#2F7D5C','#E7F3EE','مطابقة']};
var SERIES=[['cash','نقدي','#0F369D'],['card','فيزا','#00B0BD'],['insurance','تأمين','#B400E6'],['other','تحويل ومحافظ','#2F7D5C']];

function tile(o){if(o.value==null)return '';var spark=o.trend&&o.trend.length>1&&o.trend.every(function(x){return num(x)!==null;})?'<svg class="aco-sp" data-aco-spark="'+o.trend.map(Number).join(',')+'" aria-hidden="true"></svg>':'<span class="aco-sp-gap" aria-hidden="true"></span>';
 return '<button type="button" class="aco-k" data-aco-go="'+o.go+'" style="--c:'+o.c+';--t:'+o.t+'"><span class="aco-ic">'+icon(o.icon)+'</span><small>'+esc(o.label)+'</small><b><bdi data-aco-count="'+o.value+'"'+(o.money?' data-aco-money="1"':'')+'>'+fmt(o.value)+'</bdi>'+(o.money?'<u>ج</u>':'')+'</b><i'+(o.tone?' class="'+o.tone+'"':'')+'>'+esc(o.sub||'')+'</i>'+spark+'</button>';}

function render(host,opts){
 opts=opts||{};host.innerHTML='<section class="aco" dir="rtl" aria-busy="true"><div class="fc-section-head"><h4 tabindex="-1" data-acc-heading>نظرة عامة</h4><p class="fc-section-hint">أرقام النهارده وآخر أسبوعين من الخزينة والتحصيل، واللي مستني منك.</p></div><p class="aco-loading">جاري تحميل الأرقام…</p></section>';
 var root=host.firstChild,db=window.SSMPDDb;
 if(!db||!db.client||!db.client.rpc){if(opts.onUnavailable)opts.onUnavailable();return;}
 Promise.resolve(db.client.rpc('clinic_finance_overview')).then(function(r){if(!root.isConnected)return;if(!r||r.error||!r.data)throw (r&&r.error)||Error('no data');draw(root,r.data,opts);})
  .catch(function(){if(!root.isConnected)return;if(opts.onUnavailable)opts.onUnavailable();else root.querySelector('.aco-loading').textContent='تعذر تحميل الأرقام دلوقتي. جرّب «تحديث» بعد شوية.';});
}
function draw(root,d,opts){
 root.removeAttribute('aria-busy');
 var cash=d.cash_on_hand,today=d.today_collections,dues=d.doctor_dues_now,req=d.pending_requests;
 var tiles=[
  cash&&tile({label:'النقدية في الخزائن',value:num(cash.amount),money:1,sub:num(cash.registers)!=null?cash.registers+' خزائن':'',trend:cash.trend7,go:'shifts',icon:'cash',c:'#0F369D',t:'#E8EEFB'}),
  today&&tile({label:'تحصيل النهارده',value:num(today.amount),money:1,sub:[num(today.receipts)!=null?today.receipts+' إيصال':'',num(today.registers)!=null?today.registers+' خزائن':''].filter(Boolean).join(' · '),trend:today.trend7,go:'payments',icon:'today',c:'#00B0BD',t:'#E0F6F7'}),
  dues&&tile({label:'مستحقات الأطباء',value:num(dues.amount),money:1,sub:num(dues.doctors)!=null?(Number(dues.doctors)===1?'طبيب واحد':dues.doctors+' أطباء'):'',go:'doctor-accounts',icon:'doctors',c:'#D4087F',t:'#FBE6F2'}),
  req&&tile({label:'طلبات صرف مستنية',value:num(req.count),sub:num(req.older_than_day)?req.older_than_day+' أقدم من يوم':(num(req.amount)?fmt(req.amount)+' ج':''),tone:num(req.older_than_day)?'dn':'',go:'requests',icon:'requests',c:'#C2410C',t:'#FDECE4'})
 ].filter(Boolean);
 var html='<div class="fc-section-head"><h4 tabindex="-1" data-acc-heading>نظرة عامة</h4><p class="fc-section-hint">'+(d.today?'النهارده '+esc(d.today)+' · ':'')+'دوس على أي رقم يفتحلك تفاصيله.</p><button type="button" class="btn ghost aco-reload" data-aco-reload aria-label="تحديث"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg><span>تحديث</span></button></div>';
 if(tiles.length)html+='<div class="aco-kpis aco-n'+tiles.length+'">'+tiles.join('')+'</div>';
 var days=Array.isArray(d.collections_14d)?d.collections_14d:[],anyCol=days.some(function(x){return SERIES.some(function(s){return num(x[s[0]])>0;});});
 var needs=Array.isArray(d.needs)?d.needs:[],exp=Array.isArray(d.expenses_month)?d.expenses_month.filter(function(x){return num(x.amount)>0;}):[];
 var cards='';
 if(anyCol)cards+='<article class="aco-card aco-wide"><div class="aco-ch"><div><h2>التحصيل آخر 14 يوم</h2><small>حسب طريقة الدفع</small></div><button type="button" class="aco-lnk" data-aco-go="payments">التحصيل</button></div><div class="aco-chart"><svg data-aco-cols height="200" role="img" aria-label="التحصيل اليومي آخر 14 يوم"></svg></div><div class="aco-lg">'+SERIES.filter(function(s){return days.some(function(x){return num(x[s[0]])>0;});}).map(function(s){return '<span><i style="background:'+s[2]+'"></i>'+s[1]+'</span>';}).join('')+'</div></article>';
 if(d.can_review!==false)cards+='<article class="aco-card"><div class="aco-ch"><div><h2>محتاج منك</h2><small>'+(needs.length?'مرتبة بالأهم':'')+'</small></div></div>'+(needs.length?'<ul class="aco-need">'+needs.map(function(n){var m=NEED[n.kind]||['requests','#475569','#EEF1F5',''];var pill=num(n.count)>1||!m[3]?(num(n.count)!=null?n.count:''):m[3];return '<li><button type="button" data-aco-go="'+esc(n.section||'')+'" style="--c:'+m[1]+';--t:'+m[2]+'"><span class="aco-ic">'+icon(m[0])+'</span><span class="aco-nt"><b>'+esc(n.label||'')+'</b><small>'+esc([n.detail,num(n.amount)?fmt(n.amount)+' ج':'',num(n.days_since)!=null?'من '+n.days_since+' يوم':''].filter(Boolean).join(' · '))+'</small></span>'+(pill!==''?'<em>'+esc(pill)+'</em>':'')+'</button></li>';}).join('')+'</ul>':'<p class="aco-clear">مفيش حاجة مستنياك دلوقتي 👌</p>')+'</article>';
 if(exp.length){var mx=Math.max.apply(0,exp.map(function(x){return Number(x.amount);}));cards+='<article class="aco-card aco-full"><div class="aco-ch"><div><h2>أكبر المصروفات الشهر ده</h2><small>من القيود المرحّلة</small></div><button type="button" class="aco-lnk" data-aco-go="reports">القوائم المالية</button></div><ul class="aco-bars">'+exp.slice(0,5).map(function(x,i){return '<li style="--c:'+['#D4087F','#6600FF','#A87B00','#09A0BE','#525B6F'][i]+'"><span title="'+esc(x.category)+'">'+esc(x.category)+'</span><span class="aco-t"><i data-aco-w="'+Math.round(100*Number(x.amount)/(mx||1))+'"></i></span><b>'+fmt(x.amount)+'</b></li>';}).join('')+'</ul></article>';}
 if(cards)html+='<div class="aco-grid">'+cards+'</div>';
 if(!tiles.length&&!cards)html+='<p class="aco-clear">الأرقام دي بتظهر للمدير المالي والإدارة. افتح القسم اللي محتاجه من القايمة.</p>';
 root.innerHTML=html;
 /* owner 2026-11-23 (20261122390000): «تحصيل النهارده» says how many receipts covered more than one visit */
 if(window.SSMPDMultiPay)window.SSMPDMultiPay.load({}).then(function(sum){var i=root.isConnected&&root.querySelector('[data-aco-go="payments"] i');if(!i||!sum||!Number(sum.multi))return;i.textContent+=' · '+sum.multi+(Number(sum.multi)===1?' دفعة':' دفعات')+' لأكتر من زيارة';i.title='الإيصال الواحد ممكن يغطي أكتر من زيارة — التفاصيل في «التحصيل»';});
 root.querySelectorAll('[data-aco-go]').forEach(function(b){if(!b.dataset.acoGo){b.disabled=true;return;}b.onclick=function(){if(opts.go)opts.go(b.dataset.acoGo);};});
 var rl=root.querySelector('[data-aco-reload]');if(rl)rl.onclick=function(){render(root.parentNode,opts);};
 animate(root,days);
 if(opts.onReady)opts.onReady(d);
}
function count(e){var to=Number(e.dataset.acoCount);if(reduced()||!isFinite(to)){e.textContent=fmt(to);return;}var t0=performance.now();(function step(t){var k=Math.min(1,(t-t0)/900),v=to*(1-Math.pow(1-k,3));e.textContent=fmt(k<1?(Math.round(to)===to?Math.round(v):v):to);if(k<1)requestAnimationFrame(step);})(t0);}
function spark(s){var v=s.dataset.acoSpark.split(',').map(Number),b=s.getBoundingClientRect(),W=Math.round(b.width)||200,H=Math.round(b.height)||46,mx=Math.max.apply(0,v),mn=Math.min.apply(0,v),r=mx-mn||1;s.setAttribute('viewBox','0 0 '+W+' '+H);s.innerHTML='';
 var p=v.map(function(n,i){return [3+i*(W-6)/(v.length-1),4+(H-8)*(1-(n-mn)/r)];}),dd=p.map(function(q,i){return (i?'L':'M')+q[0].toFixed(1)+','+q[1].toFixed(1);}).join('');
 el('path',{class:'a',d:dd+'L'+p[p.length-1][0].toFixed(1)+','+H+'L'+p[0][0].toFixed(1)+','+H+'Z'},s);var l=el('path',{class:'l',d:dd},s);
 if(!reduced()&&l.getTotalLength){var L=l.getTotalLength();l.style.strokeDasharray=L;l.style.strokeDashoffset=L;l.getBoundingClientRect();l.style.transition='stroke-dashoffset 1s cubic-bezier(.22,1,.36,1) .2s';l.style.strokeDashoffset='0';}
 var q=p[p.length-1];el('circle',{cx:q[0].toFixed(1),cy:q[1].toFixed(1),r:3.5},s);}
var tipEl=null;function tip(html,x,y){if(!tipEl){tipEl=document.createElement('div');tipEl.className='aco-tip';tipEl.setAttribute('role','status');document.body.appendChild(tipEl);}tipEl.innerHTML=html;tipEl.style.left=Math.max(80,Math.min(innerWidth-80,x))+'px';tipEl.style.top=y+'px';tipEl.classList.add('on');}
function untip(){if(tipEl)tipEl.classList.remove('on');}
function nice(m){if(m<=0)return 1;var p=Math.pow(10,Math.floor(Math.log10(m))),f=m/p;return (f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*p;}
function cols(s,days){var W=Math.round(s.getBoundingClientRect().width)||600,H=200,P={l:44,r:6,t:10,b:24},n=days.length,bw=(W-P.l-P.r)/n,tot=days.map(function(x){return SERIES.reduce(function(a,k){return a+(num(x[k[0]])||0);},0);}),mx=nice(Math.max.apply(0,tot)),y=function(v){return P.t+(H-P.t-P.b)*(1-v/mx);},step=bw<26?2:1;
 s.setAttribute('viewBox','0 0 '+W+' '+H);s.innerHTML='';
 [0,mx/2,mx].forEach(function(t){el('line',{x1:P.l,x2:W-P.r,y1:y(t),y2:y(t),stroke:'#EDF0F5'},s);var tx=el('text',{x:P.l-6,y:y(t)+4,'text-anchor':'end','font-size':11,fill:'#6B7483'},s);tx.textContent=fmt(Math.round(t));});
 days.forEach(function(x,i){var bx=P.l+i*bw+bw*.18,w=bw*.64,acc=0,g=el('g',{},s);
  SERIES.forEach(function(k,j){var v=num(x[k[0]])||0;if(!v)return;var top=y(acc+v),bot=y(acc);var r=el('rect',{x:bx.toFixed(1),y:bot.toFixed(1),width:w.toFixed(1),height:0,fill:k[2]},g);if(reduced()){r.setAttribute('y',top.toFixed(1));r.setAttribute('height',(bot-top).toFixed(1));}else setTimeout(function(){r.style.transition='y .7s cubic-bezier(.22,1,.36,1),height .7s cubic-bezier(.22,1,.36,1)';r.setAttribute('y',top.toFixed(1));r.setAttribute('height',(bot-top).toFixed(1));},60+i*40);acc+=v;});
  var day=String(x.day||'').slice(8,10).replace(/^0/,'');if(!((n-1-i)%step)){var lb=el('text',{x:(bx+w/2).toFixed(1),y:H-6,'text-anchor':'middle','font-size':11,fill:'#6B7483'},s);lb.textContent=day;}
  var hit=el('rect',{x:(P.l+i*bw).toFixed(1),y:P.t,width:bw.toFixed(1),height:H-P.t-P.b,fill:'transparent'},s);hit.style.cursor='pointer';
  var show=function(){var b=s.getBoundingClientRect(),parts=SERIES.filter(function(k){return num(x[k[0]])>0;}).map(function(k){return k[1]+' '+fmt(x[k[0]]);});tip('<b>'+esc(x.day)+'</b><br>'+(tot[i]?esc(parts.join(' · '))+'<br>الإجمالي '+fmt(tot[i])+' ج':'مفيش تحصيل'),b.left+(bx+w/2)*b.width/W,b.top+y(tot[i])*b.height/H);};
  hit.addEventListener('pointerenter',show);hit.addEventListener('pointerdown',show);hit.addEventListener('pointerleave',untip);});}
function animate(root,days){root.querySelectorAll('[data-aco-count]').forEach(count);root.querySelectorAll('[data-aco-spark]').forEach(spark);var c=root.querySelector('[data-aco-cols]');if(c)cols(c,days);
 setTimeout(function(){root.querySelectorAll('[data-aco-w]').forEach(function(i){i.style.width=i.dataset.acoW+'%';});},80);
 if(window.ResizeObserver){var last={},ro=new ResizeObserver(function(es){if(!root.isConnected){ro.disconnect();return;}es.forEach(function(e){var t=e.target,w=Math.round(e.contentRect.width),k=t.dataset.acoSpark?'s'+[].indexOf.call(root.querySelectorAll('[data-aco-spark]'),t):'c';if(!w||last[k]===w)return;var first=!(k in last);last[k]=w;if(first)return;if(t.dataset.acoSpark)spark(t);else cols(t,days);});});root.querySelectorAll('[data-aco-spark],[data-aco-cols]').forEach(function(x){ro.observe(x);});}}
window.SSMPDAccountingOverview={render:render};
})();
