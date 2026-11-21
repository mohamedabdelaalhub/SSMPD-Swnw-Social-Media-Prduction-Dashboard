// «صافي القديم (ماسا)» على الموبايل: مفيش overflow أفقي وكارت صافي النقد أزرق (بلاغ المالك 2026-11-21: الصفحة كانت أعرض من الشاشة)
const fs=require('fs'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom'),{chromium}=require('playwright');
const idx=fs.readFileSync('index.html','utf8');const CSS=[...idx.matchAll(/href="(assets\/css\/[^"?]+)/g)].map(m=>m[1]);
const src=fs.readFileSync('assets/js/finance-masa-net.js','utf8');
const rep={from:'2026-01-01',to:'2026-11-21',group_by:'month',source:null,totals:{income:4862300,operating:1432830,advance:591822,partner_draw:529525,transfer:280336,ignored:155742,unclassified:124594,net_cash:1584129,net_operating:3304876},
 by_period:Array.from({length:11},(_,i)=>({period:'2026-'+String(i+1).padStart(2,'0'),income:400000+i*25000,operating:200000,advance:60000,partner_draw:40000,transfer:40000,net_cash:100000,net_operating:200000})),
 unclassified_accounts:[{account:'مستلزمات',amount:1,payouts:1}],top_accounts:[{account:'رواتب موظفين',kind:'operating',amount:642000,payouts:212}]};
(async()=>{const dom=new JSDOM('<div id="h"></div>',{url:'https://t.invalid',runScripts:'outside-only'}),w=dom.window,d=w.document;
 w.SSMPDDb={client:{rpc:()=>Promise.resolve({data:rep})}};w.SSMPDFinanceControls={panel:()=>'<div class="mp" data-masa-payments>x</div>',act(){},due(){},ledger(){}};w.eval(src);
 d.getElementById('h').innerHTML=w.SSMPDFinanceControls.panel('masa-net');await new Promise(r=>setTimeout(r,60));
 const html=d.getElementById('h').innerHTML;
 const b=await chromium.launch({...(process.env.PW_CHROMIUM?{executablePath:process.env.PW_CHROMIUM}:{}),args:['--no-sandbox']});try{
 for(const W of [390,360]){const p=await b.newPage({viewport:{width:W,height:900}});await p.route('https://x.test/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div class="app-shell"><main class="view" id="view-container"><div class="acs"><div class="acs-main"><section class="fc-workspace fc-v2"><div data-fc-body></div></section></div></div></main></div></body></html>'}));
  await p.goto('https://x.test/');for(const f of CSS){try{await p.addStyleTag({content:fs.readFileSync(f,'utf8')});}catch(e){}}
  await p.evaluate(h=>{document.querySelector('[data-fc-body]').innerHTML=h;},html);await p.evaluate(()=>{const n=document.querySelector('.mn-switch [data-mn-view=net]');});
  await p.waitForTimeout(300);
  const r=await p.evaluate(()=>{const vw=document.documentElement.clientWidth,out=[];document.querySelectorAll('body *').forEach(e=>{const b=e.getBoundingClientRect();if(b.width&&(b.right>vw+2||b.left<-2)&&getComputedStyle(e).position!=='fixed')out.push([e.tagName+'.'+String(e.className).slice(0,34),Math.round(b.left),Math.round(b.right),Math.round(b.width)]);});return {vw,sw:document.documentElement.scrollWidth,over:out.slice(0,10)};});
  assert.equal(r.sw,r.vw,'no horizontal overflow at '+W+': '+JSON.stringify(r.over.slice(0,3)));const hero=await p.evaluate(()=>getComputedStyle(document.querySelector('.mn-tile.hero')).backgroundColor);assert.equal(hero,'rgb(15, 54, 157)','hero tile stays blue');await p.close();}
 console.log('PASS masa net report on phones (390/360): no sideways overflow, tiles keep their layout.');}finally{await b.close();}})().catch(e=>{console.error(e);process.exit(1);});
