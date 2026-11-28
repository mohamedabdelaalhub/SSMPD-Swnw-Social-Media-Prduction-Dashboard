// assistant-answer edge function («اسأل المساعد» phase 1): parses; the pure logic (redaction, Arabic matching, article pick, cached
// system prompt, answer shape) runs here on the REAL dashboard-help-data.js; index.ts: usage take as the user BEFORE the model,
// usage record with the service key, no text logged, only claude-haiku-5-5, image not sent, no data writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm');
const dir='supabase/functions/assistant-answer/';
for(const f of ['index.ts','logic.ts']){const src=fs.readFileSync(dir+f,'utf8');const ast=ts.createSourceFile(f,src,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS);assert.equal(ast.parseDiagnostics.length,0,f+' parses');}
const out=ts.transpileModule(fs.readFileSync(dir+'logic.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const m={exports:{}};vm.runInNewContext(out,{module:m,exports:m.exports,require});const L=m.exports;
// redaction
const r=L.redact({patient_name:'س',full_name:'ص',phone:'01012345678',file_no:'P-2026-000123',note:'كلمه على 0101 234 5678',rows:[{mobile:'1',file_no:'F1',x:'ok'}]});
assert.deepEqual(JSON.parse(JSON.stringify(r)),{file_no:'P-2026-000123',note:'كلمه على •••',rows:[{file_no:'F1',x:'ok'}]});
assert.equal(L.redactText('رقمه +20 101 234 5678 ابعتله'),'رقمه ••• ابعتله');
assert.equal(L.norm('إزاي أسجّل صرف من مخزني؟'),'ازاي اسجل صرف من مخزني');
// real help data → articles, stable system prompt with the index, sensible pick
const js=fs.readFileSync('assets/js/dashboard-help-data.js','utf8');const arts=L.parseHelpData(js);assert(arts.length>200,'articles '+arts.length);
const sys=L.systemPrompt(arts);assert.equal(sys,L.systemPrompt([...arts].reverse()),'system prompt is byte-stable (cache)');assert(sys.includes('Help article index'));
assert(sys.length<60000,'index stays small: '+sys.length);
const p=L.pick(arts,'ازاي اسجل خصم على الزيارة','الاستقبال',4);assert(p.length>=1&&p.length<=4,'picked '+p.length);assert(p.some(a=>/خصم/.test(a.title+a.terms)),p.map(a=>a.title).join(' | '));
assert.equal(L.pick(arts,"ازاي","").length,0,'stop words only → nothing');
// answer shape: unknown id dropped, open only with a tab, no steps + no article → suggest a request
const a0=arts.find(a=>a.tab);let s=L.shape({steps:['دوس «حفظ»','x'.repeat(400)],help_article_id:a0.id,suggest_request:false,note:''},arts);
assert.equal(s.help_article_id,a0.id);assert.deepEqual(JSON.parse(JSON.stringify(s.open)),{tab:a0.tab});assert.equal(s.steps[1].length,300);assert.equal(s.suggest_request,false);assert.equal(s.note,null);
s=L.shape({steps:[],help_article_id:'made-up',suggest_request:false,note:'n'},arts);assert.equal(s.help_article_id,null);assert.equal(s.open,null);assert.equal(s.suggest_request,true);
assert.deepEqual([...Object.keys(L.ANSWER_SCHEMA.properties)].sort(),['help_article_id','note','steps','suggest_request']);assert.equal(L.ANSWER_SCHEMA.additionalProperties,false);
assert.match(L.MESSAGES.cap,/المساعد واقف النهارده/);
// index.ts rules
const idx=fs.readFileSync(dir+'index.ts','utf8');
assert(idx.indexOf('rpc("staff_assistant_usage_take")')>0&&idx.indexOf('rpc("staff_assistant_usage_take")')<idx.indexOf('await llmJson'),'cap checked as the user before the model call');
assert(/createClient\(SUPABASE_URL, ANON_KEY, \{ global: \{ headers: \{ Authorization: auth \} \}/.test(idx),'user client with the caller JWT');
assert(idx.includes('rpc("staff_assistant_usage_record"'),'usage recorded');assert(idx.includes('claudeModel: "claude-haiku-5-5"'));
assert(!/console\.(log|error|warn)/.test(idx),'no text logged');assert(!/image/i.test(idx.replace(/screenshots are not sent/,'')),'no image handling in phase 1');
assert(!/\.(insert|update|upsert|delete)\(/.test(idx.replace('from("ai_usage_log").insert(row)','')),'no data writes except the usage log');
assert(!/ANTHROPIC_API_KEY\s*=|sk-ant-/.test(idx),'no key in the file');
assert(idx.includes('redact(body.context')&&idx.includes('redactText('),'redacted before sending');
const toml=fs.readFileSync('supabase/config.toml','utf8');assert(/\[functions\.assistant-answer\]\s*(#[^\n]*\n)*verify_jwt = true/.test(toml),'verify_jwt true');
console.log('PASS assistant-answer edge: parses; redaction (names/phones out, file_no kept, digit runs masked); Arabic matching + article pick on the real help data; byte-stable cached system prompt; answer shape; cap before the model as the user; usage tokens only; haiku; no image, no writes, no key.');
