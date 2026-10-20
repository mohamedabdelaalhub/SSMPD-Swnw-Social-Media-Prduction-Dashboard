// Narrow website projection: no financial terms or contract attachments are accepted.
export function contractPayload(input){
 if(!input||!/^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.test(input.id)||!['doctor','entity'].includes(input.kind)||typeof input.visible!=='boolean')throw Error('INVALID_FIELDS');
 const observedAt=Date.parse(input.observedAt);if(!Number.isFinite(observedAt)||observedAt>Date.now()+300000)throw Error('INVALID_FIELDS');
 const name=String(input.name||'').trim().slice(0,180);if(input.visible&&!name)throw Error('INVALID_FIELDS');
 const facts=input.facts||{};
 return {id:input.id,kind:input.kind,type:input.kind==='doctor'?'doctor':'insurer',visible:input.visible,name,observedAt:new Date(observedAt).toISOString(),assetKey:String(input.asset_path||'').slice(0,250),imageUrl:String(input.image_url||''),metadata:{match:String(facts.site_match||name).slice(0,180),department:String(facts.department||'').slice(0,180),rank:String(facts.title||'').slice(0,250),website:/^https:\/\//.test(facts.website||'')?String(facts.website).slice(0,500):''}};
}
export async function syncContract(db,input,{now,storeImage,publish,audit}){
 const p=contractPayload(input),stamp=now(),slug='contract-'+p.id;
 const key=value=>String(value||'').replace(/\([^)]*\)/g,' ').normalize('NFKD').replace(/[\u064b-\u065f\u0670\u0640]/g,'').replace(/[أإآ]/g,'ا').replace(/ى/g,'ي').replace(/ة/g,'ه').replace(/[()\/.,_—–-]+/g,' ').replace(/^\s*(?:دكتور|دكتوره|د)\s+/,'').replace(/\s+/g,' ').trim();
 let existing=db.prepare('SELECT * FROM content_items WHERE type=? AND (slug=? OR json_extract(metadata_json,\'$.externalContractId\')=?)').get(p.type,slug,p.id);
 if(!existing&&p.name){const matches=db.prepare('SELECT * FROM content_items WHERE type=?').all(p.type).filter(row=>{const meta=JSON.parse(row.metadata_json);return !meta.externalContractId&&key(meta.match||row.title)===key(p.metadata.match);});if(matches.length>1)throw Error('توجد كروت متكررة؛ راجع ربط الكارت قبل المزامنة');existing=matches[0];}
 const before=existing?JSON.parse(existing.metadata_json):{};
 if(before.contractSeenAt&&before.contractSeenAt>p.observedAt)return {ok:true,status:'stale'};
 let imagePath=existing?.image_path||'';
 if(p.visible&&p.imageUrl&&before.contractAsset!==p.assetKey)imagePath=await storeImage(p.imageUrl);
 const manualRemoved=(before.manualRemoved===true&&before.removed===true)||(before.removed===true&&before.contractInactive!==true);
 const metadata=JSON.stringify({...before,...p.metadata,source:'contract-dashboard',externalContractId:p.id,contractAsset:p.assetKey,contractSeenAt:p.observedAt,manualRemoved,contractInactive:!p.visible,removed:manualRemoved||!p.visible});
 const title=p.name||existing?.title||'تعاقد غير متاح';
 let id=existing?.id;
 if(existing){
  db.prepare('UPDATE content_items SET title=?,image_path=?,metadata_json=?,status=?,pending_review=0,updated_at=? WHERE id=?').run(title,imagePath,metadata,'published',stamp,id);
 }else{
  const owner=db.prepare("SELECT id FROM users WHERE role='admin' ORDER BY protected DESC,id LIMIT 1").get();
  id=Number(db.prepare("INSERT INTO content_items(type,slug,title,image_path,metadata_json,status,created_by,updated_by,created_at,updated_at,pending_review) VALUES(?,?,?,?,?,'published',?,?,?,?,0)").run(p.type,slug,title,imagePath,metadata,owner.id,owner.id,stamp,stamp).lastInsertRowid);
 }
 const row=db.prepare('SELECT * FROM content_items WHERE id=?').get(id);
 db.prepare('UPDATE content_items SET published_json=?,published_at=? WHERE id=?').run(JSON.stringify(publish(row)),stamp,id);
 // Eligibility timestamps change on each poll; log actual display changes only.
 if(!existing||existing.title!==title||existing.image_path!==imagePath||before.removed!==(manualRemoved||!p.visible))audit(id,title,p.visible);
 return {ok:true,itemId:id,status:p.visible&&!manualRemoved?'published':'hidden'};
}
