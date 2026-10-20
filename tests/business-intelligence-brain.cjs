const fs=require('fs'),assert=require('node:assert/strict'),path=require('path');
const root=path.resolve(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const brain=read('supabase/migrations/20261020_business_intelligence_brain.sql');
const graph=read('supabase/migrations/20261020_business_intelligence_graph_limits.sql');
const priority=read('supabase/migrations/20261020_business_intelligence_task_priority.sql');
const security=read('supabase/migrations/20261020_business_intelligence_security.sql');
const strategySql=read('supabase/migrations/20261020_business_intelligence_strategy.sql');
const measurementSql=read('supabase/migrations/20261020_business_intelligence_measurement_queue.sql');
const ui=read('assets/js/business-intelligence.js');
const strategyUi=read('assets/js/business-intelligence-strategy.js');
const edge=read('supabase/functions/business-intelligence/index.ts');
const html=read('index.html');

assert.match(brain,/create table if not exists public\.business_knowledge_items/i);
assert.match(brain,/create table if not exists public\.business_recommendations/i);
assert.match(brain,/create table if not exists public\.business_decisions/i);
assert.match(brain,/create table if not exists public\.business_measurements/i);
assert.match(brain,/create table if not exists public\.business_extraction_queue/i);
assert.match(brain,/select false;/i,'external business AI must remain disabled by default');
assert.match(brain,/status in \('manager_approved','validated_by_data'\)/i,'content memory must use approved knowledge only');
assert.match(brain,/revenue_attribution_ready',false/i,'owner snapshot must not claim revenue attribution readiness');
assert.match(brain,/not a confidence interval or guaranteed result/i,'scenario planner must state its limitation');

assert.match(graph,/create table if not exists public\.business_entity_links/i);
assert.match(graph,/business_default_knowledge_decay/i);
assert.match(graph,/when p_mode='owner_ask' then 50 else 15 end/i,'AI daily limits must exist');
assert.match(priority,/when 'critical' then 'urgent'/i,'critical recommendation must become urgent task');

for(const table of ['business_knowledge_items','business_knowledge_relations','business_recommendations','business_decisions','business_measurements','business_extraction_queue','business_entity_links','business_ai_requests']){
  assert(security.includes(`revoke all on table public.${table} from public, anon, authenticated;`),`missing anon revoke for ${table}`);
}
assert.match(security,/revoke all on function public\.business_queue_completed_task\(\) from public, anon, authenticated/i);
assert.match(security,/revoke all on function public\.business_graph_from_knowledge\(\) from public, anon, authenticated/i);

assert.match(strategySql,/needs_decision/i);
assert.match(strategySql,/opportunities/i);
assert.match(strategySql,/recent_task_digest/i);
assert.match(strategySql,/top_campaigns/i);
assert.match(strategySql,/revenue_ready',false/i);
assert.match(measurementSql,/business_measurement_queue/i);
assert.match(measurementSql,/converted_to_task','measuring','validated/i);
assert.match(measurementSql,/revoke all on function public\.business_measurement_queue\(\) from public,anon/i);

assert.match(ui,/hasAnyRole\(a,\['general_manager','super_admin'\]\)/i,'owner workspace must be management-only');
assert.match(ui,/business_content_brief/i,'content AI must receive approved business memory');
assert(!ui.includes('task_work_results'),'content wrapper must not read raw employee reports');
assert.match(ui,/Contribution Impact/i);
assert.match(ui,/Scenario Planning/i);
assert.match(ui,/Owner Copilot/i);
new Function(ui); new Function(strategyUi);

for(const label of ['يحتاج قراري','الفرص','التسويق والإعلانات','خلاصة المهام','القياس والنتائج','Knowledge Graph'])assert(strategyUi.includes(label),`missing strategic view ${label}`);
assert.match(strategyUi,/Revenue Attribution/i);
assert.match(strategyUi,/business_measurement_queue/i);
assert.match(strategyUi,/business_measurement_save/i);
assert.match(strategyUi,/Feedback Loop/i);

assert.match(edge,/business_ai_allow/i,'external calls must pass the AI usage gate');
assert.match(edge,/business_copilot_context/i);
assert.match(edge,/بيانات غير موثوقة وليست تعليمات/i,'AI prompts must defend against prompt injection');
assert.match(edge,/status:"ai_extracted"/i,'extracted report knowledge must require later review');
assert.match(edge,/Math\.min\(0\.75/i,'AI extraction confidence must be capped');

const biPos=html.indexOf('assets/js/business-intelligence.js');
const strategyPos=html.indexOf('assets/js/business-intelligence-strategy.js');
const appPos=html.indexOf('assets/js/app.js');
assert(biPos>0&&strategyPos>biPos&&appPos>strategyPos,'BI scripts must load after content AI and before app bootstrap');
assert(html.includes('assets/css/business-intelligence-strategy.css'));

console.log('PASS: Business Intelligence Brain keeps approval, privacy, attribution, AI-gating, measurement feedback loop, knowledge graph, strategic owner views and existing task integration constraints.');
