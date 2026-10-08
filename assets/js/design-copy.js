(function(){
 'use strict';
 function clean(value){return String(value||'').replace(/["'“”‘’«»،,؛;:…]/g,' ').replace(/\s+/g,' ').trim();}
 function count(value){return clean(value).split(/\s+/).filter(Boolean).length;}
 function validate(copy){var limits={design_headline:5,design_subtitle:8,design_cta:4},out={};Object.keys(limits).forEach(function(key){out[key]=clean(copy[key]);if(!out[key]||count(out[key])>limits[key])throw new Error('المقترح غير مكتمل أو يتجاوز عدد الكلمات. لم يتم تطبيقه.');});return out;}
 function initial(item){
  var raw=item.agent_raw_output||item.raw_output||{};
  if(typeof raw==='string'){try{var match=raw.match(/SSMPD_STRUCTURED_JSON\s*([\s\S]*?)(?:SSMPD_STRUCTURED_JSON_END|$)/);raw=JSON.parse((match?match[1]:raw).replace(/^\s*```(?:json)?\s*/,'').replace(/\s*```\s*$/,''));}catch(e){raw={};}}
  raw=raw||{};
  if(raw.ideas||Array.isArray(raw)){var rows=raw.ideas||raw;raw=rows.find(function(row){return row.title===item.title;})||(rows.length===1?rows[0]:{});}
  return {headline:item.design_headline||raw.design_headline||item.hook_text||item.hook||item.title||'',subtitle:item.design_subtitle||raw.design_subtitle||'',cta:item.design_cta||raw.design_cta||''};
 }
 function mount(root,item,apply){
  var slot=document.createElement('div');slot.className='design-copy-tools';var button=document.createElement('button');button.type='button';button.className='btn ghost sm';button.dataset.copySuggest='';button.textContent='اقتراح نصوص التصميم';var result=document.createElement('div');result.setAttribute('aria-live','polite');slot.append(button,result);root.querySelector('[data-tool-panel="headline"]').append(slot);
  button.onclick=async function(){
   if(button.disabled)return;button.disabled=true;button.dataset.copyBusy='true';result.replaceChildren();result.textContent='جاري إعداد مقترح واحد…';
   try{var res=await window.SSMPDDb.client.functions.invoke('content-ai',{body:{mode:'design_copy',content_id:item.id}});if(res.error){var detail=res.error.message||'تعذر الاتصال بالسيرفر.';if(res.error.context&&typeof res.error.context.json==='function'){try{var failure=await res.error.context.json();detail=failure.error||failure.message||detail;}catch(ignore){}}throw new Error(detail);}if(!res.data)throw new Error('السيرفر لم يرجع نتيجة.');if(res.data.error)throw new Error(res.data.error);var copy=validate(res.data.design_copy||{});if(!root.isConnected)return;
    result.replaceChildren();[['العنوان الرئيسي','design_headline'],['السطر التوضيحي','design_subtitle'],['زر التفاعل','design_cta']].forEach(function(row){var p=document.createElement('p');p.textContent=row[0]+' — '+copy[row[1]];result.append(p);});
    var use=document.createElement('button');use.type='button';use.className='btn sm';use.textContent='تطبيق المقترح';use.onclick=function(){if(button.disabled)return;apply(copy);result.replaceChildren();result.textContent='تم تطبيق النصوص. راجع المعاينة ثم احفظ النسخة.';};var cancel=document.createElement('button');cancel.type='button';cancel.className='btn ghost sm';cancel.textContent='إلغاء';cancel.onclick=function(){result.replaceChildren();};result.append(use,cancel);
   }catch(e){result.textContent=e.message;}finally{delete button.dataset.copyBusy;button.disabled=false;}
  };
 }
 window.SSMPDDesignCopy={clean:clean,count:count,validate:validate,initial:initial,mount:mount};
})();

