// Text-fit gate (owner 2026-11-18): no text inside a button, chip, tab or KPI line may wrap to a second line or spill out,
// at any width from desktop down to phone. usage: node text-fit-check.cjs <file-or-url> [selectors] [widths...]
// Optional env LC_EVAL: JS evaluated after load (e.g. switch view) — can be a list separated by ';;' to check several states.
const {chromium}=require('playwright'),path=require('path');
const target=process.argv[2],sel=process.argv[3]||'button,.btn,.pill,.chip,[role=button],.k small,.k b,.k i';
const widths=(process.argv.slice(4).length?process.argv.slice(4):['1440','1280','1180','1024','900','768','600','480','390','360']).map(Number);
const url=/^https?:|^file:/.test(target)?target:'file://'+path.resolve(target);
const states=(process.env.LC_EVAL||'').split(';;').filter(Boolean);if(!states.length)states.push('');
(async()=>{const b=await chromium.launch();let fails=0;
 for(const st of states)for(const w of widths){const p=await b.newPage({viewport:{width:w,height:900}});await p.goto(url);await p.waitForTimeout(700);if(st){await p.evaluate(st);await p.waitForTimeout(700);}
  const r=await p.evaluate(sel=>{const out=[];document.querySelectorAll(sel).forEach(e=>{const cs=getComputedStyle(e);if(cs.display==='none'||cs.visibility==='hidden'||!e.offsetParent&&cs.position!=='fixed')return;const rect=e.getBoundingClientRect();if(!rect.width)return;
    // lines: measure text node rects
    let wrapped=false;const tw=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);let tn;while((tn=tw.nextNode())){if(!tn.nodeValue.trim())continue;const rg=document.createRange();rg.selectNodeContents(tn);const lines=new Set([...rg.getClientRects()].filter(x=>x.width>1).map(x=>Math.round(x.top)));if(lines.size>1){wrapped=true;break;}}
    const txt=(e.innerText||'').trim().replace(/\s+/g,' ').slice(0,40);
    if(wrapped)out.push('wraps: '+txt);
    if(e.scrollWidth>e.clientWidth+1&&cs.overflow!=='visible'&&!/auto|scroll/.test(cs.overflowX))out.push('clipped: '+txt);
    if(rect.left<-1||rect.right>innerWidth+1){const sc=e.closest('[style*="overflow-x:auto"],.tbl,.seg,.rail');if(!sc)out.push('off-screen: '+txt);}
   });return {out:[...new Set(out)],ox:document.documentElement.scrollWidth-innerWidth};},sel);
  const bad=r.out.length||r.ox>0;if(bad)fails++;
  console.log((bad?'FAIL':'PASS')+' @'+w+'px'+(st?' ['+st.slice(0,30)+']':'')+(r.ox>0?' overflowX '+r.ox:'')+(r.out.length?'\n  - '+r.out.slice(0,8).join('\n  - '):''));
  await p.close();}
 await b.close();process.exit(fails?1:0);})();
