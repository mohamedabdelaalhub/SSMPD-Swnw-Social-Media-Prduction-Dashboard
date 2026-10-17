import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
const sharedSecret = Deno.env.get('BOOKING_SYNC_SECRET');
function serviceKey() {
  const raw = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (raw) { try { const keys = JSON.parse(raw); if (typeof keys.default==='string' && keys.default) return keys.default; } catch {} }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
}
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status, headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return reply({error:'POST only'},405);
  if (!sharedSecret || req.headers.get('X-Booking-Sync-Secret') !== sharedSecret) return reply({error:'unauthorized'},401);
  const key=serviceKey(),url=Deno.env.get('SUPABASE_URL');
  if (!key || !url) return reply({error:'misconfigured'},503);
  let body: Record<string,unknown>;
  try { body=await req.json(); } catch { return reply({error:'invalid_json'},400); }
  if (!body || typeof body!=='object' || !['lease','ack'].includes(String(body.action))) return reply({error:'invalid_action'},400);
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await client.rpc('clinic_booking_outbox',{p_action:body.action,p_payload:body.payload||{}});
  if(error) return reply({error:'outbox_rejected'},400);
  return reply({ok:true,result:data});
});
