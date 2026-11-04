/* Unified, inspectable communication ledger for Swnw digital agents. */
(function(w){
 "use strict";
 if(w.SSMPDTeamComms)return;
 var db=null,seq=0,filters={agent:'all',kind:'all'},members={},sentOnce=false,loading=false;
 var kinds={question:'سؤال',instruction:'تعليمات',task:'مهمة',handoff:'طلب مساعدة',
  acknowledgement:'استلام صندوق التنسيق',answer:'إجابة',status:'حالة التسليم',handoff_request:'سؤال بين الوكلاء',
  handoff_answer:'إجابة وكيل',analysis_complete:'اكتمل التحليل',blocked:'عائق / مشكلة',
  runtime_receipt:'استلام المحرك',execution_report:'تقرير تنفيذ'};
 var statuses={queued:'بانتظار المعالجة',acknowledged:'وصل صندوق التنسيق',analyzing:'جارٍ التحليل',
  analysis_complete:'التحليل مكتمل · التنفيذ الخارجي لم يبدأ',awaiting_runtime:'المحرك التشغيلي غير مربوط',
  blocked:'متوقف',failed:'تعذر التحليل',execution_verified:'تم التحقق من التنفيذ'};
 var roles={sia:'سيا',hapi:'حابي',claude_creative:'Claude Creative',hor:'حور',hotep:'حتب',nefer:'نفر',maat:'ماعت'};
 var escape=function(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});};
 function client(){if(db)return db;var c=w.SSMPD_CONFIG?.supabase;if(!c||!w.supabase)return null;
  return db=w.supabase.createClient(c.url,c.anonKey,{auth:{persistSession:true,autoRefreshToken:true}});}
 function name(id){return id?roles[id]||members[id]||id:'الإدارة';}
 function fmt(v){return v?new Date(v).toLocaleString('ar-EG',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';}
 function root(){return document.querySelector('.digital-team');}
 function pane(){var r=root();return r&&r.querySelector('[data-dtc-panel]');}
 function status(s){var x=pane()?.querySelector('[data-dtc-status]');if(x)x.textContent=s;}
 function shell(){
   var r=root();if(!r||r.querySelector('[data-dtc-panel]')||!w.SSMPDDigitalTeam?.isOwner?.())return;
   var section=document.createElement('section');section.className='dtc-panel';section.setAttribute('data-dtc-panel','');
   section.innerHTML='<header class="dtc-heading"><div><p class="dt-eyebrow">Digital Team Coordination</p><h2>مراسلات الفريق الرقمي</h2><p>مين كلم مين، نوع الرسالة، الرد، المشاكل، وحالة التنفيذ الفعلية.</p></div><button class="btn ghost sm" type="button" data-dtc-refresh>تحديث السجل</button></header>'+
    '<div class="dtc-hint">الاستلام هنا يعني استلام صندوق التنسيق فقط. رد الوكيل الاستشاري لا يعني تنفيذ إجراء في الحجز أو واتساب أو حسابات المركز. المحركات غير المربوطة هتظهر بوضوح.</div>'+
    '<form class="dtc-compose" data-dtc-form>'+
    '<div class="dtc-compose-row"><label>المرسل إليه<select name="recipient"><option value="all">الفريق كله (7 وكلاء)</option>'+
      Object.keys(roles).map(function(k){return '<option value="'+escape(k)+'">'+escape(roles[k])+'</option>';}).join('')+
    '</select></label><label>نوع الرسالة<select name="kind"><option value="question">سؤال أو استفسار</option><option value="instruction">تعليمات وتوجيه</option><option value="task">تكليف بمهمة</option></select></label></div>'+
    '<label>الرسالة أو وصف المهمة<textarea name="body" required minlength="3" maxlength="4000" rows="4" placeholder="مثال: يا حور راجع تأخر بداية الكشف وحلل الأسباب واقترح الحلول، واطلب رأي حتب في أثر الانتظار على المرضى."></textarea></label>'+
    '<div class="dtc-compose-actions"><button type="submit" class="btn primary">إرسال إلى صندوق الفريق</button><span>التحليل والمناقشة متاحان، الإجراءات التنفيذية تحتاج ربطًا وتفويضًا مستقلين.</span></div></form>'+
    '<div data-dtc-status class="dtc-status" role="status"></div>'+
    '<div class="dtc-tools"><h3>سجل التواصل والمتابعة</h3><div class="dtc-filters"><select data-dtc-agent aria-label="فلترة حسب الوكيل"><option value="all">كل الوكلاء</option>'+
     Object.keys(roles).map(function(k){return '<option value="'+escape(k)+'">'+escape(roles[k])+'</option>';}).join('')+
     '</select><select data-dtc-kind aria-label="فلترة حسب نوع الرسالة"><option value="all">كل الأنواع</option><option value="question">أسئلة</option><option value="instruction">تعليمات</option><option value="task">مهام</option><option value="handoff">تواصل بين الوكلاء</option></select></div></div>'+
    '<div class="dtc-feed" data-dtc-feed><p class="dt-placeholder">جارٍ تحميل السجل…</p></div>'+
    '<section class="dtc-scans"><h3>الفحص التلقائي لمرفقات المهام</h3><p>الفحص بيتم بعد تسليم المرفق ومن خلال الجدولة. لا يحتاج الضغط على زر لفحص كل ملف.</p><div data-dtc-scans>جارٍ قراءة حالة الفحص…</div></section>';
   r.appendChild(section);
   var form=section.querySelector('[data-dtc-form]');
   form.onsubmit=function(e){e.preventDefault();send(form);};
   section.querySelector('[data-dtc-refresh]').onclick=refresh;
   var a=section.querySelector('[data-dtc-agent]');a.value=filters.agent;a.onchange=function(v){filters.agent=a.value;refresh();};
   var k=section.querySelector('[data-dtc-kind]');k.value=filters.kind;k.onchange=function(v){filters.kind=k.value;refresh();};
   refresh();loadScans();
 }
 function line(e){
  var from=name(e.from_agent_code),to=name(e.to_agent_code);
  var type=kinds[e.message_type]||e.message_type;
  var flag=e.provenance==='agent_ai'?'رد من محرك التحليل':e.provenance==='external_verified'?'إجراء موثق':e.provenance==='owner'?'رسالة الإدارة':'حدث النظام';
  return '<div class="dtc-event '+escape(e.message_type)+'"><div class="dtc-event-head"><b>'+'من '+escape(from)+' إلى '+escape(to)+'</b><span>'+escape(type)+'</span><small>'+escape(fmt(e.created_at))+'</small></div>'+
   '<p>'+escape(e.content)+'</p><small>'+escape(flag)+(e.execution_verified?' · تنفيذ متحقق منه':'')+'</small></div>';
 }
 function card(d,events){
  var typ=kinds[d.message_kind]||d.message_kind;
  var who=d.from_agent_code?name(d.from_agent_code):'الإدارة';
  var e=events.filter(function(x){return x.dispatch_id===d.id;});
  return '<article class="dtc-dispatch"><div class="dtc-dispatch-head"><div><b>'+escape(who)+' → '+escape(name(d.recipient_code))+'</b><span>'+escape(typ)+' · '+escape(fmt(d.created_at))+'</span></div><span class="dtc-state '+escape(d.state)+'">'+escape(statuses[d.state]||d.state)+'</span></div>'+
   '<div class="dtc-request">'+escape(d.body)+'</div><div class="dtc-events">'+e.map(line).join('')+'</div>'+
   (d.blocked_reason?'<div class="dtc-blocked">'+escape(d.blocked_reason)+'</div>':'')+
   '<div class="dtc-verification">'+(d.state==='execution_verified'?'يوجد تحقق تنفيذ مسجل':'لا يوجد اعتماد لتنفيذ خارجي من صندوق التنسيق')+'</div></article>';
 }

 async function loadScans(){
  var el=pane()?.querySelector('[data-dtc-scans]');if(!el||!client())return;
  try{
   var r=await client().rpc('task_file_scan_overview',{p_limit:24});if(r.error)throw r.error;
   var data=r.data||{},counts=data.counts||{},recent=Array.isArray(data.recent)?data.recent:[];
   var names={pending:'بانتظار الفحص',processing:'جارٍ الفحص',scanned:'تم التحليل',needs_access:'تحتاج صلاحية Drive',unsupported:'تحتاج طريقة قراءة أخرى',restricted:'مراجعة بشرية محمية',retry:'إعادة محاولة',failed:'تعذر الفحص'};
   var stats=Object.keys(names).map(function(k){return counts[k]?'<span class="dtc-scan-count">'+escape(names[k])+' <b>'+escape(counts[k])+'</b></span>':'';}).join('');
   var rows=recent.map(function(x){
     var a=x.analysis||{},note=Array.isArray(a.findings)?a.findings.slice(0,2).join('، '):'';
     return '<article class="dtc-scan-row"><div><b>'+escape(x.file_name)+'</b><span>'+escape(names[x.state]||x.state)+'</span></div>'+
       (x.summary?'<p>'+escape(x.summary)+'</p>':'')+(note?'<small>ملاحظات: '+escape(note)+'</small>':'')+'</article>';
   }).join('');
   el.innerHTML='<div class="dtc-scan-counts">'+(stats||'لم يبدأ فحص مرفقات بعد.')+'</div>'+
      '<div class="dtc-scan-list">'+(rows||'<p class="dt-placeholder">لا توجد مرفقات.</p>')+'</div>';
  }catch(e){el.textContent='تعذر قراءة حالة الفحص: '+(e.message||e);}
 }
 async function refresh(){
  var target=pane();if(!target||!client()||loading)return;loading=true;
  var ticket=++seq;
  var host=target.querySelector('[data-dtc-feed]');if(host)host.innerHTML='<p class="dt-placeholder">جارٍ قراءة حركة الفريق…</p>';
  try{
   var q=client().from('digital_team_dispatches').select('id,batch_id,parent_dispatch_id,from_agent_code,recipient_code,message_kind,body,state,analysis,blocked_reason,created_at,receipt_at,analysis_at')
    .order('created_at',{ascending:false}).limit(80);
   if(filters.agent!=='all')q=q.eq('recipient_code',filters.agent);
   if(filters.kind!=='all')q=q.eq('message_kind',filters.kind);
   var r=await q;if(r.error)throw r.error;
   var dispatches=r.data||[],ids=dispatches.map(function(x){return x.id;});
   var events=[];
   if(ids.length){
    var reply=await client().from('digital_team_events').select('id,dispatch_id,from_agent_code,to_agent_code,message_type,content,provenance,execution_verified,created_at')
      .in('dispatch_id',ids).order('created_at',{ascending:true}).limit(450);
    if(reply.error)throw reply.error;events=reply.data||[];
   }
   if(ticket!==seq||!pane())return;
   pane().querySelector('[data-dtc-feed]').innerHTML=dispatches.length?dispatches.map(function(x){return card(x,events);}).join(''):'<p class="dt-placeholder">مفيش مراسلات مسجلة بهذه الفلترة حتى الآن.</p>';
  }catch(e){if(ticket===seq&&pane())pane().querySelector('[data-dtc-feed]').textContent='تعذر تحميل سجل التنسيق: '+(e.message||e);}
  finally{loading=false;loadScans();}
 }
 async function send(form){
  var b=form.querySelector('button[type=submit]'),recipient=form.elements.recipient.value,kind=form.elements.kind.value,body=String(form.elements.body.value||'').trim();
  if(body.length<3)return;
  var targets=recipient==='all'?Object.keys(roles):[recipient];
  b.disabled=true;status('جارٍ تسجيل التوجيهات…');
  try{
   var r=await client().rpc('digital_team_send',{p_targets:targets,p_kind:kind,p_body:body});
   if(r.error)throw r.error;
   form.elements.body.value='';status('تم تسجيل '+r.data.count+' توجيه في صندوق التنسيق. جارٍ الحصول على ردود الوكلاء المرتبطين…');
   await refresh();
   var reply=await client().functions.invoke('digital-team-coordinator',{body:{dispatch_ids:r.data.dispatch_ids}});
   if(reply.error||!reply.data?.ok)throw Error(reply.data?.error||reply.error?.message||'تأخرت خدمة التحليل');
   var ready=(reply.data.dispatches||[]).filter(function(x){return x.state==='analysis_complete';}).length;
   var waiting=(reply.data.dispatches||[]).filter(function(x){return x.state==='awaiting_runtime';}).length;
   status('تمت مراجعة '+ready+' رسالة، و'+waiting+' بانتظار ربط المحرك الفعلي. لم يتم تنفيذ إجراءات خارجية.');
   await refresh();
  }catch(e){status('تم حفظ ما نجح من الرسائل، لكن بعض عمليات التنسيق تعذرت: '+(e.message||e)+'. راجع سجل الحالات.');await refresh();}
  finally{b.disabled=false;}
 }
 function init(){shell();}
 w.addEventListener('ssmpd-digital-team-rendered',init);
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
 w.SSMPDTeamComms={refresh:refresh};
})(window);