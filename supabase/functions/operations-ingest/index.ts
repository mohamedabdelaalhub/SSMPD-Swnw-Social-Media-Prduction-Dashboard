import {createClient} from 'npm:@supabase/supabase-js@2';
import {verified,checkedEnvelope} from './contract.mjs';
Deno.serve(async(req:Request)=>{
 if(req.method!=='POST')return new Response('POST only',{status:405});
 try{
  if(Number(req.headers.get('content-length')||0)>350000)return new Response('Too large',{status:413});
  const raw=await req.text();if(raw.length>350000)return new Response('Too large',{status:413});
  if(!await verified(Deno.env.get('OPERATIONS_BRIDGE_SECRET'),req.headers.get('x-operations-time'),raw,req.headers.get('x-operations-signature')))return new Response('Unauthorized',{status:401});
  const envelope=checkedEnvelope(JSON.parse(raw));
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
  const {data,error}=await db.rpc('operations_ingest_snapshot',{p_snapshot:envelope.snapshot,p_approved_at:envelope.approved_at,p_actor:envelope.approved_by});
  if(error)return Response.json({error:'Unable to record report'},{status:503});
  return Response.json({ok:true,...data});
 }catch{return Response.json({error:'Invalid report'},{status:400});}
});
