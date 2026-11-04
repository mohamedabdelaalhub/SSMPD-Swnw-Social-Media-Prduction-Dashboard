const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const paths=[
'supabase/functions/digital-team-coordinator/index.ts',
'supabase/functions/task-file-autoscan/index.ts'
];
for(const name of paths){
 const content=fs.readFileSync(name,'utf8');
 const ast=ts.createSourceFile(name,content,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS);
 assert.equal(ast.parseDiagnostics.length,0,name+': '+ast.parseDiagnostics.map(e=>ts.flattenDiagnosticMessageText(e.messageText,' ')).join('\n'));
}
const worker=fs.readFileSync(paths[1],'utf8');
assert(worker.includes("task_file_scan_token_valid"),'worker checks server-side Vault token');
assert(worker.includes("GOOGLE_SERVICE_ACCOUNT_KEY"),'worker reads Drive using internal credentials');
assert(!/from\(["']tasks["']\)\.update/.test(worker),'worker must not change task states');
const router=fs.readFileSync(paths[0],'utf8');
assert(router.includes("awaiting_runtime"),'unconnected agents are marked awaiting runtime');
assert(!/state:\s*["']execution_verified["']/.test(router),'no unsupported operational completion');
console.log('PASS edge parse, scan isolation and truthful execution state');