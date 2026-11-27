/* «مراجعة أسماء الجهات» — review each insurer/union service name ONCE across every draft reference price list.
   Owner «طبقه» 2026-11-23 on docs/ui-references/mockups/price-review-by-name.html.
   Reads:  price_lists_workspace() (lists + catalogue) and price_service_mapping_workspace(list) per list.
   Writes: price_service_mapping_command — source_review («هي دي» / «اختار خدمة تانية»), source_defer («مش عندنا»).
   «بعدين» is local only. No new server code: same RPCs, rules and audit as the per-list review screen. */
(function(w){'use strict';
var S={host:null,data:null,lists:[],ws:{},groups:[],filter:'all',q:'',later:new Set(),picked:new Set(),busy:false,msg:'',serial:0};
function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function num(n){return Number(n||0).toLocaleString('en-US');}
function rpc(n,a){return w.SSMPDWorkforceUtils.rpc(n,a);}
function toast(t,k){if(w.SSMPDToast)w.SSMPDToast.show(t,k||'success');}
// Same normalization as the server-side matcher (tests/price-matching/01-matcher-readonly.sql).
function norm(v){var s=String(v||'');
 s=s.replace(/ٌ(?=ي)/g,'').replace(/ٌ/g,'ي').replace(/ً(?=[ )(]|$)/g,'ي');
 s=s.replace(/[()]\s*غير شامل[^()]*[()]/g,' ').replace(/[()]\s*(شامل|يشمل)[^()]*[()]/g,' شامل ').replace(/(غير شامل|لا يشمل|بدون) (ال)?مستلزمات/g,'');
 s=s.toLowerCase().replace(/[ً-ٰٟـ]/g,'').replace(/[*"'`|+؟…]/g,' ');
 s=s.replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[٠-٩]/g,d=>String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(/[()\[\]\-_/\\.,،:]/g,'');
 s=s.replace(/\s+/g,' ').replace(/(^| )(و ?)?ال/g,'$1').replace(/(^| )و( |$)/g,' ').replace(/(^| )شعه( |$)/g,'$1اشعه$2');
 return s.trim();}
function toks(n){return Array.from(new Set(n.split(' ').filter(t=>t.length>=2||/^\d$/.test(t))));}
function dice(a,b){var B=new Set(b),c=a.filter(t=>B.has(t)).length;return a.length+b.length?2*c/(a.length+b.length):0;}
function services(){return (S.data.services||[]).filter(s=>s.active!==false);}
function candidates(nn,limit){var a=toks(nn);if(!a.length)return [];return services().map(s=>{s._n=s._n||norm(s.name);s._t=s._t||toks(s._n);return {s:s,sim:dice(a,s._t)};}).filter(x=>x.sim>0).sort((x,y)=>y.sim-x.sim||String(x.s.name).localeCompare(y.s.name,'ar')).slice(0,limit||3);}
function editable(l){return l.list_kind==='reference'&&l.status==='draft'&&!l.deleted_at&&l.can_edit!==false&&!(l.valid_to&&l.valid_to<new Date().toISOString().slice(0,10));}
function short(n){return String(n||'').replace(/^(قائمة|لائحة) أسعار (شركة )?/,'');}
async function load(){var token=++S.serial;S.host.innerHTML='<p role="status">تحميل أسماء الجهات…</p>';
 try{S.data=await rpc('price_lists_workspace');S.lists=(S.data.lists||[]).filter(editable);S.ws={};
  for(var l of S.lists){S.ws[l.id]=await rpc('price_service_mapping_workspace',{p_list:l.id});if(token!==S.serial)return;}
  build();draw();}catch(err){if(token===S.serial)S.host.innerHTML='<p role="alert">'+esc(err.message)+'</p><button type="button" class="btn" data-pnr="retry">إعادة المحاولة</button>';bind();}}
function build(){var by=new Map();
 S.lists.forEach(l=>((S.ws[l.id]||{}).batches||[]).forEach(b=>{if(b.status!=='draft')return;(b.rows||[]).forEach((r,i)=>{
  if(r.confirmed===true||r.confirmed==='true'||r.review_status==='deferred'||r.review_status==='proposed')return;
  var nn=norm(r.name);if(!nn)return;if(!by.has(nn))by.set(nn,{key:nn,name:r.name,rows:[],lists:new Set()});var g=by.get(nn);g.rows.push({list:l,batch:b,index:i,row:r});g.lists.add(l.id);});}));
 S.groups=Array.from(by.values()).map(g=>{var p=g.rows.map(x=>Number(x.row.price)).filter(x=>x>0);g.pmin=p.length?Math.min(...p):0;g.pmax=p.length?Math.max(...p):0;g.cands=candidates(g.key,3);g.best=g.cands[0];
  g.odd=!p.length||(g.best&&g.best.s.base_price>0&&g.pmax>10*g.best.s.base_price);return g;}).sort((a,b)=>b.lists.size-a.lists.size||b.rows.length-a.rows.length||a.name.localeCompare(b.name,'ar'));
 S.picked.forEach(k=>{if(!S.groups.some(g=>g.key===k))S.picked.delete(k);});}
function shown(){var q=norm(S.q);return S.groups.filter(g=>{if(S.later.has(g.key)&&S.filter!=='later')return false;if(S.filter==='later'&&!S.later.has(g.key))return false;
 if(S.filter==='sug'&&!(g.best&&g.best.sim>=0.5))return false;if(S.filter==='none'&&g.best&&g.best.sim>=0.5)return false;if(S.filter==='odd'&&!g.odd)return false;
 if(q&&!(g.key.includes(q)||(g.best&&g.best.s._n.includes(q))))return false;return true;});}
function pill(k,t,n){return '<button type="button" class="pnr-pill" data-pnr-filter="'+k+'" aria-pressed="'+(S.filter===k)+'">'+t+' '+num(n)+'</button>';}
function draw(){var all=S.groups.filter(g=>!S.later.has(g.key)),rows=all.reduce((n,g)=>n+g.rows.length,0),list=shown(),page=list.slice(0,40);
 var per=S.lists.map(l=>short(l.name)+' '+num(S.groups.reduce((n,g)=>n+g.rows.filter(x=>x.list.id===l.id).length,0))).join(' · ');
 S.host.innerHTML='<div class="pnr"><p class="pnr-sub">كل اسم بيتراجع مرة واحدة، والقرار بيمشي على كل اللوايح اللي فيها نفس الاسم.</p>'+
 '<section class="pnr-hero"><div><b>'+num(all.length)+' اسم</b><small>'+num(rows)+' سطر في '+S.lists.length+' لوايح'+(S.later.size?' · مؤجل '+num(S.later.size):'')+'</small></div><div class="pnr-per">'+esc(per)+'</div></section>'+
 (S.msg?'<p class="pnr-msg" role="status">'+esc(S.msg)+'</p>':'')+
 '<div class="pnr-tools">'+pill('all','الكل',all.length)+pill('sug','ليها اقتراح',all.filter(g=>g.best&&g.best.sim>=0.5).length)+pill('none','مفيش اقتراح',all.filter(g=>!(g.best&&g.best.sim>=0.5)).length)+pill('odd','سعر غريب',all.filter(g=>g.odd).length)+(S.later.size?pill('later','بعدين',S.later.size):'')+
 '<input class="pnr-search" type="search" id="pnr-search" aria-label="بحث" placeholder="ابحث باسم الخدمة عند الجهة أو عندنا…" value="'+esc(S.q)+'"></div>'+
 (page.length?'<div class="pnr-list">'+page.map(card).join('')+'</div>'+(list.length>page.length?'<p class="pnr-more">بيظهر أول 40 من '+num(list.length)+'. خلّص دول أو استخدم البحث والفلاتر.</p>':''):'<p class="wn-empty">مفيش أسماء في الفلتر ده.</p>')+
 '</div>'+(S.picked.size?'<div class="pnr-bulk"><span>اخترت <b>'+num(S.picked.size)+'</b> اسم</span><div class="pnr-acts"><button type="button" class="btn pnr-no" data-pnr="bulk-absent">مش عندنا للمختار</button><button type="button" class="btn" data-pnr="bulk-later">بعدين</button><button type="button" class="btn" data-pnr="bulk-clear">إلغاء الاختيار</button></div></div>':'');
 bind();}
function card(g){var b=g.best,pct=b?Math.round(b.sim*100):0,lists=Array.from(g.lists).map(id=>short((S.lists.find(l=>l.id===id)||{}).name));
 return '<article class="pnr-card" data-key="'+esc(g.key)+'"><div class="pnr-head"><input type="checkbox" class="pnr-chk" data-pnr-pick aria-label="اختيار '+esc(g.name)+'"'+(S.picked.has(g.key)?' checked':'')+'><div><div class="pnr-name">'+esc(g.name)+'</div>'+
 '<div class="pnr-meta">في '+g.lists.size+' لوايح · '+g.rows.length+' سطر · السعر عندهم '+(g.pmin===g.pmax?num(g.pmin):'من '+num(g.pmin)+' لـ '+num(g.pmax))+' ج'+(g.pmax>3*g.pmin&&g.pmin>0?'<span class="pnr-chip warn">أسعار مختلفة جداً</span>':'')+(g.odd?'<span class="pnr-chip warn">سعر غريب</span>':'')+'</div>'+
 '<details class="pnr-lists"><summary>اللوايح</summary>'+esc(lists.join(' · '))+'</details></div></div>'+
 (b?'<div class="pnr-sug"><div class="pnr-meta">أقرب خدمة عندنا: <b>'+esc(b.s.name)+'</b> · <span class="pnr-pct'+(pct>=85?'':' low')+'">'+pct+'%</span> · سعرنا '+num(b.s.base_price)+' ج</div>'+
   (g.cands.length>1?'<div class="pnr-meta">اقتراحات تانية: '+g.cands.slice(1).map((c,i)=>'<button type="button" class="pnr-link" data-pnr="use" data-sid="'+esc(c.s.id)+'">'+esc(c.s.name)+' ('+Math.round(c.sim*100)+'%)</button>').join(' · ')+'</div>':'')+'</div>':'')+
 '<div class="pnr-acts">'+(b?'<button type="button" class="btn pnr-yes" data-pnr="use" data-sid="'+esc(b.s.id)+'">هي دي</button>':'')+'<button type="button" class="btn pnr-alt" data-pnr="other">اختار خدمة تانية</button><button type="button" class="btn pnr-no" data-pnr="absent">مش عندنا</button><button type="button" class="btn" data-pnr="later">'+(S.later.has(g.key)?'رجّعها':'بعدين')+'</button></div><div class="pnr-other" hidden></div></article>';}
function group(key){return S.groups.find(g=>g.key===key);}
// One RPC call per (list, batch, identical name/code/unit/category) — the RPC only accepts identical rows together.
function chunks(g){var m=new Map();g.rows.forEach(x=>{var k=x.batch.id+'|'+JSON.stringify([x.row.name||'',x.row.code||'',x.row.unit||'',x.row.category||'']);if(!m.has(k))m.set(k,{list:x.list,batch:x.batch,indexes:[]});m.get(k).indexes.push(x.index);});return Array.from(m.values());}
async function apply(keys,action,sid){if(S.busy)return;S.busy=true;S.host.querySelectorAll('button,input').forEach(n=>n.disabled=true);var ok=0,fail=[];
 try{for(var key of keys){var g=group(key);if(!g)continue;
  for(var c of chunks(g)){var l=S.lists.find(x=>x.id===c.list.id),b=((S.ws[l.id]||{}).batches||[]).find(x=>x.id===c.batch.id);
   try{var r=await rpc('price_service_mapping_command',{p_payload:{action:action,list_id:l.id,list_revision:l.revision,batch_id:b.id,batch_revision:b.revision,indexes:c.indexes,service_id:sid||null,details_confirmed:action==='source_review',
     note:action==='source_review'?'ربط من مراجعة أسماء الجهات':'مش عندنا — مراجعة أسماء الجهات'}});
    l.revision=r&&r.list_revision!=null?r.list_revision:l.revision+1;b.revision=r&&r.batch_revision!=null?r.batch_revision:b.revision+1;
    c.indexes.forEach(i=>{b.rows[i]=Object.assign({},b.rows[i],action==='source_review'?{confirmed:true,service_id:sid,review_status:'approved'}:{review_status:'deferred'});});ok+=c.indexes.length;}
   catch(err){fail.push(short(l.name)+': '+err.message);}}
  S.picked.delete(key);}}
 finally{S.busy=false;}
 S.msg=(action==='source_review'?'اتربط ':'اتستبعد ')+num(ok)+' سطر'+(fail.length?'. ما اتنفذش في: '+fail.slice(0,3).join(' — '):'.');
 toast(S.msg,fail.length?'error':'success');build();draw();}
function other(card,g){var box=card.querySelector('.pnr-other');box.hidden=false;
 box.innerHTML='<label class="wp-field">ابحث في خدماتنا<input type="search" id="pnr-other-'+Math.abs(hash(g.key))+'" data-pnr-other-q placeholder="اكتب جزء من اسم الخدمة"></label><div class="pnr-results" data-pnr-results></div>';
 var inp=box.querySelector('[data-pnr-other-q]'),res=box.querySelector('[data-pnr-results]');
 function show(){var q=norm(inp.value);var list=q.length<2?candidates(g.key,8):services().filter(s=>(s._n=s._n||norm(s.name)).includes(q)||String(s.code||'').includes(inp.value.trim())).slice(0,12).map(s=>({s:s}));
  res.innerHTML=list.length?list.map(x=>'<button type="button" class="pnr-res" data-pnr="use" data-sid="'+esc(x.s.id)+'">'+esc(x.s.name)+'<small>'+esc(x.s.category||'')+' · '+esc(x.s.code||x.s.canonical_code||'')+' · '+num(x.s.base_price)+' ج</small></button>').join(''):'<p class="pnr-meta">مفيش نتايج.</p>';
  res.querySelectorAll('[data-pnr=use]').forEach(n=>n.onclick=()=>apply([g.key],'source_review',n.dataset.sid));}
 inp.oninput=show;show();inp.focus();}
function hash(s){var h=0;for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;return h;}
function bind(){var h=S.host;
 h.querySelectorAll('[data-pnr=retry]').forEach(n=>n.onclick=load);
 h.querySelectorAll('[data-pnr-filter]').forEach(n=>n.onclick=()=>{S.filter=n.dataset.pnrFilter;draw();});
 var s=h.querySelector('#pnr-search');if(s){s.oninput=()=>{S.q=s.value;clearTimeout(S.t);S.t=setTimeout(()=>{draw();var x=S.host.querySelector('#pnr-search');if(x){x.focus();x.setSelectionRange(x.value.length,x.value.length);}},250);};}
 h.querySelectorAll('.pnr-card').forEach(card=>{var key=card.dataset.key,g=group(key);if(!g)return;
  card.querySelector('[data-pnr-pick]').onchange=e=>{e.target.checked?S.picked.add(key):S.picked.delete(key);draw();};
  card.querySelectorAll('.pnr-acts [data-pnr=use],.pnr-sug [data-pnr=use]').forEach(n=>n.onclick=()=>apply([key],'source_review',n.dataset.sid));
  card.querySelector('[data-pnr=other]').onclick=()=>other(card,g);
  card.querySelector('[data-pnr=absent]').onclick=()=>apply([key],'source_defer');
  card.querySelector('[data-pnr=later]').onclick=()=>{S.later.has(key)?S.later.delete(key):S.later.add(key);S.picked.delete(key);draw();};});
 var b=h.querySelector('[data-pnr=bulk-absent]');if(b)b.onclick=()=>apply(Array.from(S.picked),'source_defer');
 var bl=h.querySelector('[data-pnr=bulk-later]');if(bl)bl.onclick=()=>{S.picked.forEach(k=>S.later.add(k));S.picked.clear();draw();};
 var bc=h.querySelector('[data-pnr=bulk-clear]');if(bc)bc.onclick=()=>{S.picked.clear();draw();};}
function can(){return !!(w.SSMPDContractPrices&&w.SSMPDContractPrices.can&&w.SSMPDContractPrices.can());}
function render(host){S.host=host;S.msg='';S.picked.clear();return load();}
w.SSMPDPriceNameReview={render:render,can:can,_norm:norm,_dice:dice,_toks:toks};
})(window);
