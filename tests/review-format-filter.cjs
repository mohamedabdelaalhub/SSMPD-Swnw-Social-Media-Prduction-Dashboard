// فلتر «نوع المادة» في إدارة المحتوى (طلب المالك 2026-11-14): فيديو/ريل · بوست · كاروسيل · بوست رابط · غير محدد
const {JSDOM}=require('jsdom'),fs=require('fs'),assert=require('assert/strict'),path=require('path');
const root=path.resolve(__dirname,'..'),tick=()=>new Promise(r=>setImmediate(r));
(async()=>{
  const dom=new JSDOM('<div id="view-container"></div>',{runScripts:'outside-only',url:'https://example.test'}),w=dom.window;
  const now=new Date().toISOString();
  const items=[
    {id:'v1',title:'ريل أسنان',content_format:'video',stage:'scheduled',updated_at:now},
    {id:'p1',title:'بوست جلدية',content_format:'image_post',stage:'scheduled',updated_at:now},
    {id:'c1',title:'كاروسيل نفسية',content_format:'carousel',stage:'scheduled',updated_at:now},
    {id:'l1',title:'بوست رابط',content_format:'link_post',stage:'published',updated_at:now},
    {id:'r1',title:'ريل قديم',format:'reel',stage:'scheduled',updated_at:now},
    {id:'u1',title:'بدون نوع',stage:'scheduled',updated_at:now}
  ];
  w.alert=()=>{};w.SSMPDI18n={textHtml:s=>s,text:s=>s,html:s=>s};w.SSMPDAuth={currentAdmin:{id:'me'}};
  w.eval(fs.readFileSync(path.join(root,'assets/js/workflow.js'),'utf8'));
  const W=w.SSMPDWorkflow;
  assert.equal(W.contentFormatKey({content_format:'carousel'}),'carousel');
  assert.equal(W.contentFormatKey({format:'Reel'}),'video');
  assert.equal(W.contentFormatKey({}),'');
  w.SSMPDComments={computeCommentStats:()=>({}),commentButtonHtml:()=>'',render:()=>{}};
  w.SSMPDDb={listContentItems:async()=>items,listAdminsBasic:async()=>[],listAllComments:async()=>[],listMyCommentReads:async()=>[],listDesignersAll:async()=>[],getAppSettings:async()=>null};
  w.eval(fs.readFileSync(path.join(root,'assets/js/days-cards.js'),'utf8'));
  w.eval(fs.readFileSync(path.join(root,'assets/js/render-review.js'),'utf8'));
  const box=w.document.getElementById('view-container');
  w.SSMPDRenderReview.render(box);await tick();await tick();
  w.document.querySelector('[data-rv-mode="list"]').click();await tick();
  const ids=()=>[...box.querySelectorAll('tr[data-id]')].map(r=>r.dataset.id).sort();
  const pick=async v=>{const s=box.querySelector('#rv-format');assert(s,'format filter shown');s.value=v;s.onchange();await tick();};
  assert.deepEqual(ids(),['c1','l1','p1','r1','u1','v1']);
  await pick('video');assert.deepEqual(ids(),['r1','v1']);
  await pick('image_post');assert.deepEqual(ids(),['p1']);
  await pick('carousel');assert.deepEqual(ids(),['c1']);
  await pick('none');assert.deepEqual(ids(),['u1']);
  // يتجمع مع فلتر المرحلة
  await pick('video');const st=box.querySelector('#rv-stage');st.value='scheduled';st.onchange();await tick();assert.deepEqual(ids(),['r1','v1']);
  st.value='published';st.onchange();await tick();assert.deepEqual(ids(),[]);
  // الفلتر بيفضل مختار في عرض كروت الأيام
  w.document.querySelector('[data-rv-mode="days"]').click();await tick();
  assert.equal(box.querySelector('#rv-format').value,'video');
  console.log('PASS review format filter (video/reel, post, carousel, link, unknown; combines with stage; kept across views)');
})().catch(e=>{console.error(e);process.exit(1);});
