const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const read=n=>fs.readFileSync(__dirname+'/../assets/js/'+n+'.js','utf8');
(async()=>{
 const w=new JSDOM('<main></main>',{runScripts:'outside-only'}).window;
 w.SSMPD_CONFIG={driveBridge:{webAppUrl:'https://script.google.com/macros/s/test/exec'}};
 let sent;w.fetch=async(url,opt)=>{sent={url,body:JSON.parse(opt.body)};return {json:async()=>reply};};
 let reply={ok:true,fileUrl:'https://drive.google.com/file/d/abc/view',fileId:'abc'};
 w.eval(read('drive'));
 const up=w.SSMPDDrive.uploadTaskFile(new w.File(['hello'],'جرد.pdf',{type:'application/pdf'}),{taskId:'t-1',title:'جرد المخزن'});
 const res=await up;
 assert.equal(sent.body.category,'task_attachment');assert.equal(sent.body.taskId,'t-1');assert.equal(sent.body.fileName,'جرد.pdf');assert(sent.body.base64.length>0);
 assert.equal(res.fileUrl,'https://drive.google.com/file/d/abc/view');
 // a bridge that was not redeployed gives a clear Arabic message
 reply={ok:false,error:'نوع فولدر غير معروف: task_attachment'};
 await assert.rejects(()=>w.SSMPDDrive.uploadTaskFile(new w.File(['x'],'a.pdf'),{taskId:'t-1'}),/محتاج تحديث/);
 // the Apps Script handler exists and the DB wrapper maps the bridge reply
 const gs=fs.readFileSync(__dirname+'/../apps-script/Code.gs','utf8');assert(/category === "task_attachment"/.test(gs)&&/function handleTaskAttachmentUpload_/.test(gs));
 const sql=fs.readFileSync(__dirname+'/../supabase/migrations/202610140001_task_comments_files_notifications.sql','utf8');assert(/'comment'/.test(sql)&&/task_add_comment/.test(sql)&&!/storage\.buckets/.test(sql),'migration keeps files off Supabase storage');
 console.log('PASS: task attachments go to the Drive bridge (task_attachment), stale-bridge message, handler and storage-free migration present.');
})().catch(e=>{console.error(e);process.exit(1);});
