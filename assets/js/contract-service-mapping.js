/* SWNW — contracting service-name mapping + unsectioned services workspace. */
(function(w){'use strict';
if(w.__SWNWContractServiceMapping)return;w.__SWNWContractServiceMapping=true;

function e(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function toast(msg){if(w.SSMPDToast&&w.SSMPDToast.show)w.SSMPDToast.show(msg);else alert(msg);}
async function rpc(name,args){var r=await w.SSMPDDb.client.rpc(name,args||{});if(r.error)throw Error(r.error.message||'تعذر تنفيذ العملية');return r.data;}
function serviceName(data,id){var s=(data.services||[]).find(function(x){return x.id===id;});return s?s.name:'خدمة غير معروفة';}
function sectionName(sections,id){if(!id)return 'بدون قسم';var s=sections.find(function(x){return x.id===id;});return s?s.name:'بدون قسم';}
function isEditable(l){var a=w.SSMPDAuth&&w.SSMPDAuth.currentAdmin;return !!(a&&l&&l.status==='draft'&&(l.can_edit!==undefined?l.can_edit:l.created_by===a.id));}

async function open(listId){
  var origin=document.activeElement,priceRoot=origin&&origin.closest?origin.closest('.wp'):null,refreshHost=priceRoot?priceRoot.parentElement:null,changed=false,data=null;
  var box=document.createElement('div');
  box.className='wp-overlay';
  box.innerHTML='<section class="wp-modal" role="dialog" aria-modal="true" aria-label="مطابقة أسماء الخدمات والأقسام" style="max-width:1100px;width:min(96vw,1100px)"><header><div><h2>مطابقة أسماء الخدمات والأقسام</h2><p style="margin:.25rem 0 0">تحميل بيانات اللائحة…</p></div><button type="button" aria-label="إغلاق" data-map-close>×</button></header><div data-map-body style="padding:1rem"></div></section>';
  document.body.appendChild(box);
  function close(){
    box.remove();
    if(changed&&refreshHost&&refreshHost.isConnected&&w.SSMPDContractPrices&&w.SSMPDContractPrices.render&&data){
      var l=(data.lists||[]).find(function(x){return x.id===listId;}),c=l?(data.contracts||[]).find(function(x){return x.id===l.contract_id;}):null;
      var insideEntity=origin&&origin.closest&&origin.closest('[data-ce-file-panel="prices"]');
      var scope=l&&!l.contract_id?'center':insideEntity&&c?c.entity_id:'entities';
      try{w.SSMPDContractPrices.render(refreshHost,scope);}catch(_e){}
    }else if(origin&&origin.isConnected)origin.focus();
  }
  box.querySelector('[data-map-close]').onclick=close;
  box.addEventListener('keydown',function(ev){if(ev.key==='Escape'){ev.preventDefault();close();}});
  var body=box.querySelector('[data-map-body]'),state={tab:'all',query:'',selected:null,busy:false};

  async function load(keepSelected){
    try{
      data=await rpc('price_lists_workspace');
      var l=(data.lists||[]).find(function(x){return x.id===listId;});
      if(!l)throw Error('تعذر العثور على لائحة الأسعار');
      var listItems=(data.items||[]).filter(function(x){return x.list_id===listId;});
      if(!keepSelected||!listItems.some(function(x){return x.id===state.selected;}))state.selected=listItems[0]?listItems[0].id:null;
      if(state.tab==='unsectioned'){
        var chosen=listItems.find(function(x){return x.id===state.selected;});
        if(chosen&&chosen.section_id){var firstFree=listItems.find(function(x){return !x.section_id;});state.selected=firstFree?firstFree.id:null;}
      }
      draw();
    }catch(err){body.innerHTML='<p role="alert">'+e(err.message)+'</p>';}
  }

  function current(){return (data.items||[]).filter(function(x){return x.list_id===listId;});}
  function sections(){return (data.sections||[]).filter(function(x){return x.list_id===listId;});}
  function selected(){return current().find(function(x){return x.id===state.selected;})||null;}
  function contractFor(l){return (data.contracts||[]).find(function(x){return x.id===l.contract_id;})||null;}
  function externalOptions(items){var seen={},out=[];items.forEach(function(i){var n=(i.external_name||'').trim();if(n&&!seen[n]){seen[n]=1;out.push([i.id,n,i.service_id]);}});return out.sort(function(a,b){return a[1].localeCompare(b[1],'ar');});}

  function draw(){
    var l=(data.lists||[]).find(function(x){return x.id===listId;}),items=current(),secs=sections(),sel=selected(),contract=contractFor(l),editable=isEditable(l),unsectioned=items.filter(function(i){return !i.section_id;}).length;
    var filtered=items.filter(function(i){if(state.tab==='unsectioned'&&i.section_id)return false;var s=serviceName(data,i.service_id),hay=(s+' '+(i.external_name||'')+' '+(i.external_code||'')+' '+sectionName(secs,i.section_id)).toLocaleLowerCase();return !state.query||hay.includes(state.query.toLocaleLowerCase());});
    var centerOpts=(data.services||[]).filter(function(s){return s.active;}).slice().sort(function(a,b){return a.name.localeCompare(b.name,'ar');}),extOpts=externalOptions(items);
    box.querySelector('header p').textContent=(contract?contract.name:'لائحة أسعار المركز')+' · '+(editable?'مسودة قابلة للتعديل':'عرض فقط — التعديل متاح في مسودة اللائحة فقط');
    body.innerHTML=
      '<div class="wp-actions" style="align-items:end;flex-wrap:wrap">'+
        '<label class="wp-field" style="min-width:260px">اختيار من قائمة سونو<select data-map-center><option value="">اختر خدمة سونو</option>'+centerOpts.map(function(s){return '<option value="'+e(s.id)+'" '+(sel&&sel.service_id===s.id?'selected':'')+'>'+e(s.name)+'</option>';}).join('')+'</select></label>'+
        '<label class="wp-field" style="min-width:260px">اختيار من قائمة الجهة<select data-map-external '+(!l.contract_id?'disabled':'')+'><option value="">'+(l.contract_id?'اختر مسمى الجهة':'لائحة المركز')+'</option>'+extOpts.map(function(x){return '<option value="'+e(x[0])+'" '+(sel&&sel.id===x[0]?'selected':'')+'>'+e(x[1])+'</option>';}).join('')+'</select></label>'+
        '<label class="wp-field" style="min-width:240px">بحث<input type="search" data-map-search value="'+e(state.query)+'" placeholder="اسم سونو أو اسم الجهة أو الكود"></label>'+
      '</div>'+
      '<div class="wp-actions" role="tablist" aria-label="فلترة الخدمات">'+
        '<button type="button" class="btn '+(state.tab==='all'?'':'ghost')+'" data-map-tab="all">كل الخدمات · '+items.length+'</button>'+
        '<button type="button" class="btn '+(state.tab==='unsectioned'?'':'ghost')+'" data-map-tab="unsectioned">خدمات بدون أقسام · '+unsectioned+'</button>'+
      '</div>'+
      (sel?selectedCard(sel,secs,editable):'<p class="wn-empty">اختر خدمة من قائمة سونو أو من قائمة الجهة لعرض المطابقة.</p>')+
      '<h3 style="margin-top:1.25rem">'+(state.tab==='unsectioned'?'خدمات بدون أقسام':'خدمات اللائحة')+'</h3><div data-map-list>'+rows(filtered,secs,editable)+'</div>';
    bind(editable);
  }

  function selectedCard(i,secs,editable){
    var s=serviceName(data,i.service_id),external=i.external_name||'غير محدد';
    return '<section class="wp-detail" style="margin-top:1rem"><div class="wp-actions" style="align-items:center;flex-wrap:wrap"><h3 style="margin:0">'+e(s)+'</h3><button type="button" class="btn ghost" data-map-external-button="'+e(i.id)+'">اسم الخدمة في جهة التعاقد: '+e(external)+'</button></div>'+
      '<div class="wp-facts"><div><small>المسمى المعتمد في سونو</small><b>'+e(s)+'</b></div><div><small>مسمى الجهة</small><b>'+e(external)+'</b></div><div><small>كود الجهة</small><b>'+e(i.external_code||'—')+'</b></div><div><small>القسم</small><b>'+e(sectionName(secs,i.section_id))+'</b></div></div>'+
      (editable?'<div class="wp-actions" style="align-items:end;flex-wrap:wrap"><label class="wp-field" style="min-width:260px">القسم<select data-map-section data-item="'+e(i.id)+'"><option value="">بدون قسم</option>'+secs.map(function(x){return '<option value="'+e(x.id)+'" '+(i.section_id===x.id?'selected':'')+'>'+e(x.name)+'</option>';}).join('')+'</select></label><button type="button" class="btn ghost" data-map-edit="'+e(i.id)+'">تعديل المطابقة</button></div>':'')+'<div data-map-editor></div></section>';
  }

  function rows(items,secs,editable){
    if(!items.length)return '<p class="wn-empty">'+(state.tab==='unsectioned'?'لا توجد خدمات بدون أقسام. كل الخدمات الحالية مرتبطة بأقسام.':'لا توجد خدمات تطابق البحث الحالي.')+'</p>';
    return '<div class="wp-grid">'+items.map(function(i){return '<article class="wp-card" style="text-align:right"><button type="button" data-map-select="'+e(i.id)+'" style="all:unset;cursor:pointer;display:block;width:100%"><b>'+e(serviceName(data,i.service_id))+'</b></button><button type="button" class="btn ghost" data-map-select="'+e(i.id)+'" style="margin-top:.5rem;width:100%;white-space:normal">اسم الخدمة في جهة التعاقد: '+e(i.external_name||'غير محدد')+'</button><small style="display:block;margin-top:.5rem">'+e(sectionName(secs,i.section_id))+(i.external_code?' · '+e(i.external_code):'')+'</small>'+(editable?'<label class="wp-field" style="margin-top:.5rem">القسم<select data-map-row-section data-item="'+e(i.id)+'"><option value="">بدون قسم</option>'+secs.map(function(x){return '<option value="'+e(x.id)+'" '+(i.section_id===x.id?'selected':'')+'>'+e(x.name)+'</option>';}).join('')+'</select></label>':'')+'</article>';}).join('')+'</div>';
  }

  function bind(editable){
    body.querySelectorAll('[data-map-tab]').forEach(function(b){b.onclick=function(){state.tab=b.dataset.mapTab;var list=current().filter(function(i){return state.tab!=='unsectioned'||!i.section_id;});if(!list.some(function(i){return i.id===state.selected;}))state.selected=list[0]?list[0].id:null;draw();};});
    var search=body.querySelector('[data-map-search]');if(search)search.oninput=function(){state.query=search.value;var pos=search.selectionStart;draw();var n=body.querySelector('[data-map-search]');if(n){n.focus();n.setSelectionRange(pos,pos);}};
    var center=body.querySelector('[data-map-center]');if(center)center.onchange=function(){var item=current().find(function(i){return i.service_id===center.value;});state.selected=item?item.id:null;draw();if(!item&&center.value)toast('الخدمة موجودة في قائمة سونو لكنها غير مضافة إلى لائحة الجهة الحالية');};
    var external=body.querySelector('[data-map-external]');if(external)external.onchange=function(){state.selected=external.value||null;draw();};
    body.querySelectorAll('[data-map-select],[data-map-external-button]').forEach(function(b){b.onclick=function(){state.selected=b.dataset.mapSelect||b.dataset.mapExternalButton;draw();};});
    if(!editable)return;
    body.querySelectorAll('[data-map-section],[data-map-row-section]').forEach(function(sel){sel.onchange=async function(){try{await saveItem(sel.dataset.item,{section_id:sel.value||null});}catch(_e){}};});
    body.querySelectorAll('[data-map-edit]').forEach(function(b){b.onclick=function(){showEditor(b.dataset.mapEdit);};});
  }

  function showEditor(id){
    var i=current().find(function(x){return x.id===id;}),host=body.querySelector('[data-map-editor]');if(!i||!host)return;
    var services=(data.services||[]).filter(function(s){return s.active;}).slice().sort(function(a,b){return a.name.localeCompare(b.name,'ar');});
    host.innerHTML='<div class="wp-form" style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border,#ddd)"><label class="wp-field">المسمى المعتمد في سونو<select data-edit-service>'+services.map(function(s){return '<option value="'+e(s.id)+'" '+(s.id===i.service_id?'selected':'')+'>'+e(s.name)+'</option>';}).join('')+'</select></label><label class="wp-field">اسم الخدمة في جهة التعاقد<input data-edit-external value="'+e(i.external_name||'')+'" placeholder="المسمى كما ورد من الجهة"></label><label class="wp-field">كود الجهة<input data-edit-code value="'+e(i.external_code||'')+'"></label><div class="wp-actions wp-wide"><button type="button" class="btn" data-edit-save>حفظ المطابقة</button><button type="button" class="btn ghost" data-edit-cancel>إلغاء</button></div><p class="wp-wide" role="alert" data-edit-error></p></div>';
    host.querySelector('[data-edit-cancel]').onclick=function(){host.innerHTML='';};
    host.querySelector('[data-edit-save]').onclick=async function(){var service=host.querySelector('[data-edit-service]').value,external=host.querySelector('[data-edit-external]').value.trim(),code=host.querySelector('[data-edit-code]').value.trim();try{await saveItem(i.id,{service_id:service,external_name:external||null,external_code:code||null});}catch(err){var p=host.querySelector('[data-edit-error]');if(p)p.textContent=err.message;}};
  }

  async function saveItem(id,patch){
    if(state.busy)return;var i=current().find(function(x){return x.id===id;});if(!i)return;state.busy=true;
    try{
      await rpc('price_service_mapping_command',{p_payload:{list_id:listId,item_id:i.id,service_id:patch.service_id||i.service_id,section_id:Object.prototype.hasOwnProperty.call(patch,'section_id')?patch.section_id:(i.section_id||null),external_name:Object.prototype.hasOwnProperty.call(patch,'external_name')?patch.external_name:(i.external_name||null),external_code:Object.prototype.hasOwnProperty.call(patch,'external_code')?patch.external_code:(i.external_code||null),unit:i.unit||null}});
      changed=true;toast(Object.prototype.hasOwnProperty.call(patch,'section_id')?'تم تحديث قسم الخدمة':'تم حفظ مطابقة اسم الخدمة');state.selected=i.id;await load(true);
    }catch(err){toast(err.message);throw err;}finally{state.busy=false;}
  }

  await load(false);
}

function enhance(){
  document.querySelectorAll('.wp-detail').forEach(function(detail){
    if(detail.dataset.serviceMappingReady)return;var root=detail.closest('.wp');if(!root)return;var card=root.querySelector('.wp-card[data-pi="open"][aria-expanded="true"]');if(!card||!card.dataset.id)return;var actions=detail.querySelector(':scope > .wp-actions');if(!actions)return;
    detail.dataset.serviceMappingReady='1';var btn=document.createElement('button');btn.type='button';btn.className='btn ghost';btn.dataset.openServiceMapping=card.dataset.id;btn.textContent='مطابقة الخدمات والأقسام';actions.appendChild(btn);btn.onclick=function(){open(btn.dataset.openServiceMapping);};
    rpc('price_lists_workspace').then(function(data){if(!btn.isConnected)return;var count=(data.items||[]).filter(function(i){return i.list_id===card.dataset.id&&!i.section_id;}).length;if(count)btn.textContent='مطابقة الخدمات والأقسام · '+count+' بدون قسم';}).catch(function(){});
  });
}

var observer=new MutationObserver(enhance);observer.observe(document.documentElement,{childList:true,subtree:true});if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',enhance,{once:true});else enhance();
w.SWNWContractServiceMapping={open:open};
})(window);
