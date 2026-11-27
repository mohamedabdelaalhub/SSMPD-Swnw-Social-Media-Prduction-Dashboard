// «سعر بيع ثابت» (20261127280000): a fixed item keeps the typed price through a receipt (cost × markup), «طبّق الهامش الموحّد
// على كل الأصناف», the inventory_standard_markup trigger and the medicine trigger; no fake price-history rows; setter by the
// inventory manager only, with history + audit; leaving «ثابت» via «نوع التسعير»; the 3 owner items fixed only at their
// expected price; rollback. PGlite with the REAL triggers / setters from 20261017190930 and 20261122300000.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite'),{randomUUID:id}=require('crypto');
(async()=>{const db=new PGlite(),q=(s,p)=>db.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0];
 const std=fs.readFileSync('supabase/migrations/20261017190930_inventory_standard_markup_batch_codes.sql','utf8');
 const cut=(src,a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)));
 const med=fs.readFileSync('supabase/migrations/20261122300000_medicines_pricing_discount.sql','utf8');
 const M=fs.readFileSync('supabase/migrations/20261127280000_inventory_fixed_sale_price.sql','utf8'),R=fs.readFileSync('supabase/rollbacks/20261127280000_inventory_fixed_sale_price.rollback.sql','utf8');
 await db.exec(`create role authenticated;create role anon;create schema auth;create schema clinic_finance;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create table admins(id uuid primary key,user_id uuid,name text,role text,active boolean default true);
  create function my_admin_id() returns uuid language sql stable security definer as $$select id from admins where user_id=auth.uid()$$;
  create function inventory_is_manager() returns boolean language sql stable security definer as $$select exists(select 1 from admins where user_id=auth.uid() and role in ('inventory_manager','super_admin'))$$;
  create function inventory_location_can(l uuid,a text) returns boolean language sql stable as $$select false$$;
  create table inventory_items(id uuid primary key default gen_random_uuid(),sku text,name text,active boolean default true,markup_percent numeric(12,4) not null default 0,current_sale_price numeric(14,2) not null default 0,use_standard_markup boolean not null default false,updated_at timestamptz);
  alter table inventory_items add column pricing_kind text not null default 'supply' check (pricing_kind in ('supply','medicine','shortage'));
  create table inventory_purchases(item_id uuid,cost numeric);
  create function clinic_finance.inventory_highest_purchase(p uuid) returns numeric language sql stable as $$select max(cost) from inventory_purchases where item_id=p$$;
  create table inventory_price_history(id bigserial,item_id uuid,previous_price numeric,new_price numeric,previous_markup numeric,new_markup numeric,changed_by uuid);
  create table inventory_audit_events(id bigserial,entity_id uuid,kind text,actor_id uuid,detail text);
  create table clinic_finance.inventory_pricing_settings(id boolean primary key default true,configured boolean not null default false,markup_percent numeric(12,4) not null default 0,updated_by uuid,updated_at timestamptz);
  insert into clinic_finance.inventory_pricing_settings(id,configured,markup_percent) values(true,true,35);
  create function inventory_pricing_list() returns jsonb language sql as $$select '[]'::jsonb$$;`);
 await db.exec(cut(std,'create function clinic_finance.inventory_apply_standard()','alter function public.inventory_save_catalog'));
 await db.exec(cut(med,'create function public.inventory_medicine_no_markup()','revoke all on function public.inventory_set_pricing_kind'));
 const P={mgr:[id(),id(),'inventory_manager'],sa:[id(),id(),'super_admin'],rec:[id(),id(),'reception']};
 for(const [k,[a,u,r]] of Object.entries(P))await q("insert into admins values($1,$2,$3,$4,true)",[a,u,k==='sa'?'محمد عبدالعال':k,r]);
 const SP=id(),CY=id(),SPC=id(),GZ=id(),MD=id();
 await q("insert into inventory_items(id,sku,name,markup_percent,current_sale_price) values($1,'ITM-0000595','سكين بروتيكتور',0,50),($2,'ITM-0000596','اسطوانة',0,1500),($3,'ITM-0000597','مباعد',0,140),($4,'ITM-1','شاش',35,5.4)",[SP,CY,SPC,GZ]);
 await q("insert into inventory_items(id,sku,name,markup_percent,current_sale_price,pricing_kind) values($1,'ITM-2','دواء',0,20,'medicine')",[MD]);
 await q("insert into inventory_purchases values($1,10),($2,4),($3,20)",[SP,GZ,MD]);
 const notes=[];await db.exec(M,{onNotice:n=>notes.push(n.message)});
 assert.ok(notes.includes('fixed: ITM-0000595 — price 50'),'595 fixed');assert.ok(notes.includes('fixed: ITM-0000596 — price 1500'));assert.ok(notes.some(n=>/NOT fixed \(price changed\): ITM-0000597 — now 140\.00 \(expected 150\)/.test(n)),'597 refused: price differs');
 const it=async x=>one("select pricing_kind k,fixed_sale_price::numeric f,current_sale_price::numeric p,markup_percent::numeric m,use_standard_markup u from inventory_items where id=$1",[x]);
 let r=await it(SP);assert.deepEqual([r.k,+r.f,+r.p],['fixed',50,50]);assert.equal((await it(SPC)).k,'supply');
 const hist0=(await one("select count(*)::int n from inventory_price_history")).n;
 // 1) a receipt (same update the receive path does): price := cost × (1 + markup)
 await q("update inventory_items set current_sale_price=round(10*(1+markup_percent/100),2),updated_at=now() where id=$1",[SP]);
 await q("insert into inventory_price_history(item_id,previous_price,new_price,previous_markup,new_markup) values($1,50,10,0,0)",[SP]);
 r=await it(SP);assert.equal(+r.p,50,'receipt cannot change a fixed price');
 // 2) «طبّق الهامش الموحّد على كل الأصناف»
 const as=async(w,fn)=>{await db.exec('begin');try{await q("select set_config('request.jwt.claim.sub',$1,true)",[P[w][1]]);const x=await fn();await db.exec('commit');return x;}catch(e){await db.exec('rollback');throw e;}};
 await as('mgr',()=>q("select public.inventory_set_standard_markup(40,true)"));
 r=await it(SP);assert.deepEqual([+r.p,r.u,+r.m],[50,false,0],'apply-all: price kept, not moved to the standard markup');
 r=await it(GZ);assert.equal(+r.p,5.6,'normal items still get the standard markup (4 × 1.40)');
 // 3) the standard-markup trigger and the medicine trigger
 await q("update inventory_items set use_standard_markup=true,markup_percent=99 where id=$1",[SP]);r=await it(SP);assert.deepEqual([+r.p,r.u],[50,false]);
 assert.equal((await one("select count(*)::int n from inventory_price_history where item_id=$1",[SP])).n,0,'no fake history rows for the fixed item');
 assert.ok((await one("select count(*)::int n from inventory_price_history")).n>hist0,'other items keep their history');
 // setter: refusals + change (history + audit)
 const setf=(w,x,p)=>as(w,async()=>(await one("select public.inventory_set_fixed_price($1,$2) r",[x,p])).r);
 await assert.rejects(setf('rec',SP,60),/لمسؤول المخزن/);await assert.rejects(setf('mgr',SP,-1),/اكتب سعر البيع/);await assert.rejects(setf('mgr',SP,1.234),/اكتب سعر البيع/);
 let s=await setf('mgr',SP,60);assert.deepEqual([s.pricing_kind,+s.sale_price,+s.effective_margin,s.below_cost],['fixed',60,500,false]);
 s=await setf('mgr',SP,8);assert.equal(s.below_cost,true,'below cost allowed, flagged');
 assert.equal((await one("select count(*)::int n from inventory_price_history where item_id=$1",[SP])).n,2,'real changes recorded');
 assert.equal((await one("select count(*)::int n from inventory_audit_events where entity_id=$1 and kind='fixed_price'",[SP])).n,3,'owner fix + 2 changes audited');
 // set a supply item to fixed, then leave «ثابت» through «نوع التسعير»
 s=await setf('sa',GZ,9);assert.equal(+s.sale_price,9);
 await assert.rejects(as('mgr',()=>q("select public.inventory_set_pricing_kind($1,'fixed',null)",[GZ])),/سعر بيع ثابت/);
 let k=await as('mgr',async()=>(await one("select public.inventory_set_pricing_kind($1,'supply',35) r",[GZ])).r);
 r=await it(GZ);assert.deepEqual([r.k,r.f,+r.p],['supply',null,5.4],'back to cost + 35%');
 assert.ok((await one("select count(*)::int n from inventory_price_history where item_id=$1 and new_price=5.4",[GZ])).n>=1,'leaving fixed is a recorded change');
 // medicine untouched
 r=await it(MD);assert.equal(r.k,'medicine','medicine kind untouched by this change');
 // rollback: keeps prices
 await db.exec(R);r=await one("select pricing_kind k,current_sale_price::numeric p from inventory_items where id=$1",[SP]);assert.deepEqual([r.k,+r.p],['supply',8]);
 assert.equal((await one("select to_regprocedure('public.inventory_set_fixed_price(uuid,numeric)') x")).x,null);
 await assert.rejects(q("update inventory_items set pricing_kind='fixed' where id=$1",[SP]),/check/i);
 console.log('PASS inventory fixed sale price SQL: kept through receipt / apply-all / triggers, no fake history, setter (manager) with history + audit, leave via «نوع التسعير», owner items fixed only at the expected price, rollback.');
})().catch(e=>{console.error(e);process.exit(1);});
