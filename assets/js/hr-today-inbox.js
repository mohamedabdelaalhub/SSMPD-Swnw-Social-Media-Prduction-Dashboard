(function(w){'use strict';
// «محتاج منك النهارده» — the HR manager home (owner 2026-11-25, mockup hr-navigation-home).
// Display only: it counts what is already waiting using the same read RPCs the HR sections use
// (hr_workspace data already loaded + hr_overtime('workspace'), hr_shift_swaps_list, hr_offboarding_workspace,
// hr_insurance_workspace). Every optional read fails quietly (its row is simply not shown). No writes here.
var CACHE_MS=60000,cache=null;
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Cairo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function words(d){if(!d)return '';var t=Date.parse(String(d).slice(0,10)+'T12:00:00Z');return isNaN(t)?String(d):new Intl.DateTimeFormat('ar-EG-u-nu-latn',{timeZone:'UTC',day:'numeric',month:'long',year:'numeric'}).format(new Date(t));}
function call(fn,args){var c=w.SSMPDDb&&w.SSMPDDb.client;if(!c)return Promise.resolve(null);return Promise.resolve(c.rpc(fn,args||{})).then(function(r){if(!r||r.error)return null;return r.data;}).catch(function(){return null;});}
function names(list,key,max){var out=list.slice(0,max||2).map(function(x){return x[key]||'';}).filter(Boolean);return out.join(' · ')+(list.length>(max||2)?' · و'+(list.length-(max||2))+' كمان':'');}
function syncRows(data,me){
  var people=data.people||[],pn=function(id){return(people.find(function(p){return p.id===id;})||{}).full_name||'';};
  var req=(data.requests||[]).filter(function(r){return r.status==='pending'&&r.created_by!==me;});
  var att=(data.attendance||[]).filter(function(a){return a.status==='pending'&&a.created_by!==me;});
  var setup=people.filter(function(p){return p.status==='needs_setup';}),uncl=people.filter(function(p){return p.kind==='unclassified'&&p.status!=='ended';});
  var rows=[];
  if(req.length)rows.push({id:'requests',sec:'requests',t:'طلبات إجازة وإذن مستنية مراجعتك',s:names(req.map(function(r){return{n:pn(r.person_id)+' ('+(words(r.from_date))+')'};}),'n'),n:req.length});
  if(att.length)rows.push({id:'attendance',sec:'attendance',t:'حضور يدوي مستني مراجعة',s:names(att.map(function(a){return{n:pn(a.person_id)+' يوم '+words(a.day)};}),'n'),n:att.length});
  if(setup.length)rows.push({id:'setup',sec:'people',t:'ملفات ناقصة (ملف مبدئي)',s:names(setup,'full_name'),n:setup.length,calm:1});
  if(uncl.length)rows.push({id:'unclassified',sec:'people',kind:'unclassified',t:'ملفات مش متصنفة (طبيب ولا موظف؟)',s:names(uncl,'full_name'),n:uncl.length,calm:1});
  return rows;}
function asyncRows(me,month){
  if(cache&&cache.at>Date.now()-CACHE_MS&&cache.month===month)return Promise.resolve(cache.rows);
  return Promise.all([
    call('hr_overtime',{p_action:'workspace',p_payload:{month:month+'-01'}}),
    call('hr_shift_swaps_list',{}),
    call('hr_offboarding_workspace',{}),
    call('hr_insurance_workspace',{})
  ]).then(function(r){var rows=[],ot=r[0]&&r[0].to_review||[],sw=(r[1]&&r[1].swaps||[]).filter(function(s){return s.status==='pending_manager'&&s.created_by!==me&&s.partner_by!==me;}),
    off=r[2]&&r[2].can_review?(r[2].cases||[]).filter(function(c){return c.status==='sheet_ready';}):[],
    ins=r[3]||{},t=ins.today||today(),lim=new Date(Date.parse(t+'T12:00:00Z')+14*864e5).toISOString().slice(0,10),
    due=(ins.items||[]).filter(function(i){return i.status==='stopped'&&i.notification_deadline&&!i.stop_reference&&i.notification_deadline<=lim;});
    if(ot.length)rows.push({id:'overtime',sec:'overtime',t:'ساعات إضافية مستنية موافقتك',s:names(ot.map(function(q){return{n:(q.person_name||'')+' يوم '+words(q.day)};}),'n'),n:ot.length});
    if(off.length)rows.push({id:'offboarding',sec:'offboarding',t:'مخالصة إنهاء خدمة مستنية اعتماد',s:names(off,'full_name'),n:off.length});
    if(sw.length)rows.push({id:'swaps',sec:'presence',attTab:'shifts',t:'طلبات تبديل ورديات مستنية اعتمادك',s:names(sw.map(function(x){return{n:(x.requester_name||'')+' ↔ '+(x.partner_name||'')};}),'n'),n:sw.length});
    if(due.length)rows.push({id:'insurance',sec:'insurance',t:'إخطارات تأمين قرب ميعادها',s:names(due.map(function(i){return{n:(i.full_name||'')+' · قبل '+words(i.notification_deadline)};}),'n'),n:due.length});
    cache={at:Date.now(),month:month,rows:rows};return rows;});}
function rowHtml(q){return '<li class="hrn-row'+(q.calm?' is-calm':'')+'" data-hrn-row="'+esc(q.id)+'"><div><b>'+esc(q.t)+'</b>'+(q.s?'<small>'+esc(q.s)+'</small>':'')+'</div><span class="hrn-n">'+q.n+'</span><button type="button" class="btn ghost" data-hrn-go="'+esc(q.id)+'">افتح</button></li>';}
function mount(host,data,opts){
  opts=opts||{};var me=opts.me,month=opts.month||today().slice(0,7),rows=syncRows(data,me),serial=(host.__hrn=(host.__hrn||0)+1);
  host.insertAdjacentHTML('beforeend','<div class="hrn-inbox"><p class="hrn-date">'+esc(new Intl.DateTimeFormat('ar-EG-u-nu-latn',{timeZone:'Africa/Cairo',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date()))+'</p><p class="hrn-left" data-hrn-left role="status"></p><ul class="hrn-rows" data-hrn-rows></ul><p class="hrn-done" data-hrn-done hidden>خلصت كل اللي مستنيك النهارده.</p><p class="hrn-loading" data-hrn-loading>بنشوف الساعات الإضافية والمخالصات والتبديلات والتأمينات…</p></div>');
  var box=host.querySelector('.hrn-inbox');
  function draw(all,done){var list=box.querySelector('[data-hrn-rows]'),total=all.reduce(function(a,q){return a+q.n;},0);list.innerHTML=all.map(rowHtml).join('');box.querySelector('[data-hrn-left]').textContent=total?total+' حاجات مستنياك':'';box.querySelector('[data-hrn-done]').hidden=!done||!!all.length;box.querySelector('[data-hrn-loading]').hidden=!!done;
    list.querySelectorAll('[data-hrn-go]').forEach(function(b){b.onclick=function(){var q=all.find(function(x){return x.id===b.dataset.hrnGo;});if(q&&opts.open)opts.open(q);};});
    if(opts.onCounts)opts.onCounts(all);}
  draw(rows,false);
  return asyncRows(me,month).then(function(more){if(host.__hrn!==serial||!host.isConnected)return;draw(rows.concat(more),true);});}
w.SSMPDHRToday={mount:mount,reset:function(){cache=null;}};
})(window);
