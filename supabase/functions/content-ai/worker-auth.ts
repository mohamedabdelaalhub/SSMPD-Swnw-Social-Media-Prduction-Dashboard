// Public verification key only. The signing seed remains in the protected Windows config.
export async function verifyWorkerToken(value:string):Promise<boolean>{
 const token=value.replace(/^Bearer /,'');const parts=token.split('.');
 if(parts.length!==3||parts[0]!=='CM'||!/^\d{13}$/.test(parts[1])||Math.abs(Date.now()-Number(parts[1]))>300000||!/^[A-Za-z0-9_-]+$/.test(parts[2]))return false;
 try{const decode=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
 const key=await crypto.subtle.importKey('raw',decode('i_pF3iv0zH2m7O4oNV48j_wQowbW46Z2vDg-2R-OHs4'),{name:'Ed25519'},false,['verify']);
 return await crypto.subtle.verify('Ed25519',key,decode(parts[2]),new TextEncoder().encode(parts[1]));}catch{return false;}
}

