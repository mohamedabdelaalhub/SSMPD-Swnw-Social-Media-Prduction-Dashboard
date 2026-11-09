/* «فيديوهات الشرح»: training videos (Swnw voice, trial/test data only) per role, opened from the main menu.
   Videos live in assets/videos. Shows only the videos for the user's roles (managers see all). */
(function(root){'use strict';
var V='?v=training-20261109-2';
var ALL=['super_admin','general_manager'];
var LIST=[
 {f:'01-booking-arrival.mp4',t:'حجز موعد وتسجيل وصول',g:'الاستقبال: «تشغيل اليوم»',r:['reception','customer_service']},
 {f:'02-call-start.mp4',t:'نداء المريض وبدء الكشف',g:'الاستقبال: «تشغيل اليوم»',r:['reception','nursing','head_nursing']},
 {f:'03-service-finish.mp4',t:'طلب خدمة وإنهاء الزيارة',g:'الاستقبال: «تشغيل اليوم»',r:['reception','nursing','head_nursing']},
 {f:'04-noshow-reschedule-search.mp4',t:'لم يحضر، تغيير الميعاد، والبحث',g:'الاستقبال: «تشغيل اليوم»',r:['reception','customer_service']},
 {f:'09-leads.mp4',t:'الليدز: تسجيل رسالة عميل جديد',g:'الاستقبال وخدمة العملاء',r:['reception','customer_service']},
 {f:'05-my-tasks.mp4',t:'مهامي: إزاي تشتغل على مهمة وتسلّمها',g:'لكل الموظفين',r:['*']},
 {f:'07-my-kpi.mp4',t:'أدائي: إزاي تتابع مؤشر أدائك',g:'لكل الموظفين',r:['*']},
 {f:'08-menu-search-help.mp4',t:'القايمة والبحث والمساعدة',g:'لكل الموظفين',r:['*']},
 {f:'11-hr-self.mp4',t:'الموارد البشرية: ملفي وحضوري وطلباتي',g:'لكل الموظفين',r:['*']},
 {f:'06-manager-tasks.mp4',t:'المهام للمديرين: إسناد ومراجعة',g:'للمديرين',r:['general_manager','head_nursing','approver']},
 {f:'10-content.mp4',t:'فريق المحتوى: من الفكرة للنشر',g:'فريق المحتوى',r:['page_manager','designer','approver']}];
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function mine(){var a=root.SSMPDAuth&&root.SSMPDAuth.currentAdmin;if(!a)return [];var R=root.SSMPDRoles,roles=R&&R.rolesOf?R.rolesOf(a):[a.role];if(roles.some(function(x){return ALL.indexOf(x)!==-1;}))return LIST.slice();return LIST.filter(function(v){return v.r.indexOf('*')!==-1||v.r.some(function(x){return roles.indexOf(x)!==-1;});});}
function open(){var list=mine();if(!list.length)return;var d=document.createElement('div');d.className='modal-backdrop tv-videos';
 var groups=[];list.forEach(function(v){if(groups.indexOf(v.g)===-1)groups.push(v.g);});
 d.innerHTML='<section class="modal tv-videos-modal" dir="rtl" role="dialog" aria-modal="true" aria-label="فيديوهات الشرح"><i hidden data-dashboard-help="skip"></i><header class="modal-head"><h3>🎬 فيديوهات الشرح</h3><button type="button" class="modal-close" data-tv-close aria-label="إغلاق">×</button></header><div class="tv-videos-body"><div class="tv-player" hidden><video controls playsinline preload="metadata"></video><p class="tv-now"></p></div>'+groups.map(function(g){return '<h4>'+esc(g)+'</h4>'+list.filter(function(v){return v.g===g;}).map(function(v){return '<button type="button" class="tv-item" data-tv-file="'+esc(v.f)+'"><span>▶</span>'+esc(v.t)+'</button>';}).join('');}).join('')+'<p class="tv-note">الفيديوهات متصوّرة ببيانات تجريبية، مش بيانات مرضى حقيقية.</p></div></section>';
 document.body.appendChild(d);var vid=d.querySelector('video'),box=d.querySelector('.tv-player'),now=d.querySelector('.tv-now');
 function close(){vid.pause();d.remove();document.removeEventListener('keydown',key);}
 function key(e){if(e.key==='Escape')close();}
 d.addEventListener('click',function(e){if(e.target===d||e.target.closest('[data-tv-close]')){close();return;}var b=e.target.closest('[data-tv-file]');if(!b)return;d.querySelectorAll('.tv-item').forEach(function(x){x.classList.toggle('on',x===b);});box.hidden=false;vid.src='assets/videos/'+b.dataset.tvFile+V;now.textContent=b.textContent.replace('▶','').trim();vid.play().catch(function(){});box.scrollIntoView({block:'start',behavior:'smooth'});});
 document.addEventListener('keydown',key);d.querySelector('[data-tv-close]').focus();}
function inject(){var items=document.querySelector('#user-dropdown .ud-items');if(!items||items.querySelector('[data-training-videos]')||!mine().length)return;var b=document.createElement('button');b.type='button';b.className='ud-item';b.dataset.trainingVideos='1';b.textContent='🎬 فيديوهات الشرح';b.onclick=function(){var m=document.getElementById('user-dropdown');if(m)m.classList.remove('open');open();};var first=items.querySelector(':scope > .ud-item:not([data-goto])');items.insertBefore(b,first||null);}
root.SSMPDTrainingVideos={open:open,list:mine};
setInterval(inject,1500);document.addEventListener('click',function(e){if(e.target.closest('#user-menu-btn,#menu-toggle-btn'))setTimeout(inject,0);},true);
})(window);
