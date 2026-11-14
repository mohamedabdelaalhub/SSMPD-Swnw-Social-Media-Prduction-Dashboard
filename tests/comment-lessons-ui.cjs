// شاشة «اللي اتعلمته من تعليقاتك» + الدروس الفعّالة جوه الـBrief بتاع المولّد
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('assert/strict'),path=require('path');
const root=path.resolve(__dirname,'..'),tick=()=>new Promise(r=>setTimeout(r,5));
(async()=>{
  const dom=new JSDOM('<div id="h"></div>',{runScripts:'outside-only'}),w=dom.window;
  let lessons=[{id:'a',brand:'sono',content_format:'video',category:'font',lesson:'خط الكابشن في الريلز يبقى أكبر',example_comment:'الخط صغير',hits:3,status:'active'},
    {id:'b',brand:null,content_format:null,category:'text',lesson:'متكتبش أسعار',hits:1,status:'candidate'}];
  const calls=[];w.alert=m=>{throw Error(m);};
  w.SSMPDAuth={currentAdmin:{id:'o',role:'super_admin'}};
  w.SSMPDDb={listCommentLessons:async()=>lessons,setCommentLessonStatus:async(id,st)=>{calls.push([id,st]);lessons=lessons.map(l=>l.id===id?{...l,status:st}:l);},
    listActiveCommentLessons:async b=>{calls.push(['active',b]);return lessons.filter(l=>l.status==='active');},getContentLearningBrief:async()=>({mix:{},do_more:[],do_less:[],upcoming_occasions:[],weekly_recommendations:[]})};
  w.eval(fs.readFileSync(path.join(root,'assets/js/comment-lessons.js'),'utf8'));
  const CL=w.SSMPDCommentLessons,h=w.document.getElementById('h');
  h.innerHTML=CL.buttonHtml();CL.wire(h);h.querySelector('[data-cl-open]').click();await tick();
  const modal=w.document.querySelector('.modal-backdrop');assert(modal,'modal opens');
  assert.match(modal.textContent,/بيتطبّق \(1\)/);assert.match(modal.textContent,/مستني يتكرر \(1\)/);
  assert.match(modal.textContent,/خط الكابشن في الريلز يبقى أكبر/);assert.match(modal.textContent,/سونو · فيديو \/ ريل/);assert.match(modal.textContent,/الصفحتين · كل الأنواع/);assert.match(modal.textContent,/اتكرر 3 مرة/);
  modal.querySelector('[data-cl-id="a"][data-cl-status="disabled"]').click();await tick();
  assert.deepEqual(calls[0],['a','disabled']);assert.match(modal.textContent,/مقفول \(1\)/);
  assert(modal.querySelector('[data-cl-id="a"][data-cl-status="active"]'),'can re-enable');
  modal.querySelector('[data-cl-close]').click();assert(!w.document.querySelector('.modal-backdrop'));
  // موظف عادي: بيشوف بس، من غير أزرار
  w.SSMPDAuth.currentAdmin.role='designer';CL.open();await tick();
  assert(!w.document.querySelector('[data-cl-status]'),'no toggles for staff');w.document.querySelector('[data-cl-close]').click();
  // قبل التفعيل على السيرفر: رسالة واضحة
  w.SSMPDDb.listCommentLessons=async()=>{throw Error('relation "public.content_comment_lessons" does not exist');};CL.open();await tick();
  assert.match(w.document.querySelector('.modal-backdrop').textContent,/محتاجة تفعيل على السيرفر/);w.document.querySelector('[data-cl-close]').click();
  // الـBrief: الدروس الفعّالة بس، حتى لو ذاكرة الأداء فاضية
  lessons=lessons.map(l=>({...l,status:'active'}));
  w.eval(fs.readFileSync(path.join(root,'assets/js/learning-brief.js'),'utf8'));
  const t=await w.SSMPDLearningBrief.load('sono');
  assert.match(t,/OWNER EDIT LESSONS/);assert.match(t,/- \[فيديو\/ريل\] خط الكابشن في الريلز يبقى أكبر/);assert.match(t,/- متكتبش أسعار/);
  assert(calls.some(c=>c[0]==='active'&&c[1]==='sono'));
  assert.equal(w.SSMPDLearningBrief.build({},[]),'');
  console.log('PASS comment lessons UI (grouped list, owner disable/enable, read-only staff, not-yet-installed message, lessons in brief)');
})().catch(e=>{console.error(e);process.exit(1);});
