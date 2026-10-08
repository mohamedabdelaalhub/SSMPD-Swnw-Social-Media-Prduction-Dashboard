/* Shared browser and publisher contract. Contact values match the approved content-agent brief. */
(function(root){
 'use strict';
 function clean(value){return String(value==null?'':value).trim();}
 function normal(value){return clean(value).replace(/\s+/g,' ').toLowerCase();}
 function source(item){return clean(item.caption_text)?'caption_text':clean(item.body)?'body':'title';}
 function compose(item){
  item=item||{};
  var text=clean(item[source(item)]),cta=clean(item.cta_text),hook=clean(item.hook_text);
  if(hook&&normal(text).indexOf(normal(hook))<0)text=hook+(text?'\n\n'+text:'');
  if(cta&&normal(text).indexOf(normal(cta))<0)text=text?text+'\n\n'+cta:cta;
  if(item.brand==='sono'||item.brand==='dr_dina'){
   var contact=[];
   if(!/45\s*ع?[\s\S]{0,100}الخزان/.test(text)||!text.includes('الأهرام'))contact.push('العنوان: الجيزة، حدائق الأهرام، 45ع شارع الخزان.');
   if(!text.replace(/[\s()-]/g,'').includes('0236230005'))contact.push('التليفون: 0236230005');
   if(!text.includes('https://wa.me/201010686264'))contact.push('واتساب: https://wa.me/201010686264');
   if(contact.length)text+=(text?'\n\n':'')+contact.join('\n');
  }
  return text;
 }
 root.SSMPDPublicationText={compose:compose,source:source};
})(typeof window==='undefined'?globalThis:window);
