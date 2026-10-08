(function(root){
 'use strict';
 function safeReturnUrl(value){
  if(!value||!/^https:\/\//.test(value)||value.indexOf('\\')!==-1)return null;
  try{var u=new URL(value);if(u.username||u.password||['https://swnwclinics.com','https://staging.swnwclinics.com'].indexOf(u.origin)<0)return null;return u.href;}catch(e){return null;}
 }
 function parse(search){var q=new URLSearchParams(search);return {view:['login','activate','reset'].indexOf(q.get('view'))>=0?q.get('view'):null,recovery:q.get('reset')==='1',returnUrl:safeReturnUrl(q.get('returnUrl'))};}
 root.SSMPDPortalRouting={safeReturnUrl:safeReturnUrl,parse:parse};
})(typeof window==='undefined'?globalThis:window);
