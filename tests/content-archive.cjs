const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const root=__dirname+'/../',read=p=>fs.readFileSync(root+p,'utf8');
(async()=>{
 const w=new JSDOM('<main id="r"></main>',{runScripts:'outside-only',url:'https://example.test/'}).window;
 w.SSMPDPublicationText={compose:()=>'نص النشر',source:()=>'caption_text'};
 w.SSMPDDesignFiles={resolve:async u=>u};
 w.eval(read('assets/js/publication-preview.js'));
 const mount=item=>{const el=w.document.createElement('div');w.document.body.append(el);w.SSMPDPublicationPreview.mount(el,item,{details:false});return el;};
 // image post archived on Drive -> iframe preview + link + archive note
 let el=mount({brand:'sono',content_format:'image_post',design_file_url:'https://drive.google.com/file/d/AbC123/view',media_archived_at:'2026-10-13T00:00:00Z'});
 assert.equal(el.querySelector('iframe').src,'https://drive.google.com/file/d/AbC123/preview');
 assert(/drive\.google\.com\/file\/d\/AbC123/.test(el.querySelector('a.publication-preview__file').href));
 assert(/اتنقلت لجوجل درايف/.test(el.textContent),'archive note');
 // carousel with Drive slides -> thumbnail images, never the raw view page
 el=mount({brand:'sono',content_format:'carousel',carousel_slides:['https://drive.google.com/file/d/S1/view','https://drive.google.com/file/d/S2/view']});
 const slides=[...el.querySelectorAll('.publication-carousel__slide img')].map(i=>i.src);
 assert.deepEqual(slides,['https://drive.google.com/thumbnail?id=S1&sz=w1080','https://drive.google.com/thumbnail?id=S2&sz=w1080']);
 // video with a Drive reel and a Drive cover
 el=mount({brand:'dr_dina',content_format:'video',design_file_url:'https://drive.google.com/file/d/V1/view',cover_settings:{cover_image_url:'https://drive.google.com/file/d/C1/view'}});
 assert.equal(el.querySelector('iframe').src,'https://drive.google.com/file/d/V1/preview');
 await new Promise(r=>setTimeout(r,20));
 assert.equal(el.querySelector('.publication-preview__cover img').src,'https://drive.google.com/thumbnail?id=C1&sz=w480');
 // a private Supabase file still goes through the signed-url path
 let signedFor=null;w.SSMPDDesignFiles.resolve=async u=>{signedFor=u;return 'https://signed.example/x.png';};
 el=mount({brand:'sono',content_format:'image_post',design_file_url:'https://x.supabase.co/storage/v1/object/authenticated/content-designs/a/b/output.png'});
 await new Promise(r=>setTimeout(r,20));assert(signedFor&&el.querySelector('img'),'supabase file still signed');
 // wiring: bridge handler, edge function, config, migration
 const gs=read('apps-script/Code.gs');assert(/action === "content_archive"/.test(gs)&&/function handleContentArchive_/.test(gs)&&/Checksum mismatch/.test(gs));
 const fn=read('supabase/functions/content-archive-process/index.ts');
 for(const needle of ['content_archive_candidates','content_archive_commit','content_archive_pending_cleanup','content_archive_mark_cleared','X-Cron-Secret','sha256'])assert(fn.includes(needle),needle);
 assert(fn.indexOf('content_archive_commit')<fn.indexOf('removeAll("content-designs"'),'commit happens before any removal');
 assert(/\[functions\.content-archive-process\]/.test(read('supabase/config.toml')));
 const sql=read('supabase/migrations/202610150001_content_media_archive.sql');
 assert(/interval '2 days'/.test(sql)&&/interval '1 day'/.test(sql)&&/website_publications/.test(sql)&&!/delete\s+from/i.test(sql),'2-day rule, 1-day grace, website guard, no deletes in SQL');
 console.log('PASS: Drive previews for archived items (image/carousel/video/cover), Supabase files unchanged, bridge + edge function + migration wiring.');
})().catch(e=>{console.error(e);process.exit(1);});
