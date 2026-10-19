const boot=require('./helpers/clinic-finance.cjs'),fs=require('fs'),assert=require('node:assert/strict'),parents=require('./helpers/accountant-parent-groups.json'),plan=require('../docs/accounting/operational-chart-links.json');
(async()=>{
 const {db,as,fin,key,range,owner,id}=await boot(['clinic_doctor_settlements','clinic_supplier_finance','clinic_bank_insurance','clinic_payroll_assets_tax','clinic_opening_reports','clinic_booking_advances','clinic_legacy_assets','clinic_register_directions_payments']);
 for(const name of ['20261017212113_clinic_ledger_chart_actions.sql','20261018205000_accountant_chart_treasury.sql','20261019001000_treasury_shift_handover.sql'])await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
 for(const p of parents){await owner('insert into clinic_finance.accounts(code,name,kind) values($1,$2,$3)',[p.code,p.name,p.kind]);await owner('insert into clinic_finance.account_config(code,parent_code,is_postable) values($1,$2,false)',[p.code,p.parent_code]);}
 const initial=(await owner('select count(*) n from clinic_finance.entries'))[0].n;
 for(const [code,parent]of Object.entries(plan)){const [a]=await owner('select a.*,c.revision from clinic_finance.accounts a join clinic_finance.account_config c using(code) where code=$1',[code]);if(!a)continue;await as(3);await fin('ledger_command',['account_update',{code,name:a.name,kind:a.kind,parent_code:parent,revision:a.revision,is_postable:true,active:true},key()]);}
 assert.equal((await owner('select count(*) n from clinic_finance.entries'))[0].n,initial);
 assert.equal((await owner('select count(*) n from clinic_finance.account_config where is_system and parent_code is null'))[0].n,0);
 // Post through normal maker/reviewer payroll RPCs after linking, rather than inserting test ledger lines.
 const mon=new Date().toISOString().slice(0,7)+'-01';await as(2);
 const req=async(kind,p)=>fin('business_command',['request',{kind,subject:'STAFF-CHART-QA',reference:key(),note:'مستند اختبار',...p},key()]);
 let c=await req('employment',{employee_name:'موظف اختبار',base:1000,from:range[0],to:range[1]});await as(3);await fin('business_command',['review',{id:c,approve:true,note:'مراجعة مستقلة'},key()]);await as(2);
 let payroll=await req('payroll',{contract_id:c,month:mon,allowance:0,tax:50,insurance:20,recovery:0});await as(3);await fin('business_command',['review',{id:payroll,approve:true,note:'اعتماد الاستحقاق'},key()]);
 let snap=await fin('snapshot',range);assert.equal(Number(snap.employee_balances[0].due),930);assert.equal(Number(snap.trial.find(a=>a.code==='5211').debit),1000);
 assert.equal(snap.finance_accounts.find(a=>a.code==='5211').parent_code,'050501');assert.equal(snap.finance_accounts.find(a=>a.code==='2131').parent_code,'020104');
 await as(2);let payment=await req('salary_payment',{amount:930,method:'bank'});await as(3);await fin('business_command',['review',{id:payment,approve:true,note:'اعتماد صرف اختبار'},key()]);snap=await fin('snapshot',range);assert.equal(Number(snap.employee_balances[0].due),0);
 // Supplier and general expense codes are linked to their own branches, not merged with employee balances.
 assert.equal(snap.finance_accounts.find(a=>a.code==='2111').parent_code,'02010101');assert.equal(snap.finance_accounts.find(a=>a.code==='5218').parent_code,'050512');
 assert((await owner('select max(clinic_finance.account_level(code)) n from clinic_finance.account_config'))[0].n<=5);
 await as(4);await assert.rejects(()=>fin('ledger_command',['account_update',{code:'5211'},key()]),/صلاحية/);
 assert.equal(Number((await owner('select sum(debit-credit) n from clinic_finance.lines'))[0].n),0);
 await db.close();console.log('PASS operational accounts attach to accountant groups without ledger mutation, payroll maker/reviewer and bank payout stay correct, five-level tree and reception denial.');
})().catch(e=>{console.error(e.message,e.where,e.stack);process.exit(1)});
