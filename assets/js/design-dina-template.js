/* User's twelve InDesign layouts, with original clean assets and Tajawal. */
(function(){
 'use strict';
 var base=new URL('../',document.currentScript.src),readyPromise,images={};
 function ready(){return readyPromise||(readyPromise=Promise.all([400,500,700,900].map(function(w,i){return new FontFace('DinaDesign','url('+new URL('fonts/Tajawal-'+['Regular','Medium','Bold','Black'][i]+'.ttf',base)+')',{weight:String(w)}).load().then(function(f){document.fonts.add(f);});}).concat([new FontFace('DinaContact','url('+new URL('fonts/Hiragino-W6.woff2',base)+')').load().then(function(f){document.fonts.add(f);})])).then(function(){return fetch(new URL('design-templates/dr-dina/frames.json',base)).then(function(r){if(!r.ok)throw Error('تعذر تحميل القوالب');return r.json();});}).catch(function(e){readyPromise=null;throw e;}));}
 function n(v,d){return v===''||v==null||!Number.isFinite(Number(v))?d:Number(v);}
 function defaults(v){return {headlineSize:v<=4?54:v===5?36:v===8?102:v===9?162:v>=10?97:124,subtitleSize:v<=5?34:v===8?122:v===9?86:v>=10?50:100,ctaSize:35,designBodySize:v<=2?39:v===5?33:34};}
 function shape(c,s){var p=s.points;c.beginPath();c.moveTo.apply(c,p[0].Anchor);p.forEach(function(a,i){var b=p[(i+1)%p.length];c.bezierCurveTo.apply(c,a.RightDirection.concat(b.LeftDirection,b.Anchor));});c.closePath();}
 function lines(c,text,width){var result=[];String(text||'').trim().split('\n').forEach(function(p){var line='';p.split(/\s+/).filter(Boolean).forEach(function(w){var next=line?line+' '+w:w;if(line&&c.measureText(next).width>width){result.push(line);line=w;}else line=next;});if(line)result.push(line);});return result;}
 function text(c,value,box,size,weight,color,center,fixedSize){if(!String(value||'').trim())return 0;var rows;size=Math.max(12,Math.min(180,size));do{c.font=weight+' '+size+'px DinaDesign';rows=lines(c,value,box[2]);if(fixedSize||rows.length*size*1.08<=box[3]&&rows.every(function(t){return c.measureText(t).width<=box[2];}))break;size-=1;}while(size>12);c.fillStyle=color;c.textAlign='center';c.textBaseline=center?'alphabetic':'top';c.direction='rtl';var y=box[1];if(center){var metrics=rows.map(function(t){return c.measureText(t);}),above=Math.max.apply(null,metrics.map(function(m){return m.actualBoundingBoxAscent;})),below=Math.max.apply(null,metrics.map(function(m){return m.actualBoundingBoxDescent;}));y+=(box[3]-(above+below+(rows.length-1)*size*1.08))/2+above;}rows.forEach(function(t,i){c.fillText(t,box[0]+box[2]/2,y+i*size*1.08);});return rows.length*size*1.08;}
 function contact(c,v){
  c.save();c.fillStyle='#fff';c.fillRect(346,1291,195,34);
  c.fillStyle=v===3||v===4?'#fd0000':'#e50046';c.beginPath();c.arc(361,1306,13,0,Math.PI*2);c.fill();
  c.strokeStyle='#fff';c.lineWidth=1.6;c.beginPath();c.arc(361,1305,8,0.6,Math.PI*2.17);c.stroke();c.beginPath();c.moveTo(355,1311);c.lineTo(352.5,1315);c.lineTo(358,1313);c.stroke();
  c.lineWidth=2.7;c.lineCap='round';c.beginPath();c.moveTo(357.8,1301.8);c.quadraticCurveTo(357,1308,364,1309);c.stroke();c.lineWidth=2;c.beginPath();c.moveTo(358,1301.8);c.lineTo(359,1303.3);c.moveTo(362.5,1308);c.lineTo(364.5,1308.7);c.stroke();
  c.fillStyle='#111';c.font='19.23px DinaContact';c.textAlign='center';c.textBaseline='middle';c.direction='ltr';c.fillText('01010686264',461.6,1307);c.restore();
 }
 async function render(canvas,scene,d){var frames=await ready(),v=Math.max(1,Math.min(12,Math.round(n(d.dinaVariant,1)))),entry=frames[v-1],def=defaults(v);if(!images[v])images[v]=window.SSMPDDesignComposer.loadImage(new URL('design-templates/dr-dina/'+v+'.webp?v=2',base));var overlay=await images[v];canvas.width=1080;canvas.height=1350;canvas.designIssues=[];canvas.designWarnings=[];var c=canvas.getContext('2d');c.fillStyle='#fff';c.fillRect(0,0,1080,1350);
  if(scene&&v!==5){var box=entry.scene?entry.scene.box:[0,0,1080,1350];c.save();if(entry.scene){shape(c,entry.scene);c.clip();}var pad=n(d.scenePaddingScale,1),zoom=n(d.zoom,1);var scale=Math.max(box[2]/scene.width,box[3]/scene.height)*(pad>1?Math.max(1/pad,zoom)*pad:zoom);c.drawImage(scene,box[0]+(box[2]-scene.width*scale)*Math.max(0,Math.min(100,n(d.x,50)))/100,box[1]+(box[3]-scene.height*scale)/2+n(d.imageOffsetY,0),scene.width*scale,scene.height*scale);c.restore();}
  // Template-owned colour treatments precede the immutable logo and contact artwork.
  if(v===7||v>=10){var top=v===7,start=top?0:820,end=top?490:1280,col=v===7?'#bf7526':v===10?'#101010':v===11?'#f6edd6':'#6e225b';var g=c.createLinearGradient(0,start,0,end);g.addColorStop(0,top?col:col+'00');g.addColorStop(1,top?col+'00':col);c.fillStyle=g;c.fillRect(0,start,1080,end-start);}
  if(v>=6)window.SSMPDDesignPanelColor.edges(c,d);
  c.drawImage(overlay,0,0,1080,1350);
  if(v===5&&scene){var slot=entry.scene.box;c.save();c.beginPath();c.rect(40,220,430,410);c.clip();var fit=Math.min(slot[2]/scene.width,slot[3]/scene.height)*n(d.zoom,1);c.drawImage(scene,slot[0]+(slot[2]-scene.width*fit)*Math.max(0,Math.min(100,n(d.x,50)))/100,slot[1]+(slot[3]-scene.height*fit)/2+n(d.imageOffsetY,0),scene.width*fit,scene.height*fit);c.restore();}
  if(v>=3)contact(c,v);
  var h,s,a,b,color=v===5||v===10||v===11?'#fd0000':v===9?'#ec9f03':v>=6?'#fff':'#111';
  if(v<=5){h=v<=2?[90,595,382,83]:v<=4?[90,640,395,74]:[102,670,372,93];s=[h[0],h[1]+h[3]+12,h[2],65];b=v<=2?[50,800,402,290]:v<=4?[58,790,430,170]:[102,850,372,110];a=[h[0],v===5?995:1090,h[2],48];if(!d.subtitle){b[1]=v<=2?706:v<=4?721:790;b[3]=v<=2?388:v<=4?200:111;}}
  else if(v<=7){h=[171,v===6?188:181,730,160];s=[171,350,730,130];a=[350,1080,380,58];}
  else if(v===8){h=[370,195,340,115];s=[210,325,650,125];a=[350,1080,380,58];c.fillStyle='#e50026';c.fillRect(345,180,390,135);c.fillStyle='#fff';c.fillRect(185,d.secondaryHeadline?430:320,700,135);}
  else if(v===9){h=[628,383,392,170];s=[625,592,398,190];a=[669,825,301,55];}
  else{h=[104,1047,893,130];s=[303,931,495,65];a=[350,1175,380,52];c.fillStyle=v===12?'#f6edd6':'#111';c.beginPath();c.roundRect(280,915,540,88,32);c.fill();}
  var secondary=null;if(String(d.secondaryHeadline||'').trim()){if(v<=5){secondary=[s[0],s[1],s[2],60];s[1]+=72;if(b){b[1]+=72;b[3]=Math.max(40,Math.min(b[3],a[1]-b[1]-15));}}else if(v<=8){secondary=[s[0],s[1],s[2],100];s[1]+=110;}else if(v===9){secondary=[625,570,398,100];s[1]+=120;a[1]+=120;}else secondary=[104,825,893,80];secondary[1]+=n(d.secondaryHeadlineOffset,0);}
  h[1]+=n(d.headlineOffset,0);s[1]+=n(d.subtitleOffset,0);a[1]+=n(d.ctaOffset,0);
  var custom=d.headlineFill&&d.headlineFill!=='auto';text(c,d.headline,h,n(d.headlineSize,def.headlineSize),v>=10||v<=7&&v>=6?900:700,custom?window.SSMPDDesignPanelColor.fill(c,d,{x:h[0],y:h[1],w:h[2],h:h[3]},'headline'):color);text(c,d.subtitle,s,n(d.subtitleSize,def.subtitleSize),v<=5?500:700,v===8?'#111':v===12?'#6e225b':v>=6?'#fff':'#111',false,true);if(secondary){var secondaryColor=v>=6?'#fff':'#111';if(d.secondaryHeadlineFill&&d.secondaryHeadlineFill!=='auto')secondaryColor=window.SSMPDDesignPanelColor.fill(c,d,{x:secondary[0],y:secondary[1],w:secondary[2],h:secondary[3]},'secondaryHeadline');text(c,d.secondaryHeadline,secondary,n(d.secondaryHeadlineSize,42),700,secondaryColor);}if(b)text(c,d.designBody,b,n(d.designBodySize,def.designBodySize),500,'#111');if(d.cta){c.fillStyle=v===12?'#f6edd6':'#e50026';c.beginPath();c.roundRect(a[0]-12,a[1]-5,a[2]+24,a[3]+10,20);c.fill();text(c,d.cta,a,n(d.ctaSize,def.ctaSize),500,v===12?'#6e225b':'#fff',true);}
  return canvas;
 }
 window.SSMPDDinaTemplate={render:render,defaults:defaults};
})();
