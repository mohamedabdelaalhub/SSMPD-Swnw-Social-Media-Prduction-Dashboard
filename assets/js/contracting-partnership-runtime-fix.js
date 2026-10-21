/* One-shot compatibility shim for Contracting Partnership Hub.
   The hub was introduced with a second Supabase client configured with
   persistSession:false. That client did not recover the signed-in dashboard
   session, so RLS returned zero rows and `.single()` surfaced PGRST116:
   "Cannot coerce the result to a single JSON object".
   Force only the next createClient call (the partnership hub) to recover the
   existing dashboard session, then immediately restore Supabase's original API. */
(function(){
  'use strict';
  if(!window.supabase || typeof window.supabase.createClient!=='function') return;
  var original=window.supabase.createClient;
  var used=false;
  window.supabase.createClient=function(url,key,options){
    if(used) return original.call(window.supabase,url,key,options);
    used=true;
    var next=Object.assign({},options||{});
    next.auth=Object.assign({},next.auth||{}, {
      persistSession:true,
      autoRefreshToken:true,
      detectSessionInUrl:false
    });
    var client=original.call(window.supabase,url,key,next);
    window.supabase.createClient=original;
    return client;
  };

  /* Direct document delivery is isolated from the legacy partnership builder.
     Loading it here avoids another permanent index.html dependency and keeps the
     compatibility shim as the single bootstrap point for partnership add-ons. */
  if(!document.querySelector('script[data-contracting-document-send]')){
    var s=document.createElement('script');
    s.src='assets/js/contracting-document-send.js?v=contracting-send-pdf-20261021-1';
    s.async=false;
    s.setAttribute('data-contracting-document-send','1');
    document.head.appendChild(s);
  }
})();