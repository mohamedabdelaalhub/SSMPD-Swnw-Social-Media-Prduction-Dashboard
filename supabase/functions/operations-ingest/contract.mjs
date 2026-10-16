export async function signature(secret,text){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');}
export async function verified(secret,stamp,body,sig,now=Date.now()){
 if(!secret||secret.length<32||!/^\d{13}$/.test(stamp||'')||Math.abs(now-Number(stamp))>300000||!/^[0-9a-f]{64}$/.test(sig||''))return false;
 const expected=await signature(secret,stamp+'.'+body);let diff=0;for(let i=0;i<64;i++)diff|=expected.charCodeAt(i)^sig.charCodeAt(i);return diff===0;
}
export function checkedEnvelope(value){
 const s=value?.snapshot;
 if(value?.source!=='raocrmssjqsozibniujc'||!s||s.schema_version!==1||!/^\w{8}-[\w-]{27}$/.test(value.approved_by||'')||!Number.isFinite(Date.parse(value.approved_at)))throw Error('Invalid source');
 if(!/^[a-f0-9]{64}$/.test(s.fingerprint||'')||!/^\d{4}-\d{2}-\d{2}$/.test(s.period_from||'')||!/^\d{4}-\d{2}-\d{2}$/.test(s.period_to||'')||s.period_to<s.period_from)throw Error('Invalid period');
 for(const key of ['branch','scope','title'])if(typeof s[key]!=='string'||s[key].trim().length<2||s[key].length>160)throw Error('Invalid labels');
 if(!s.kpis||Array.isArray(s.kpis)||Object.values(s.kpis).some(v=>typeof v!=='number'||!Number.isFinite(v)))throw Error('Invalid metrics');
 for(const [key,max] of [['risks',200],['recommendations',200],['plan',300]])if(!Array.isArray(s[key])||s[key].length>max)throw Error('Invalid records');
 // Strict top-level contract prevents accidental inclusion of raw uploaded files.
 if(Object.keys(s).some(k=>!['schema_version','fingerprint','branch','scope','title','period_from','period_to','kpis','risks','recommendations','plan','coverage','coverage_notice'].includes(k)))throw Error('Unexpected report fields');
 for(const r of s.risks)if(typeof r.id!=='string'||!r.id||r.id.length>180||typeof r.title!=='string'||!r.title||r.title.length>500)throw Error('Invalid risk');
 return value;
}
