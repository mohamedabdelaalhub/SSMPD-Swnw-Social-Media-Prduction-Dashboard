/* Swnw single post in the carousel-cover style (approved by Mohamed 2026-10-11):
   full photo, blue fade, big white title anchored above the CTA, orange CTA pill, Swnw fixed dark frame.
   Spacing rules: ≥40 px between subtitle and CTA, ≥50 px above the footer, no single word alone on a title line. */
(function(){
 'use strict';
 var base=new URL('../design-templates/sono-cover/',document.currentScript.src),framePromise=null;
 function num(v,f,min,max){var n=v===''||v==null?f:Number(v);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):f;}
 function wrap(ctx,value,width){
  var out=[];String(value||'').trim().split('\n').forEach(function(p){var line='',start=out.length;p.split(/\s+/).filter(Boolean).forEach(function(w){var next=line?line+' '+w:w;if(line&&ctx.measureText(next).width>width){out.push(line);line=w;}else line=next;});if(line)out.push(line);
   var k=out.length;if(k-start>=2&&line.indexOf(' ')<0){var prev=out[k-2].split(' ');if(prev.length>=3){var moved=prev.pop()+' '+line;if(ctx.measureText(moved).width<=width){out[k-2]=prev.join(' ');out[k-1]=moved;}}}});
  return out;
 }
 async function render(canvas,scene,data){
  await window.SSMPDDesignComposer.ready();
  if(!framePromise)framePromise=window.SSMPDDesignComposer.loadImage(new URL('frame_dark.webp',base)).catch(function(e){framePromise=null;throw e;});
  var frame=await framePromise,issues=[];
  canvas.width=1080;canvas.height=1350;var ctx=canvas.getContext('2d');
  ctx.fillStyle='#0F369D';ctx.fillRect(0,0,1080,1350);
  if(scene){var zoom=num(data.zoom,1,.5,3),scale=Math.max(1080/scene.width,1350/scene.height)*zoom,w=scene.width*scale,h=scene.height*scale;
   ctx.drawImage(scene,(1080-w)*num(data.x,50,0,100)/100+num(data.imageOffsetX,0,-1080,1080),(1350-h)*num(data.y,20,0,100)/100+num(data.imageOffsetY,0,-1350,1350),w,h);}
  var g=ctx.createLinearGradient(0,0,0,1350);g.addColorStop(0,'rgba(15,54,157,0.15)');g.addColorStop(.35,'rgba(15,54,157,0.35)');g.addColorStop(.66,'#0F369D');g.addColorStop(1,'#0a2a7c');ctx.fillStyle=g;ctx.fillRect(0,0,1080,1350);
  var family='SonoDesign, SonoLatin',right=1020,width=960,ctaTop=1088,ctaH=61;
  ctx.direction='rtl';ctx.textAlign='right';ctx.textBaseline='alphabetic';
  // CTA pill (right, under the title — Mohamed 2026-10-11), its top is the anchor of the whole text block.
  var cta=String(data.cta||'').trim();
  if(cta){ctx.font='700 32px '+family;var cw=ctx.measureText(cta).width+68;ctx.fillStyle='#F15A22';ctx.beginPath();ctx.roundRect(1020-cw,ctaTop,cw,ctaH,ctaH/2);ctx.fill();ctx.fillStyle='#fff';ctx.textAlign='center';ctx.fillText(cta,1020-cw/2,ctaTop+ctaH/2+11);ctx.textAlign='right';}
  var bottom=(cta?ctaTop:1165)-40;
  var sub=String(data.subtitle||'').trim();
  if(sub){var ss=num(data.subtitleSize,40,24,60);ctx.font='400 '+ss+'px '+family;var sl=wrap(ctx,sub,width).slice(0,2);ctx.fillStyle='#dbe6ff';for(var i=sl.length-1;i>=0;i--){ctx.fillText(sl[i],right,bottom-ss*0.25);bottom-=ss*1.3;}bottom-=14;}
  var head=String(data.headline||'').trim();
  if(head){var hs=num(data.headlineSize,92,48,120),hl;do{ctx.font='700 '+hs+'px '+family;hl=wrap(ctx,head,width);if(hl.length<=3)break;hs-=4;}while(hs>56);
   if(hl.length>3)issues.push('العنوان طويل — قصّره لثلاث سطور.');
   var lead=hs*1.24,color='#fff';if(data.headlineFill&&data.headlineFill!=='auto')color=window.SSMPDDesignPanelColor.fill(ctx,data,{x:60,y:bottom-lead*hl.length,w:width,h:lead*hl.length},'headline');
   ctx.fillStyle=color;for(var j=hl.length-1;j>=0;j--){ctx.fillText(hl[j],right,bottom-hs*0.22);bottom-=lead;}
   if(bottom<230)issues.push('النص طالع فوق قوي — قصّر العنوان أو السطر التوضيحي.');}
  ctx.drawImage(frame,0,0,1080,1350);
  canvas.designWarnings=issues;canvas.designIssues=[];return canvas;
 }
 window.SSMPDCoverTemplate={render:render};
})();
