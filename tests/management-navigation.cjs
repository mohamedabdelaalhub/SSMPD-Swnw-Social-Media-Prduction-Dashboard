const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const sleep=t=>new Promise(r=>setTimeout(r,t));
async function main(){
 const dom=new JSDOM('<!doctype html><html lang="ar"><body><div id="app-root"><div id="tabs-bar"><button class="tab-btn" data-tab="review">إدارة المحتوى</button><button class="tab-btn" data-tab="business_intelligence">ذكاء الإدارة</button><button class="tab-btn" data-digital-team-tab>الفريق الرقمي</button><button class="tab-btn" data-p360-nav>علاقة المريض 360</button><button class="tab-btn" data-aa-center-tab>مركز المساعد الإداري</button></div><div id="mobile-menu"><div class="mm-tabs"><button data-p360-nav>360</button></div></div><div id="user-dropdown"><div class="ud-items"><button class="ud-item" data-goto="tasks">المهام</button></div></div></div></body></html>',{url:'https://test.invalid',runScripts:'outside-only'});
 const w=dom.window,d=w.document,opened=[];
 w.SSMPDAuth={currentAdmin:{role:'super_admin'}};
 w.SSMPDOpenBusinessIntelligence=()=>opened.push('bi');
 w.SSMPDDigitalTeam={open:()=>opened.push('dt')};
 w.SSMPDPatient360={open:()=>opened.push('patient')};
 w.SSMPDAdministrativeAssistantCenter={open:()=>opened.push('sia')};
 w.eval(fs.readFileSync('assets/js/management-navigation.js','utf8'));
 d.dispatchEvent(new w.Event('DOMContentLoaded'));await sleep(20);
 assert.equal(d.querySelectorAll('#tabs-bar .tab-btn').length,1,'content strip keeps only content page');
 assert.equal(d.querySelectorAll('#mobile-menu .mm-tabs [data-p360-nav]').length,0,'mobile content strip clean');
 assert.equal(d.querySelectorAll('[data-management-nav] .ud-item').length,4,'management group holds all pages');
 assert(d.querySelector('[data-management-nav]').textContent.includes('الإدارة والتشغيل'));
 d.querySelector('[data-management-page="digital_team"]').click();
 d.querySelector('[data-management-page="patient360"]').click();
 assert.deepEqual(opened,['dt','patient'],'legacy module open behavior preserved');
 await sleep(15);
 assert.equal(d.querySelectorAll('[data-management-nav]').length,1,'no duplicate management group');
 dom.window.close();console.log('PASS operational sections isolated from content navigation');
}
main().catch(e=>{console.error(e);process.exit(1);});