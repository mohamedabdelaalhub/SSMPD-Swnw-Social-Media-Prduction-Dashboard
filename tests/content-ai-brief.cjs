const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(__dirname + '/../assets/js/workflow.js', 'utf8');
async function run(data, fail = false) {
  const sandbox = {
    window: { SSMPDDb: {
      listContentIntelligencePatterns: () => fail ? Promise.reject(new Error('offline')) : Promise.resolve(data.patterns),
      listContentSpecialtyMap: () => Promise.resolve(data.map),
      listMetaAdPerformance: () => Promise.resolve(data.ads)
    }},
    document: {
      getElementById: () => ({value:'sono'}),
      createElement: () => ({innerHTML:'', querySelector: () => null})
    }
  };
  vm.runInNewContext(source, sandbox);
  return sandbox.window.SSMPDWorkflow.getContentAIBrief({
    specialty:'internal', advertisingObjective:'messages', format:'image_post', topic:'test-topic'
  });
}
(async () => {
  const empty = {patterns:[], map:[], ads:[]};
  const fallback = await run(empty);
  assert.match(fallback, /Low \/ fallback/);
  assert.match(fallback, /GENERAL ACCOUNT INSIGHTS/);
  assert.match(fallback, /test-topic/);
  assert.match(fallback, /Generate exactly 3 ideas/);
  assert.doesNotMatch(fallback, /3-5/);
  const historical = await run({
    patterns:[{specialty:'Internal', objective:'MESSAGES', weighted_cost_per_message:10, total_spend:100, total_messages:10, hook_type:'Question', content_angle:'Education', cta_type:'WhatsApp'}], map:[{content_specialty_key:'internal', meta_specialty_label:'Internal'}],
    ads:[{specialty:'Internal', objective:'MESSAGES', spend:100, msg_conv:10, cost_per_msg_conv:10, hook_type:'Question', content_angle:'Education', cta_type:'WhatsApp'}]
  });
  assert.match(historical, /BEST HISTORICAL PERFORMANCE/);
  assert.match(historical, /10/);
  await assert.rejects(() => run(empty, true), /offline/);
  console.log('PASS fallback, exact count, topic, historical evidence, load failure');
})().catch(e => { console.error(e); process.exitCode = 1; });
