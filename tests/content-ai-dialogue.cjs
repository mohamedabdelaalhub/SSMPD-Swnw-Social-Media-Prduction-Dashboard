// content-ai: optional `dialogue` (+ dialogue_shape) for cartoon-character reels. The normal single-voice `script` is untouched; an unsuitable dialogue is dropped to null, never fails the idea.
const fs=require('fs'),vm=require('node:vm'),ts=require('typescript'),assert=require('node:assert/strict');
const src=fs.readFileSync('supabase/functions/content-ai/index.ts','utf8');
const a=src.indexOf('const DIALOGUE_VOICED'),b=src.indexOf('const instructions = "');assert(a>0&&b>a,'helper block present');
const js=ts.transpileModule(src.slice(a,b),{compilerOptions:{target:'es2022'}}).outputText+';this.checkedDialogue=checkedDialogue;this.shapes=DIALOGUE_SHAPES;this.instr=dialogueInstructions;';
const ctx={};vm.runInNewContext(js,ctx);const {checkedDialogue,shapes,instr}=ctx;
const good=()=>({format:'video',script:'صوت واحد عادي',dialogue_shape:'mother_asks_doctor',dialogue:[
 {who:'الأم',text:'يا دكتور، ابني بيتنفس من بقه وهو نايم. ده عادي؟'},{who:'الدكتور',text:'مش دايما. لو الشخير متكرر لازم نكشف على اللحمية.'},{who:'الولد',text:'أنا كويس!'},
 {who:'الأم',text:'وأعمل إيه في البيت لحد الكشف؟'},{who:'الدكتور',text:'ارفعي راسه بمخدة خفيفة، واستشيري الدكتور لو استمر.'}]});
let i=checkedDialogue(good());assert.equal(i.dialogue.length,5,'valid dialogue kept');assert.equal(i.dialogue_shape,'mother_asks_doctor');assert.equal(i.script,'صوت واحد عادي','script untouched');
const bad=(m,why)=>{const x=good();m(x);const r=checkedDialogue(x);assert.equal(r.dialogue,null,why);assert.equal(r.dialogue_shape,null,why+' (shape)');assert.equal(r.script,'صوت واحد عادي','script untouched: '+why);};
bad(x=>x.format='image_post','not a video');
bad(x=>x.dialogue[0].who='الجدة','grandmother has no voice');
bad(x=>x.dialogue[2].text='أنا كويس جدا والله يا ماما','a kid may only react (<=3 words)');
bad(x=>x.dialogue=x.dialogue.slice(0,3),'fewer than 4 lines');
bad(x=>x.dialogue.forEach(l=>{if(l.who==='الدكتور')l.who='الأم'}),'one speaker only');
bad(x=>x.dialogue.forEach(l=>l.text=l.text.replace(/الدكتور|دكتور|استشيري|استشر/g,'الطبيب')),'no doctor referral anywhere');
bad(x=>x.dialogue[1].text=Array(16).fill('كلمة').join(' '),'a line over 14 words');
bad(x=>x.dialogue=null,'null dialogue');
i=good();i.dialogue_shape='made_up';assert.equal(checkedDialogue(i).dialogue_shape,null,'unknown shape cleared, dialogue kept');
// schema + instructions
assert(/"dialogue","dialogue_shape"/.test(src),'both fields required (strict schema)');
assert(/dialogue:\{type:\["array","null"\]/.test(src)&&/dialogue_shape:\{type:\["string","null"\],enum:\[\.\.\.DIALOGUE_SHAPES,null\]/.test(src),'schema properties');
for(const s of shapes)assert(instr.includes(s),'instruction explains '+s);
assert(/التنويع/.test(instr)&&/مختلفة/.test(instr),'variation rule');assert(/مفيش جدة/.test(instr)&&/مابيتكلموش/.test(instr),'voice rules');
assert(/\(\(!daily&&!dina&&!carousel&&!doctorIntro\)\?dialogueInstructions:""\)/.test(src),'only for plain content (not daily/Dina/carousel/doctor intro)');
assert(/checkedDialogue\(idea\);\s*approved\.set\(ideaIndex,idea\)/.test(src),'validated before approval');
console.log('PASS content-ai dialogue: kept when valid, dropped (script untouched) when a kid talks long / grandmother / <4 lines / one speaker / no doctor / long line / wrong format; 8 shapes + variation rules in the prompt; strict schema fields.');
