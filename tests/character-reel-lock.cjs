const vm=require('node:vm'),fs=require('fs'),assert=require('node:assert/strict');
const src=fs.readFileSync(__dirname+'/../assets/js/render-review.js','utf8').replace('window.SSMPDRenderReview = { render: render };','window.__lock = {html:claudeDesignHtml};');
const w={SSMPDAuth:{currentAdmin:{id:'u',role:'page_manager'}}};vm.runInNewContext(src,{window:w,document:{},console});
const claude='a0fbdfee-d147-4282-b988-186a9ae3e88c';
const reel=s=>({id:'r',brand:'sono',content_format:'video',stage:s,assigned_designer:claude,content_angle:'character_reel'});
const normal={id:'n',brand:'sono',content_format:'video',stage:'in_design',assigned_designer:claude,content_angle:'قائمة'};
for(const role of ['page_manager','designer','approver','reception']){
  w.SSMPDAuth.currentAdmin={id:'u',role};
  for(const st of ['in_design','needs_revision']){const h=w.__lock.html(reel(st));assert(!h.includes('claude-design-go'),role+' must not get the execute button for a character reel');assert(h.includes('claude-design-locked'),'explanation shown');}
  assert(w.__lock.html(reel('final_approval'))==='','nothing extra at other stages');
  assert(w.__lock.html(normal).includes('claude-design-go'),'normal Claude items keep their button for staff');
}
for(const role of ['super_admin','general_manager']){w.SSMPDAuth.currentAdmin={id:'m',role};assert(w.__lock.html(reel('in_design')).includes('claude-design-go'),role+' keeps the button');}
const sql=fs.readFileSync(__dirname+'/../supabase/migrations/20261113120000_character_reel_lock.sql','utf8');
assert(/before insert or update on public\.content_items/.test(sql)&&/before insert on public\.claude_design_requests/.test(sql));
assert(/can_manage_all_content\(\)/.test(sql)&&/service_role/.test(sql)&&/a0fbdfee-d147-4282-b988-186a9ae3e88c/.test(sql));
for(const col of ['title','script_text','caption_text','video_storyboard','design_file_url','assigned_designer','content_angle'])assert(sql.includes('new.'+col+' is distinct from old.'+col),col+' is guarded');
assert(!/new\.stage is distinct/.test(sql),'stage changes (approval / revision) stay with guard_content_transition');
console.log('PASS: character reels hide the Claude execute button from staff, managers keep it, DB triggers cover requests and content edits.');
