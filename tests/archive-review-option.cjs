const fs=require('fs'),assert=require('assert/strict'),{JSDOM}=require('jsdom');
const tick=()=>new Promise(r=>setTimeout(r,20));
(async()=>{
 const dom=new JSDOM('<main id="root"></main><div id="home"><header class="ph-welcome"></header></div>',{runScripts:'outside-only'}),w=dom.window,d=w.document,errors=[],writes=[];
 const staff={id:'psych',name:'أخصائي محاكاة',email:'specialist@example.invalid',role:'psychology_specialist',active:true,user_id:'auth-psych',extra_roles:[]};
 w.alert=s=>errors.push(s);w.addEventListener('error',e=>errors.push(e.message));
 w.SSMPDAuth={currentAdmin:{id:'super',role:'super_admin'}};
 w.SSMPDDb={listAdmins:async()=>[staff],getAppSettings:async()=>({}),listBrandLogos:async()=>[],updateAdmin:async(id,patch)=>{writes.push({id,patch});Object.assign(staff,patch);},addAdminExtraRole:async(id,role)=>{writes.push({id,role,add:true});staff.extra_roles.push(role);},removeAdminExtraRole:async(id,role)=>{writes.push({id,role,add:false});staff.extra_roles=staff.extra_roles.filter(r=>r!==role);},psychologySnapshot:async()=>({requests:[]})};
 for(const name of ['roles','render-admin','psychology-workspace'])w.eval(fs.readFileSync('assets/js/'+name+'.js','utf8'));
 w.SSMPDRenderAdmin.render(d.querySelector('#root'));await tick();
 for(const attr of ['archive','archive-review','archive-view-only','verification-access','delete-leads','delete-nutrition-visits']){const cb=d.querySelector('[data-'+attr+'="psych"]');assert(cb&&!cb.disabled,attr+' enabled');cb.click();await tick();}
 assert.equal(writes.length,6);assert.equal(staff.has_archive_access,true);assert.equal(staff.has_archive_review_access,true);assert.equal(staff.role,'psychology_specialist');assert(!d.body.textContent.includes('أزل الأدوار'));
 d.querySelector('[data-extra-role-value="reception"]').click();await tick();assert(staff.extra_roles.includes('reception'));assert(d.querySelector('[data-extra-role-value="reception"]').checked);
 const R=w.SSMPDRoles,base={id:'psych',role:'psychology_specialist',roles:['psychology_specialist'],active:true};
 assert(R.canSeeTab(base,'patients'));assert(R.canSeeTab(base,'tasks'));assert(!R.canSeeTab(base,'leads'));assert(R.isPsychologySpecialist(base));
 for(const [role,tab] of [['reception','leads'],['designer','design'],['page_manager','production']]){const a={...base,roles:['psychology_specialist',role]};assert(R.canSeeTab(a,tab),tab);assert(R.isPsychologySpecialist(a),'unrelated tab does not open full patient archive');}
 const finance={...base,roles:['psychology_specialist','financial_manager']};assert(!R.canSeeTab(finance,'accounting'));finance.module_permissions=[{module_key:'accounting',can_view:true}];assert(R.canSeeTab(finance,'accounting'));
 for(const grant of ['has_archive_access','has_archive_review_access','has_archive_view_only']){const a={...base,[grant]:true};assert(!R.isPsychologySpecialist(a));assert(R.canSeeTab(a,'patients'));w.SSMPDAuth.currentAdmin=a;const root=d.querySelector('#home');root.querySelectorAll('.pc-home').forEach(x=>x.remove());w.SSMPDPsychology.mountHome(root,a);assert.equal(root.querySelectorAll('[data-pc="start"]').length,3,'home session shortcuts survive explicit archive grants');}
 w.SSMPDAuth.currentAdmin={...base,roles:['psychology_specialist','general_manager']};const home=d.querySelector('#home');home.querySelectorAll('.pc-home').forEach(x=>x.remove());w.SSMPDPsychology.mountHome(home,w.SSMPDAuth.currentAdmin);assert.equal(home.querySelectorAll('[data-pc="start"]').length,3);assert(home.textContent.includes('مراجعة الطلبات'));
 assert.deepEqual(errors,[]);w.close();console.log('PASS admin grant controls/save handlers, mixed roles, financial grant scope, archive routing and specialist shortcuts with wider access. Mocked staff only.');
})().catch(e=>{console.error(e);process.exit(1)});
