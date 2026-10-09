export function outcome(http, body, action) {
 if ((http===200||http===201) && body?.ok===true) {
  if(action==='unpublish') return 'unpublished';
  if(body.status==='published') return 'published';
  if(body.pendingReview===true) return 'pending_review';
  return 'failed';
 }
 return http===429||http>=500||http===0 ? 'retry' : 'failed';
}
export function buildPayload(snapshot) {
 const { _imageUrl, _slides, _videoUrl, ...body }=snapshot;
 if(body.action==='unpublish') return {id:body.id,action:'unpublish'};
 if(!body.title?.trim() || !Array.isArray(body.platforms)||!body.platforms.includes('website')) throw Error('INVALID_FIELDS');
 if(body.publishedUrl){try{const u=new URL(body.publishedUrl);if(u.protocol!=='https:'||u.username||u.password)throw Error();}catch{throw Error('INVALID_PUBLISHED_URL');}}
 else delete body.publishedUrl;
 return body;
}
export function imageBytes(bytes) {
 let mime;
 if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)mime='image/jpeg';
 if(bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10')mime='image/png';
 if(new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP')mime='image/webp';
 if(!mime||bytes.length>5*1024*1024)throw Error('INVALID_FILE');
 let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
 return {name:'post.'+({ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp' }[mime]),mime,base64:btoa(binary)};
}
export async function deliver(endpoint, secret, payload, fetcher=fetch) {
 const body=JSON.stringify(payload);
 if(new TextEncoder().encode(body).length>8*1024*1024)throw Error('REQUEST_TOO_LARGE');
 const response=await fetcher(endpoint,{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body,signal:AbortSignal.timeout(45000)});
 let data={};try{data=await response.json();}catch{}
 return {http:response.status,status:outcome(response.status,data,payload.action),path:typeof data.publicPath==='string'?data.publicPath:null};
}
// Private file → storage key inside the expected bucket (and content folder for designs), or null.
export function privateKey(fileUrl, origin, bucket, contentId) {
 try{
  const u=new URL(fileUrl),prefix='/storage/v1/object/';
  if(u.origin!==origin||!u.pathname.startsWith(prefix))return null;
  const path=decodeURIComponent(u.pathname.slice(prefix.length)).replace(/^(authenticated|sign|public)\//,'');
  if(!path.startsWith(bucket+'/')||path.includes('..'))return null;
  const key=path.slice(bucket.length+1);
  if(contentId&&!key.startsWith(contentId+'/'))return null;
  return key;
 }catch{return null;}
}
