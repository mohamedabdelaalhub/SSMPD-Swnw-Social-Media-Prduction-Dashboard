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

  /* html2canvas clones the whole document into an iframe for every render.
     On some mobile browsers the second saved A4 page is no longer found in
     that internal clone. Render a fresh attached copy of each contracting page
     instead, while leaving every other html2canvas call in the dashboard alone. */
  function installContractingHtml2CanvasGuard(){
    var base=window.html2canvas;
    if(typeof base!=='function' || base.__ssmpdContractingSafe) return;
    var wrapped=function(element,options){
      var isPage=!!(element && element.classList && element.classList.contains('swnw-page'));
      if(!isPage) return base(element,options);

      var stage=document.createElement('div');
      stage.setAttribute('data-contracting-render-stage','1');
      stage.style.cssText='position:fixed;left:0;top:0;width:210mm;min-height:297mm;transform:translateX(-120vw);pointer-events:none;z-index:-2147483647;background:#fff;overflow:visible;';

      var sourceDoc=element.closest && element.closest('#ceh-document');
      var shell=sourceDoc ? sourceDoc.cloneNode(false) : document.createElement('div');
      if(!shell.id) shell.id='ceh-document';
      var page=element.cloneNode(true);
      shell.appendChild(page);
      stage.appendChild(shell);
      document.body.appendChild(stage);

      var opts=Object.assign({},options||{}, {scrollX:0,scrollY:0,removeContainer:true});
      return Promise.resolve(base(page,opts)).finally(function(){stage.remove();});
    };
    wrapped.__ssmpdContractingSafe=true;
    wrapped.__ssmpdBase=base;
    window.html2canvas=wrapped;
  }

  function ensureHtml2Canvas(next){
    if(typeof window.html2canvas==='function'){
      installContractingHtml2CanvasGuard();
      next();
      return;
    }
    var existing=document.querySelector('script[data-contracting-html2canvas]');
    if(!existing){
      var hc=document.createElement('script');
      hc.src='https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      hc.async=false;
      hc.setAttribute('data-contracting-html2canvas','1');
      hc.onload=function(){installContractingHtml2CanvasGuard();next();};
      hc.onerror=function(){console.error('Contracting PDF: failed to preload html2canvas');next();};
      document.head.appendChild(hc);
      return;
    }
    var tries=0,t=setInterval(function(){
      tries++;
      if(typeof window.html2canvas==='function'){
        clearInterval(t);
        installContractingHtml2CanvasGuard();
        next();
      }else if(tries>=50){
        clearInterval(t);
        next();
      }
    },100);
  }

  /* The html2pdf bundle does not expose window.jspdf consistently on mobile.
     Preload standalone jsPDF, then preload the guarded html2canvas renderer,
     and only after both attach the delivery helper. */
  function loadDeliveryHelper(){
    if(document.querySelector('script[data-contracting-document-send]')) return;
    var s=document.createElement('script');
    s.src='assets/js/contracting-document-send.js?v=contracting-send-pdf-20261021-6';
    s.async=false;
    s.setAttribute('data-contracting-document-send','1');
    document.head.appendChild(s);
  }
  function readyForDelivery(){ensureHtml2Canvas(loadDeliveryHelper);}

  if(window.jspdf && window.jspdf.jsPDF){
    readyForDelivery();
  }else if(!document.querySelector('script[data-contracting-jspdf]')){
    var jp=document.createElement('script');
    jp.src='https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
    jp.async=false;
    jp.setAttribute('data-contracting-jspdf','1');
    jp.onload=function(){
      if(!(window.jspdf && window.jspdf.jsPDF)) console.error('Contracting PDF: jsPDF global was not created');
      readyForDelivery();
    };
    jp.onerror=function(){
      console.error('Contracting PDF: failed to preload jsPDF');
      readyForDelivery();
    };
    document.head.appendChild(jp);
  }else{
    var jsPdfTries=0,jt=setInterval(function(){
      jsPdfTries++;
      if(window.jspdf && window.jspdf.jsPDF){clearInterval(jt);readyForDelivery();}
      else if(jsPdfTries>=50){clearInterval(jt);readyForDelivery();}
    },100);
  }

  /* Keep legacy offscreen saved-document hosts renderable without exposing them. */
  if(!document.getElementById('contracting-offscreen-pdf-style')){
    var st=document.createElement('style');
    st.id='contracting-offscreen-pdf-style';
    st.textContent='body>div[style*="left:-200vw"]{visibility:visible!important}';
    document.head.appendChild(st);
  }
})();
