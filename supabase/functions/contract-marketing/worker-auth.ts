// Public verification keys only. Each signing seed stays in its own worker's protected config:
// the built-in key is the Windows website worker; CONTRACT_MARKETING_WORKER_PUBKEYS (comma-separated, base64url raw Ed25519)
// adds others, e.g. the dashboard-server rendering worker (print its key with `contract-marketing-worker.mjs --print-public-key`).
const WINDOWS_WORKER='i_pF3iv0zH2m7O4oNV48j_wQowbW46Z2vDg-2R-OHs4';
export function workerPublicKeys(extra:string|undefined):string[]{
 return [WINDOWS_WORKER,...String(extra||'').split(',').map(k=>k.trim()).filter(k=>/^[A-Za-z0-9_-]{43}$/.test(k))];
}
export async function verifyWorkerToken(value:string,extra:string|undefined=Deno.env.get('CONTRACT_MARKETING_WORKER_PUBKEYS')):Promise<boolean>{
 const token=value.replace(/^Bearer /,'');const parts=token.split('.');
 if(parts.length!==3||parts[0]!=='CM'||!/^\d{13}$/.test(parts[1])||Math.abs(Date.now()-Number(parts[1]))>300000||!/^[A-Za-z0-9_-]+$/.test(parts[2]))return false;
 const decode=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
 for(const k of workerPublicKeys(extra)){
  try{const key=await crypto.subtle.importKey('raw',decode(k),{name:'Ed25519'},false,['verify']);
   if(await crypto.subtle.verify('Ed25519',key,decode(parts[2]),new TextEncoder().encode(parts[1])))return true;}catch{/* next key */}
 }
 return false;
}

