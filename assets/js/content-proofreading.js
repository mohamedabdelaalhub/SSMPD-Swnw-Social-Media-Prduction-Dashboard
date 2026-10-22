/* Optional language review before content writes. No silent rewriting or persistent text cache. */
(function () {
  'use strict';
  var labels = {title:'العنوان',body:'نص المحتوى',hook_text:'الجملة الافتتاحية',content_angle:'زاوية المحتوى',script_text:'السكريبت',caption_text:'كابشن النشر',cta_text:'نص الدعوة للتفاعل',hypothesis_reason:'سبب الفكرة',design_headline:'عنوان التصميم',design_subtitle:'السطر التوضيحي',design_secondary_headline:'العنوان الثانوي',design_body:'نص التصميم',design_cta:'دعوة التصميم للتفاعل'};
  var categories = {spelling:'إملاء',punctuation:'ترقيم وعلامات ترقيم',grammar:'قواعد نحوية',diacritics:'تشكيل'};
  var queue = Promise.resolve();
  function collect(row) {
    var fields = {}, entries = [], copy = Object.assign({}, row);
    function add(owner, key, label) {
      if (typeof owner[key] !== 'string' || !owner[key].trim()) return;
      var id = 'f' + entries.length;
      fields[id] = owner[key]; entries.push({id:id,label:label,set:function (value) { owner[key] = value; }});
    }
    Object.keys(labels).forEach(function (key) { add(copy,key,labels[key]); });
    // Only known published copy inside the agent envelope. Preserve unrelated metadata and sources.
    var raw, wasString = typeof row.agent_raw_output === 'string';
    try { raw = JSON.parse(wasString ? row.agent_raw_output : JSON.stringify(row.agent_raw_output)); } catch (_) {}
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      ['design_headline','design_subtitle','design_secondary_headline','design_body','design_cta'].forEach(function(key){add(raw,key,labels[key]);});
      if (Array.isArray(raw.carousel_copy)) raw.carousel_copy.forEach(function (slide,i) {
        if (slide && typeof slide === 'object') ['headline','body'].forEach(function(key){add(slide,key,'شريحة '+(i+1)+' — '+(key==='headline'?'العنوان':'النص'));});
      });
    }
    return {fields:fields,entries:entries,copy:copy,finish:function(){if(raw)copy.agent_raw_output=wasString?JSON.stringify(raw):raw;return copy;}};
  }
  function protectedParts(text) { return JSON.stringify(text.match(/https?:\/\/[^\s<>]+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|[#@][\p{L}\p{N}_]+|\+?\p{N}+(?:[.,٫٬:/+\-]\p{N}+)*/gu)||[]); }
  function validate(result, fields) {
    if (!result || result.complete !== true || !Array.isArray(result.issues) || result.issues.length>80) throw Error('لم تكتمل المراجعة.');
    var spans = {};
    return result.issues.map(function(issue) {
      if (!issue || !Object.prototype.hasOwnProperty.call(fields,issue.field) || !Object.prototype.hasOwnProperty.call(categories,issue.category) ||
          typeof issue.before!=='string' || !issue.before || typeof issue.after!=='string' || issue.before===issue.after ||
          issue.before.length>1800 || issue.after.length>1800 || typeof issue.reason!=='string' || !issue.reason.trim() || issue.reason.length>350) throw Error('اقتراح غير صالح.');
      var source=fields[issue.field],start=source.indexOf(issue.before),end=start+issue.before.length;
      if(start<0 || source.indexOf(issue.before,start+1)!==-1 || protectedParts(issue.before)!==protectedParts(issue.after) ||
          (issue.before.match(/\n/g)||[]).length!==(issue.after.match(/\n/g)||[]).length || /[<>]/.test(issue.after)) throw Error('تعذر مطابقة التصحيح.');
      var occupied=spans[issue.field]||(spans[issue.field]=[]);
      if(occupied.some(function(span){return start<span[1]&&end>span[0];}))throw Error('تصحيحات متداخلة.');
      occupied.push([start,end]);
      return Object.assign({},issue,{start:start,end:end});
    });
  }
  function run(row) {
    var data=collect(row);
    if(!data.entries.length)return Promise.resolve(row);
    return new Promise(function(resolve,reject) {
      var overlay=document.createElement('div');overlay.className='modal-backdrop proofreading-backdrop';
      overlay.innerHTML='<section id="proofreading-dialog" class="modal proofreading-modal" role="dialog" aria-modal="true" aria-labelledby="proofreading-title" dir="rtl">'+
        '<header class="modal-head"><h3 id="proofreading-title">مراجعة المحتوى لغويًا</h3><button type="button" class="modal-close" aria-label="الرجوع للمحتوى">×</button></header>'+
        '<div class="proofreading-content"><p class="proofreading-note">مراجعة الإملاء والنحو وعلامات الترقيم والتشكيل الموجود، مع الحفاظ على العامية والمعنى. راجع الاقتراحات قبل تطبيقها.</p>'+
        '<p data-proof-status role="status" aria-live="polite">جاري المراجعة اللغوية…</p><div data-proof-issues></div></div>'+
        '<footer class="proofreading-actions"><button type="button" class="btn" data-proof-apply hidden>تصحيح الأخطاء</button><button type="button" class="btn ghost" data-proof-skip hidden>أكمل بدون تصحيح</button><button type="button" class="btn ghost" data-proof-retry hidden>إعادة المراجعة</button><button type="button" class="btn ghost" data-proof-back>رجوع للمحتوى</button></footer></section>';
      var previous=document.activeElement, siblings=Array.from(document.body.children).map(function(el){return {el:el,inert:el.inert};});
      siblings.forEach(function(s){s.el.inert=true;});document.body.appendChild(overlay);
      var apply=overlay.querySelector('[data-proof-apply]'),skip=overlay.querySelector('[data-proof-skip]'),retry=overlay.querySelector('[data-proof-retry]'),status=overlay.querySelector('[data-proof-status]'),list=overlay.querySelector('[data-proof-issues]');
      var closed=false,request=0,issues=[];
      function close(value) {
        if(closed)return;closed=true;request++;
        document.removeEventListener('keydown',onKey,true);overlay.remove();
        siblings.forEach(function(s){s.el.inert=s.inert;});
        if(previous&&previous.isConnected&&!previous.closest('[inert]'))previous.focus();
        if(value)resolve(value);else reject(Error('تم الرجوع للمحتوى بدون حفظ.'));
      }
      function onKey(e) {
        if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();close(null);}
        if(e.key==='Tab'){
          var buttons=Array.from(overlay.querySelectorAll('button')).filter(function(b){return !b.hidden&&!b.disabled;});
          var index=buttons.indexOf(document.activeElement);e.preventDefault();e.stopImmediatePropagation();buttons[(index+(e.shiftKey?buttons.length-1:1))%buttons.length].focus();
        }
      }
      function node(tag,text,cls){var el=document.createElement(tag);el.textContent=text;if(cls)el.className=cls;return el;}
      async function review() {
        var current=++request;apply.hidden=skip.hidden=retry.hidden=true;list.replaceChildren();status.textContent='جاري المراجعة اللغوية…';
        try {
          if(data.entries.length>80||Object.values(data.fields).some(function(s){return s.length>16000;})||Object.values(data.fields).join('').length>24000)throw Error('المحتوى أطول من حد المراجعة.');
          var timeout;
          var result=await Promise.race([window.SSMPDDb.proofreadContent(data.fields),new Promise(function(_,fail){timeout=setTimeout(function(){fail(Error('انتهت مهلة المراجعة.'));},55000);})]).finally(function(){clearTimeout(timeout);});
          if(closed||current!==request)return;
          issues=validate(result,data.fields);
          if(!issues.length){close(row);return;}
          status.textContent='وجدنا '+issues.length+' ملاحظة لغوية مقترحة. لم يتم حفظ المحتوى بعد.';
          issues.forEach(function(issue,i){
            var card=node('article','', 'proofreading-issue'),entry=data.entries.find(function(x){return x.id===issue.field;});
            card.append(node('h4',(i+1)+'. '+entry.label+' · '+categories[issue.category]));
            var compare=node('div','', 'proofreading-compare');
            [['النص الحالي',issue.before,'proofreading-before'],['التصحيح المقترح',issue.after||'حذف العلامة الزائدة','proofreading-after']].forEach(function(part){var box=node('div','',part[2]);box.append(node('strong',part[0]),node('p',part[1]));compare.append(box);});
            card.append(compare,node('p',issue.reason,'proofreading-reason'));list.append(card);
          });
          apply.hidden=skip.hidden=false;apply.focus();
        } catch (_) {
          if(closed||current!==request)return;
          status.textContent='تعذرت المراجعة اللغوية أو لم تكتمل. النص لم يتغير. أعد المحاولة أو اختر المتابعة بالنص الأصلي.';
          skip.hidden=retry.hidden=false;retry.focus();
        }
      }
      apply.onclick=function(){
        apply.disabled=skip.disabled=true;
        data.entries.forEach(function(entry){var text=data.fields[entry.id];issues.filter(function(i){return i.field===entry.id;}).sort(function(a,b){return b.start-a.start;}).forEach(function(i){text=text.slice(0,i.start)+i.after+text.slice(i.end);});entry.set(text);});
        close(data.finish());
      };
      skip.onclick=function(){close(row);};retry.onclick=review;
      overlay.querySelector('[data-proof-back]').onclick=overlay.querySelector('.modal-close').onclick=function(){close(null);};
      document.addEventListener('keydown',onKey,true);overlay.querySelector('.modal-close').focus();review();
    });
  }
  function review(row){var snapshot=JSON.parse(JSON.stringify(row));var pending=queue.then(function(){return run(snapshot);});queue=pending.catch(function(){});return pending;}
  var db=window.SSMPDDb;
  if(db){
    ['createContentItem','updateContentItem'].forEach(function(name){
      var original=db[name];if(typeof original!=='function')return;
      db[name]=function(){var args=Array.from(arguments),index=name==='createContentItem'?0:1;
        if(!collect(args[index]).entries.length)return original.apply(db,args);
        return review(args[index]).then(function(row){args[index]=row;return original.apply(db,args);});
      };
    });
    var submit=db.submitContentDraft;
    if(submit)db.submitContentDraft=function(id){return db.getContentItem(id).then(function(item){return review(item).then(function(checked){var patch={};Object.keys(labels).concat(['agent_raw_output']).forEach(function(key){if(JSON.stringify(checked[key])!==JSON.stringify(item[key]))patch[key]=checked[key];});
      if(!Object.keys(patch).length)return submit.call(db,id);
      // One atomic write through the original stage-filtered, RLS-scoped transition.
      return submit.call(db,id,patch);
    });});};
  }
  window.SSMPDProofreading={review:review,collect:collect,validate:validate};
})();
