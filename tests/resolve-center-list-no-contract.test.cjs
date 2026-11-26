// Static guard for 20261126140000: the live-rollback test must apply byte-for-byte the migration's DO block, and the
// rollback must swap the same two lines back.
const fs=require('fs'),assert=require('assert');
const mig=fs.readFileSync('supabase/migrations/20261126140000_resolve_center_list_no_contract.sql','utf8');
const test=fs.readFileSync('tests/resolve-center-list-no-contract-live-rollback.sql','utf8');
const rb=fs.readFileSync('supabase/rollbacks/20261126140000_resolve_center_list_no_contract.rollback.sql','utf8');
const block=mig.slice(mig.indexOf('do $mig$'),mig.indexOf('end $mig$;')+'end $mig$;'.length);
assert(block.length>200,'migration DO block not found');
assert(test.includes(block),'live-rollback test does not carry the migration DO block verbatim');
const line=n=>{const m=mig.match(new RegExp(n+" constant text:='([^\\n]*)';\\n"));assert(m,n+' missing');return m[1];};
const oldL=line('old_line'),newL=line('new_line');
assert(newL.includes("contract_id is null")&&newL.includes('order by valid_from desc,id limit 1'),'new line must filter contract_id and order');
assert(rb.includes(oldL)&&rb.includes(newL),'rollback must swap the same two lines');
assert(/rollback;\s*$/.test(test),'live test must end in rollback');
console.log('PASS resolve center-list filter: test carries the migration block verbatim, rollback mirrors it');
