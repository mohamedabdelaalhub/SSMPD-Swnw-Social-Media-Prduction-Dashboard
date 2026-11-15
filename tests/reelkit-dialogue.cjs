const {spawnSync}=require('child_process'),fs=require('fs'),assert=require('node:assert/strict');
const run=(dlg,extra)=>{fs.writeFileSync('/tmp/_dlg.json',JSON.stringify(dlg));return spawnSync('python3',['-I','scripts/reelkit/from_dialogue.py','/tmp/_dlg.json','/tmp/_story.json'],{encoding:'utf8'});};
const voices=[...fs.readFileSync('scripts/reelkit/voices.py','utf8').matchAll(/"(\w+)":\s*"[A-Za-z0-9]{20}"/g)].map(m=>m[1]);
for(const f of fs.readdirSync('scripts/reelkit/dialogues')){
  const d=JSON.parse(fs.readFileSync('scripts/reelkit/dialogues/'+f,'utf8')),r=run(d);assert.equal(r.status,0,f+': '+r.stderr);
  const s=JSON.parse(fs.readFileSync('/tmp/_story.json','utf8'));
  assert(s.scenes.length>=2,'2+ scenes');
  for(const [id,c] of Object.entries(s.cast)){if(c.voice)assert(voices.includes(c.voice),'approved voice only: '+c.voice);else assert(/^k/.test(id),'only kids are silent');}
  const spoken=s.scenes.flatMap(sc=>sc.beats.filter(b=>b.say).map(b=>b.say.who));assert(spoken.every(w=>s.cast[w].voice),'a silent character never speaks');
  assert(s.scenes.flatMap(sc=>sc.beats).some(b=>b.bubble),'the kid reacts with a bubble');
  assert(JSON.stringify(s).includes('"hl"'),'key words highlighted');
}
// same seed -> same story; different seed -> different
const base=JSON.parse(fs.readFileSync('scripts/reelkit/dialogues/mouth-breathing-kit.json','utf8'));
run(base);const a=fs.readFileSync('/tmp/_story.json','utf8');run(base);assert.equal(fs.readFileSync('/tmp/_story.json','utf8'),a,'deterministic');
run({...base,seed:77});assert.notEqual(fs.readFileSync('/tmp/_story.json','utf8'),a,'seed varies the result');
// rules
let r=run({...base,lines:[{who:'الجدة',text:'أهلا'},...base.lines]});assert.notEqual(r.status,0,'grandmother refused');assert(/جدة/.test(r.stderr));
r=run({...base,lines:[{who:'الجار',text:'أهلا'},...base.lines]});assert.notEqual(r.status,0,'unknown speaker refused');
r=run({...base,lines:[{who:'الأم',text:'سؤال؟'},{who:'الأم',text:'سؤال تاني؟'}]});assert(/نفس الصوت|عدد الحروف/.test(r.stdout),'warns');
console.log('PASS dialogue compiler: approved voices only, kids silent with reaction bubble, grandmother/unknown speakers refused, deterministic per seed, varies across seeds, warnings.');
