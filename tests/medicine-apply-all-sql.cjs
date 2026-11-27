// 20261127320000: «طبّق الهامش الموحّد على كل الأصناف» never marks up a medicine. PGlite with the REAL apply-all
// (inventory_set_standard_markup), standard trigger and medicine trigger; repair of a medicine already marked up; no fake
// history; supply items unchanged; rollback.
const fs=require('fs'),assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite'),{randomUUID:id}=require('crypto');
(async()=>{const db=new PGlite(),q=(s,p)=>db.query(s,p),one=async(s,p)=>(await q(s,p)).rows[0];
 const cut=(src,a,b)=>src.slice(src.indexOf(a),src.indexOf(b,src.indexOf(a)));
 const std=fs.readFileSync('supabase/migrations/20261017190930_inventory_standard_markup_batch_codes.sql','utf8');
 const med=fs.readFileSync('supabase/migrations/20261122300000_medicines_pricing_discount.sql','utf8');
 const M=fs.readFileSync('supabase/migrations/20261127320000_medicine_apply_all_no_markup.sql','utf8'),R=fs.readFileSync('supabase/rollbacks/20261127320000_medicine_apply_all_no_markup.rollback.sql','utf8');
 await db.exec(`create role authenticated;create role anon;create schema auth;create schema clinic_finance;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create table admins(id uuid primary key,user_id uuid,name text,role text,active boolean default true);
  create function my_admin_id() returns uuid language sql stable security definer as $$select id from admins where user_id=auth.uid()$$;
  create function inventory_is_manager() returns boolean language sql stable security definer as $$select exists(select 1 from admins where user_id=auth.uid() and role in ('inventory_manager','super_admin'))$$;
  create table inventory_items(id uuid primary key default gen_random_uuid(),sku text,name text,active boolean default true,markup_percent numeric(12,4) not null default 0,current_sale_price numeric(14,2) not null default 0,use_standard_markup boolean not null default false,updated_at timestamptz,pricing_kind text not null default 'supply');
  create table inventory_purchases(item_id uuid,cost numeric);
  create function clinic_finance.inventory_highest_purchase(p uuid) returns numeric language sql stable as $$select max(cost) from inventory_purchases where item_id=p$$;
  create table inventory_price_history(id bigserial,item_id uuid,previous_price numeric,new_price numeric,previous_markup numeric,new_markup numeric,changed_by uuid);
  create table inventory_audit_events(id bigserial,entity_id uuid,kind text,actor_id uuid,detail text);
  create table clinic_finance.inventory_pricing_settings(id boolean primary key default true,configured boolean not null default false,markup_percent numeric(12,4) not null default 0,updated_by uuid,updated_at timestamptz);
  insert into clinic_finance.inventory_pricing_settings(id,configured,markup_percent) values(true,true,35);
  create function inventory_set_pricing_kind(p_item uuid,p_kind text,p_markup numeric default null) returns jsonb language sql as $$select '{}'::jsonb$$;`);
 await db.exec(cut(std,'create function clinic_finance.inventory_apply_standard()','alter function public.inventory_save_catalog'));
 await db.exec(cut(med,'create function public.inventory_medicine_no_markup()','create function public.inventory_set_pricing_kind'));
 const mgr=[id(),id()],sa=[id(),id()];await q("insert into admins values($1,$2,'مسؤول المخزن','inventory_manager',true),($3,$4,'محمد عبدالعال','super_admin',true)",[...mgr,...sa]);
 const MD=id(),MD2=id(),GZ=id();
 await q("insert into inventory_items(id,sku,name,markup_percent,current_sale_price,pricing_kind) values($1,'ITM-M1','دواء',0,20,'medicine'),($2,'ITM-M2','دواء تاني',0,40,'medicine'),($3,'ITM-S1','شاش',35,5.4,'supply')",[MD,MD2,GZ]);
 await q("insert into inventory_purchases values($1,20),($2,40),($3,4)",[MD,MD2,GZ]);
 const as=async fn=>{await db.exec('begin');try{await q("select set_config('request.jwt.claim.sub',$1,true)",[mgr[1]]);const x=await fn();await db.exec('commit');return x;}catch(e){await db.exec('rollback');throw e;}};
 const it=async x=>one("select markup_percent::numeric m,current_sale_price::numeric p,use_standard_markup u from inventory_items where id=$1",[x]);
 // BEFORE: the bug — apply-all marks the medicine up
 await as(()=>q("select public.inventory_set_standard_markup(35,true)"));
 let r=await it(MD);assert.deepEqual([+r.m,+r.p,r.u],[35,27,true],'bug reproduced: medicine 20 → 27 with apply-all');
 // live dry-run first (ends with ROLLBACK, nothing kept)
 const L=fs.readFileSync('tests/medicine-apply-all-live-rollback.sql','utf8'),ln=[];await db.exec('grant usage on schema public to authenticated');await db.exec(L,{onNotice:n=>ln.push(n.message)});
 assert.ok(ln.includes('ALL SCENARIOS PASSED'),ln.join('\n'));assert.ok(ln.some(n=>/A apply-all at 35\.0000: 3 items looped, 1 supply items, medicines changed: 0, medicine history rows added: 0/.test(n)),ln.join('\n'));
 assert.equal((await one("select to_regprocedure('public.inventory_medicine_history_guard()') x")).x,null,'dry-run kept nothing');r=await it(MD);assert.equal(+r.p,27,'still the bug state after the dry-run');
 // migration: the marked-up medicine is repaired (one real history row), the untouched one too
 const notes=[];await db.exec(M,{onNotice:n=>notes.push(n.message)});
 assert.ok(notes.some(n=>/medicine back to no markup: ITM-M1 — 27\.00 \(markup 35\.0000\) → 20\.00/.test(n)),notes.join('\n'));
 assert.ok(notes.includes('medicines repaired: 2'),'both medicines were on the standard markup');
 r=await it(MD);assert.deepEqual([+r.m,+r.p,r.u],[0,20,false]);
 assert.equal((await one("select count(*)::int n from inventory_price_history where item_id=$1 and new_price=20 and new_markup=0",[MD])).n,1,'repair recorded');
 const h0=(await one("select count(*)::int n from inventory_price_history where item_id in ($1,$2)",[MD,MD2])).n;
 // AFTER: apply-all again (another rate) — medicines stay at their purchase price, supply items get the new markup
 await as(()=>q("select public.inventory_set_standard_markup(50,true)"));
 r=await it(MD);assert.deepEqual([+r.m,+r.p,r.u],[0,20,false],'medicine kept');r=await it(MD2);assert.deepEqual([+r.m,+r.p],[0,40]);
 r=await it(GZ);assert.deepEqual([+r.m,+r.p,r.u],[50,6,true],'supply item: 4 × 1.50');
 assert.equal((await one("select count(*)::int n from inventory_price_history where item_id in ($1,$2)",[MD,MD2])).n,h0,'no fake history for medicines');
 assert.ok((await one("select count(*)::int n from inventory_price_history where item_id=$1 and new_markup=50",[GZ])).n===1,'supply history kept');
 // direct writes still guarded
 await q("update inventory_items set use_standard_markup=true where id=$1",[MD]);r=await it(MD);assert.deepEqual([+r.m,+r.p,r.u],[0,20,false]);
 await q("update inventory_items set markup_percent=10 where id=$1",[MD]);r=await it(MD);assert.deepEqual([+r.m,+r.p],[0,20]);
 // run twice refused
 await assert.rejects(db.exec(M),/تم تطبيق هذا الملف من قبل/);
 // rollback: guard gone, old trigger body back
 await db.exec(R);assert.equal((await one("select to_regprocedure('public.inventory_medicine_history_guard()') x")).x,null);
 assert.doesNotMatch((await one("select pg_get_functiondef('public.inventory_medicine_no_markup()'::regprocedure) d")).d,/use_standard_markup/);
 r=await it(MD);assert.deepEqual([+r.m,+r.p],[0,20],'repaired price stays after rollback');
 console.log('PASS medicine apply-all: bug reproduced, repair (history + notice), apply-all keeps medicines at cost, supply marked up, no fake history, direct writes guarded, idempotent, rollback.');
})().catch(e=>{console.error(e);process.exit(1);});
