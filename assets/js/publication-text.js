/* The same saved-text contract is used by browser previews and the Meta worker. */
(function(root){
 'use strict';
 function clean(value){return String(value==null?'':value).trim();}
 function normal(value){return clean(value).replace(/\s+/g,' ').toLowerCase();}
 function source(item){return clean(item.caption_text)?'caption_text':clean(item.body)?'body':'title';}
 function compose(item){
  item=item||{};
  var text=clean(item[source(item)]),cta=clean(item.cta_text);
  if(cta&&normal(text).indexOf(normal(cta))<0)text=text?text+'\n\n'+cta:cta;
  return text;
 }
 root.SSMPDPublicationText={compose:compose,source:source};
})(typeof window==='undefined'?globalThis:window);
