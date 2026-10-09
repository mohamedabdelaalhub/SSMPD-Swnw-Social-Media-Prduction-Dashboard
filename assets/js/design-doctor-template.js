/* User's InDesign template, page 1. Coordinates use its 1080 x 1350 page. */
(function(){
 'use strict';
 var base=new URL('../design-templates/sono-doctor/',document.currentScript.src),assets,backgrounds={};
 function ready(){
  if(!assets)assets=Promise.all([
   window.SSMPDDesignComposer.loadImage(new URL('background.webp',base)),
   ...[['DoctorArabic','regular.woff2','400'],['DoctorArabic','bold.woff2','700'],['DoctorLatin','latin.woff2','700']].map(function(row){return new FontFace(row[0],'url('+new URL(row[1],base)+')',{weight:row[2]}).load().then(function(font){document.fonts.add(font);});})
  ]).catch(function(error){assets=null;throw error;});return assets;
 }
 function num(value,fallback,min,max){var n=value===''||value==null?fallback:Number(value);return Number.isFinite(n)?Math.max(min,Math.min(max,n)):fallback;}
 function text(value){return String(value||'').trim();}
 function lines(ctx,value,size,width,weight){
  ctx.font=weight+' '+size+'px DoctorArabic';var result=[];
  value.split('\n').forEach(function(paragraph){var line='';paragraph.split(/\s+/).forEach(function(word){var next=line?line+' '+word:word;if(line&&ctx.measureText(next).width>width){result.push(line);line=word;}else line=next;});result.push(line);});return result;
 }
 function drawText(ctx,value,x,y,width,height,size,weight,color,maxLines){
  if(!value)return;var rows,ascent,descent,spacing,total;
  do{rows=lines(ctx,value,size,width,weight);var metrics=rows.map(function(line){return ctx.measureText(line);});ascent=Math.max(...metrics.map(function(m){return m.actualBoundingBoxAscent;}));descent=Math.max(...metrics.map(function(m){return m.actualBoundingBoxDescent;}));spacing=Math.max(size*1.22,ascent+descent+6);total=ascent+descent+(rows.length-1)*spacing;if(rows.length<=maxLines&&total<=height&&metrics.every(function(m){return m.width<=width;}))break;size-=1;}while(size>10);
  ctx.save();ctx.beginPath();ctx.rect(x-width/2,y-height/2,width,height);ctx.clip();ctx.direction='rtl';ctx.textAlign='center';ctx.textBaseline='alphabetic';ctx.fillStyle=color;
  rows.forEach(function(line,i){ctx.fillText(line,x,y-total/2+ascent+i*spacing);});ctx.restore();
 }
 function time(value){var match=/^(\d{2}):(\d{2})$/.exec(text(value));if(!match||Number(match[1])>23||Number(match[2])>59)return null;var hour=Number(match[1]);return {value:String(hour%12||12).padStart(2,'0')+':'+match[2],period:hour<12?'صباحًا':'مساءً'};}
 async function render(canvas,photo,data){
  var rows=[{days:data.doctorDays,time_from:data.doctorTimeFrom,time_to:data.doctorTimeTo}].concat(JSON.parse(data.doctorScheduleExtra||'[]')),mode=data.doctorScheduleMode;
  if(mode&&mode!=='different')rows=rows.slice(0,1);var model=window.SSMPDDoctorSchedule.normalise(rows,mode,mode==='except'?data.doctorDays:null),variant=model.variant;
  if(!backgrounds[variant])backgrounds[variant]=window.SSMPDDesignComposer.loadImage(new URL('variants/'+variant+'.webp',base)).catch(function(e){delete backgrounds[variant];throw e;});
  var loaded=await ready(),bg=await backgrounds[variant];canvas.width=1080;canvas.height=1350;var ctx=canvas.getContext('2d');ctx.drawImage(bg,0,0,1080,1350);
  var issues=[],name=text(data.doctorName),title=text(data.doctorTitle),days=text(data.doctorDays),start=time(data.doctorTimeFrom),end=time(data.doctorTimeTo);
  if(!name)issues.push('اكتب اسم الدكتور.');if(!title)issues.push('اكتب التايتل والتخصص.');
  if(photo){
   var x=797.7,y=602.66,r=193,scale=Math.max(r*2/photo.width,r*2/photo.height)*num(data.doctorZoom,1,1,3),w=photo.width*scale,h=photo.height*scale;
   ctx.save();ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.clip();ctx.drawImage(photo,x-w/2+(w-r*2)/2*num(data.doctorPhotoX,0,-100,100)/100,y-h/2+(h-r*2)/2*num(data.doctorPhotoY,0,-100,100)/100,w,h);ctx.restore();
   // Restore the foreground orange dot from the supplied background.
   ctx.save();ctx.beginPath();ctx.arc(691.05,777.55,26,0,Math.PI*2);ctx.clip();ctx.drawImage(bg,0,0,1080,1350);ctx.restore();
  }
  drawText(ctx,data.doctorPrefix==='الدكتورة'?'الدكتورة':'الدكتور',317.11,437.5,390,80,61.4,400,'#fff',1);
  drawText(ctx,name,317.11,602,472,245,num(data.doctorNameSize,97,24,110),700,'#fff',2);
  drawText(ctx,title,388.23,798.77,517,55,num(data.doctorTitleSize,32.56,16,42),400,'#fff',2);
  issues=issues.concat(model.issues);canvas.doctorVariant=variant;
  var map=window.SSMPDDoctorTemplateMap[String(variant)]||[],frames=map.filter(function(f){return f.text!=='__pill'&&f.text!=='__line';});
  map.filter(function(f){return f.text==='__pill'&&f.box[3]-f.box[1]<100;}).forEach(function(f){var b=f.box;ctx.fillStyle='#fff';ctx.beginPath();ctx.roundRect(b[0],b[1],b[2]-b[0],b[3]-b[1],(b[3]-b[1])/2);ctx.fill();});
  ctx.save();ctx.lineCap='butt';
  map.filter(function(f){return f.text==='__line';}).forEach(function(f){ctx.strokeStyle=f.color;ctx.lineWidth=f.weight;ctx.beginPath();f.points.forEach(function(p,i){if(i)ctx.lineTo(p[0],p[1]);else ctx.moveTo(p[0],p[1]);});ctx.stroke();});
  ctx.restore();
  var slot=-1;
  frames.forEach(function(f){var value=f.text,isClock=/^\d{2}:\d{2}$/.test(value),isDay=!isClock&&!['من كل أسبوع','من الساعة','وحتى الساعة'].includes(value)&&!value.includes('مسـ');
   if(isDay)slot++;var appointment=model.rows[variant<5?0:slot]||{},a=time(appointment.time_from),z=time(appointment.time_to),b=f.box,w=b[2]-b[0],h=b[3]-b[1],x=(b[0]+b[2])/2,y=(b[1]+b[3])/2,color='#fff',weight=400;
   if(isDay){value=variant===4?(model.excluded.length?'كل أيام الأسبوع ما عدا\n'+model.excluded.join(' - '):'كل أيام الأسبوع'):variant<5?model.days.join(' - '):appointment.days||'';color='#0c3b9d';weight=700;}
   else if(value==='05:30')value=a?a.value:'';else if(value==='12:00')value=z?z.value:'';else if(value.includes('مسـ')){var previous=frames[frames.indexOf(f)-1];value=previous&&previous.text==='من الساعة'?(a?a.period:''):(z?z.period:'');color='#c1cce5';}else if(value!=='من كل أسبوع')color='#c1cce5';
   if(isClock){ctx.save();ctx.direction='ltr';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='700 '+f.size+'px DoctorLatin';ctx.fillStyle='#fff';ctx.fillText(value,x,y);ctx.restore();}
   else drawText(ctx,value,x,y,w+4,Math.max(h+8,f.size*1.4),f.size,weight,color,variant===4&&isDay?2:1);
  });
  canvas.designIssues=issues;canvas.designWarnings=[];return canvas;
 }
 window.SSMPDDoctorTemplate={render:render};
})();
