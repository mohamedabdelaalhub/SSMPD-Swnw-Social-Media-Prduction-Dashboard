const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
const files=[
 'supabase/functions/digital-agent-advice/index.ts',
 'supabase/functions/task-attachment-preview/index.ts',
 'supabase/functions/assistant-review-tasks/index.ts',
 'supabase/functions/assistant-task-evidence-review/index.ts'
];
for(const name of files){
 const source=fs.readFileSync(name,'utf8');
 const ast=ts.createSourceFile(name,source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TS);
 const errors=ast.parseDiagnostics||[];
 assert.equal(errors.length,0,name+': '+errors.map(e=>ts.flattenDiagnosticMessageText(e.messageText,' ')).join('\n'));
}
console.log('PASS specialist advice and task attachment Edge Function TypeScript syntax');
