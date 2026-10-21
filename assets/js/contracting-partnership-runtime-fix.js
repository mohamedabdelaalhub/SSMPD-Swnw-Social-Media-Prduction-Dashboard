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

  /* The html2pdf bundle does not expose window.jspdf consistently on mobile
     browsers. The delivery helper creates the PDF page-by-page with jsPDF, so
     load the standalone UMD build first and only then attach the helper. */
  function loadDeliveryHelper(){
    if(document.querySelector('script[data-contracting-document-send]')) return;
    var s=document.createElement('script');
    s.src='assets/js/contracting-document-send.js?v=contracting-send-pdf-20261021-3';
    s.async=false;
    s.setAttribute('data-contracting-document-send','1');
    document.head.appendChild(s);
  }

  if(window.jspdf && window.jspdf.jsPDF){
    loadDeliveryHelper();
  }else if(!document.querySelector('script[data-contracting-jspdf]')){
    var jp=document.createElement('script');
    jp.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    jp.async=false;
    jp.setAttribute('data-contracting-jspdf','1');
    jp.onload=function(){
      if(!(window.jspdf && window.jspdf.jsPDF)) console.error('Contracting PDF: jsPDF global was not created');
      loadDeliveryHelper();
    };
    jp.onerror=function(){
      console.error('Contracting PDF: failed to preload jsPDF');
      loadDeliveryHelper();
    };
    document.head.appendChild(jp);
  }else{
    var tries=0,t=setInterval(function(){
      tries++;
      if(window.jspdf && window.jspdf.jsPDF){clearInterval(t);loadDeliveryHelper();}
      else if(tries>=50){clearInterval(t);loadDeliveryHelper();}
    },100);
  }

  /* html2canvas must be able to paint the saved-version clone. It lives far
     outside the viewport, so keeping it renderable does not make it visible. */
  if(!document.getElementById('contracting-offscreen-pdf-style')){
    var st=document.createElement('style');
    st.id='contracting-offscreen-pdf-style';
    st.textContent='body>div[style*="left:-200vw"]{visibility:visible!important}';
    document.head.appendChild(st);
  }
})();