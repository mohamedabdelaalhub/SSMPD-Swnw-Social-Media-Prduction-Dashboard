// «تأجيل قسط / تغيير عدد الأقساط» (20261127090000) on top of «على حساب الموظف» (20261126210000). PGlite, the same stubs as
// employee-debt-sql.cjs: finance asks, FM / owner (≠ requester) approves; only unclaimed installments move; claimed ones and
// their months are protected; stale requests refused; amount and books unchanged; rollback.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite'),{randomUUID:id}=require('crypto');
(async()=>{const t=fs.readFileSync('tests/employee-debt-sql.cjs','utf8');const a=t.indexOf('await db.exec(`')+15,base=t.slice(a,t.indexOf('`);',a));
 const M1=fs.readFileSync('supabase/migrations/20261126210000_employee_debt.sql','utf8'),M2=fs.readFileSync('supabase/migrations/20261127090000_employee_debt_reschedule.sql','utf8'),R2=fs.readFileSync('supabase/rollbacks/20261127090000_employee_debt_reschedule.rollback.sql','utf8');
 const tr=fs.readFileSync('supabase/migrations/20261018205000_accountant_chart_treasury.sql','utf8');const guard=tr.slice(tr.indexOf('create function clinic_finance.cash_line_guard()'),tr.indexOf('create trigger treasury_cash_line'));
 const ho=fs.readFileSync('supabase/migrations/20261019001000_treasury_shift_handover.sql','utf8');const ended=ho.slice(ho.indexOf('create function clinic_finance.ended_shift_entry_guard()'),ho.indexOf('create trigger treasury_ended_entry')).replace("new.source not in('treasury_transfer_out','treasury_binding')","new.source not in('treasury_transfer_out','treasury_binding','cash_case_settlement')");
 const db=new PGlite(),q=(s,p)=>db.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0];
 await db.exec(base);await db.exec(guard+';create trigger g1 before insert on clinic_finance.lines for each row execute function clinic_finance.cash_line_guard();');await db.exec(ended+';create trigger g2 before insert on clinic_finance.entries for each row execute function clinic_finance.ended_shift_entry_guard();');
 const P={mazen:[id(),id(),'reception'],acc:[id(),id(),'accountant'],fm:[id(),id(),'financial_manager'],sa:[id(),id(),'super_admin'],gm:[id(),id(),'general_manager']};
 for(const [k,[x,u,r]] of Object.entries(P))await q("insert into admins(id,user_id,name,role) values($1,$2,$3,$4)",[x,u,k,r]);
 const WS=id(),H=id(),HP=id(),INV=id();await q("insert into clinic_reception.workspaces values($1,'live')",[WS]);await q("insert into clinic_people.people values($1,'هدى','E-12','EMP-12')",[H]);
 await q("insert into clinic_reception.patients values($1,$2,'هدى')",[HP,WS]);await q("insert into clinic_reception.staff_map values($1,$2,'self')",[HP,H]);
 await q("insert into clinic_reception.invoices(id,workspace_id,patient_id,amount) values($1,$2,$3,360)",[INV,WS,HP]);
 await q("insert into clinic_finance.business_requests(kind,subject,reference,amount,payload,created_by,token,status) values('employment','EMP-12','C',5000,'{}',$1,gen_random_uuid(),'approved')",[P.fm[0]]);
 await db.exec(M1);await db.exec(M2);
 const as=async(w,fn)=>{await db.exec('begin');try{await q("select set_config('request.jwt.claim.sub',$1,true)",[P[w][1]]);const r=await fn();await db.exec('commit');return r;}catch(e){await db.exec('rollback');throw e;}};
 const ed=(w,a,p)=>as(w,async()=>(await one('select public.clinic_finance_employee_debt($1,$2::jsonb) r',[a,JSON.stringify(p||{})])).r);
 const ch=(w,a,p)=>as(w,async()=>(await one('select public.clinic_finance_employee_debt_change($1,$2::jsonb) r',[a,JSON.stringify(p||{})])).r);
 const err=async(pr,re)=>{await assert.rejects(pr,e=>{assert.match(e.message,re);return true;});};
 const cur=(await one("select to_char(date_trunc('month',(now() at time zone 'Africa/Cairo'))::date,'YYYY-MM-DD') m")).m;
 const add=(m,n)=>{const [y,mo]=m.split('-').map(Number);const k=mo-1+n;return (y+Math.floor(k/12))+'-'+String((k%12+12)%12+1).padStart(2,'0')+'-01';};
 const sched=async d=>(await q("select to_char(month,'YYYY-MM-DD') m,amount::numeric a,payroll_id is not null c from clinic_finance.employee_debt_installments where debt_id=$1 order by month",[d])).rows.map(r=>[r.m,+r.a,r.c]);
 // an approved debt: 360 over 3 months from this month
 let d=await ed('mazen','request',{kind:'service',invoice_id:INV,person_id:H,months:3,first_month:cur,reason:'خدمة',token:id()});d=await ed('fm','review',{id:d.id,ok:true});assert.equal(d.status,'approved');
 assert.deepEqual(await sched(d.id),[[cur,120,false],[add(cur,1),120,false],[add(cur,2),120,false]]);
 // payroll for this month claims the first installment
 const pay=await as('acc',async()=>(await one("select public.clinic_finance_business_command('request',$1::jsonb,$2) v",[JSON.stringify({kind:'payroll',subject:'EMP-12',month:cur}),id()])).v);
 assert.deepEqual((await sched(d.id))[0],[cur,120,true]);
 // schedule view
 let s=await ch('acc','schedule',{person_id:H});assert.equal(s.can_request,true);assert.equal(s.debts.length,1);assert.equal(s.debts[0].schedule.length,3);assert.equal(s.debts[0].schedule[0].claimed,true);
 await err(ch('mazen','schedule',{person_id:H}),/مش مسموح/);await err(ch('mazen','request',{debt_id:d.id,kind:'resplit',months:2,reason:'x x x',token:id()}),/للحسابات بس/);
 // postpone: refusals
 await err(ch('acc','request',{debt_id:d.id,kind:'postpone',from_month:cur,to_month:add(cur,4),reason:'ظروف',token:id()}),/لسه ماتخصمش/);
 await err(ch('acc','request',{debt_id:d.id,kind:'postpone',from_month:add(cur,1),to_month:add(cur,2),reason:'ظروف',token:id()}),/بعد آخر قسط/);
 await err(ch('acc','request',{debt_id:d.id,kind:'postpone',from_month:add(cur,1),to_month:add(cur,9),reason:'ظروف',token:id()}),/6 شهور/);
 await err(ch('acc','request',{debt_id:d.id,kind:'postpone',from_month:add(cur,1),to_month:add(cur,4),reason:'',token:id()}),/اكتب السبب/);
 // postpone month 2 → month 5
 const tk=id();let c=await ch('acc','request',{debt_id:d.id,kind:'postpone',from_month:add(cur,1),to_month:add(cur,4),reason:'ظروف عائلية',token:tk});
 assert.equal(c.status,'pending');assert.deepEqual(c.before.map(x=>x.month),[add(cur,1),add(cur,2)]);assert.deepEqual(c.after.map(x=>x.month),[add(cur,2),add(cur,4)]);
 assert.equal((await ch('acc','request',{debt_id:d.id,kind:'postpone',from_month:add(cur,1),to_month:add(cur,4),reason:'ظروف عائلية',token:tk})).id,c.id,'idempotent');
 await err(ch('fm','request',{debt_id:d.id,kind:'resplit',months:4,reason:'تاني',token:id()}),/مستني موافقة/);
 await err(ch('acc','review',{id:c.id,ok:true}),/المالي أو المالك/);await err(ch('gm','review',{id:c.id,ok:true}),/المالي أو المالك/);
 let L=await ch('fm','list',{});assert.equal(L.inbox.length,1);L=await ch('acc','list',{});assert.equal(L.inbox.length,0);assert.equal(L.items.length,1);
 const books0=(await one("select count(*)::int n from clinic_finance.entries")).n;
 c=await ch('fm','review',{id:c.id,ok:true});assert.equal(c.status,'approved');
 assert.deepEqual(await sched(d.id),[[cur,120,true],[add(cur,2),120,false],[add(cur,4),120,false]]);
 assert.equal((await one("select count(*)::int n from clinic_finance.entries")).n,books0,'no entry posted');
 assert.equal(+(await one("select sum(amount) s from clinic_finance.employee_debt_installments where debt_id=$1",[d.id])).s,360,'amount unchanged');
 // resplit the rest (240) into 4 from next month — FM asks, owner approves; requester can't approve own
 c=await ch('fm','request',{debt_id:d.id,kind:'resplit',months:4,first_month:add(cur,1),reason:'طلب الموظفة',token:id()});
 assert.deepEqual(c.after.map(x=>+x.amount),[60,60,60,60]);
 await err(ch('fm','review',{id:c.id,ok:true}),/غير اللي طلب/);
 c=await ch('sa','review',{id:c.id,ok:true});assert.equal(c.status,'approved');
 assert.deepEqual(await sched(d.id),[[cur,120,true],[add(cur,1),60,false],[add(cur,2),60,false],[add(cur,3),60,false],[add(cur,4),60,false]]);
 // resplit into a month whose installment is already claimed → refused; 1 installment (all at once) works; rounding 7
 await err(ch('acc','request',{debt_id:d.id,kind:'resplit',months:2,first_month:cur,reason:'كله',token:id()}),/مرتب متجهز/);
 c=await ch('acc','request',{debt_id:d.id,kind:'resplit',months:7,first_month:add(cur,1),reason:'سبعة',token:id()});assert.equal(Math.round(c.after.reduce((s,x)=>s+ +x.amount,0)*100)/100,240);assert.equal(+c.after[6].amount,Math.round((240-34.29*6)*100)/100);
 // stale: a payroll claims next month after the request → approval refused, then reject (reason) works
 await as('acc',async()=>one("select public.clinic_finance_business_command('request',$1::jsonb,$2) v",[JSON.stringify({kind:'payroll',subject:'EMP-12',month:add(cur,1)}),id()]));
 await err(ch('fm','review',{id:c.id,ok:true}),/الجدول اتغيّر/);
 await err(ch('fm','review',{id:c.id,ok:false}),/سبب الرفض/);assert.equal((await ch('fm','review',{id:c.id,ok:false,note:'اطلب تاني'})).status,'rejected');
 // cancel own pending
 c=await ch('acc','request',{debt_id:d.id,kind:'resplit',months:1,first_month:add(cur,2),reason:'مرة واحدة',token:id()});await err(ch('fm','cancel',{id:c.id}),/مش موجود/);assert.equal((await ch('acc','cancel',{id:c.id})).status,'cancelled');
 // payroll rejected → installment released and can move again
 await as('fm',async()=>one("select public.clinic_finance_business_command('review',$1::jsonb,$2) v",[JSON.stringify({id:pay,approve:false}),id()]));
 assert.equal((await sched(d.id))[0][2],false);
 // rollback (installment moves stay)
 const before=await sched(d.id);await db.exec(R2);assert.equal((await one("select to_regclass('clinic_finance.employee_debt_changes') x")).x,null);assert.deepEqual(await sched(d.id),before);await db.exec(M2);
 console.log('PASS employee debt reschedule SQL: postpone / resplit asked by finance, approved by FM / owner (not the requester); only unclaimed installments move, claimed months protected, stale refused, no entry, amount kept, cancel, rollback.');
})().catch(e=>{console.error(e);process.exit(1);});
