/* User's InDesign template, page 1. Coordinates use its 1080 x 1350 page. */
(function(){
 'use strict';
 var base=new URL('../design-templates/sono-doctor/',document.currentScript.src),assets;
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
  var loaded=await ready(),bg=loaded[0];canvas.width=1080;canvas.height=1350;var ctx=canvas.getContext('2d');ctx.drawImage(bg,0,0,1080,1350);
  var issues=[],name=text(data.doctorName),title=text(data.doctorTitle),days=text(data.doctorDays),start=time(data.doctorTimeFrom),end=time(data.doctorTimeTo);
  if(!name)issues.push('اكتب اسم الدكتور.');if(!title)issues.push('اكتب التايتل والتخصص.');
  if(photo){
   var x=797.7,y=602.66,r=193,scale=Math.max(r*2/photo.width,r*2/photo.height)*num(data.doctorZoom,1,1,3),w=photo.width*scale,h=photo.height*scale;
   ctx.save();ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.clip();ctx.drawImage(photo,x-w/2+(w-r*2)/2*num(data.doctorPhotoX,0,-100,100)/100,y-h/2+(h-r*2)/2*num(data.doctorPhotoY,0,-100,100)/100,w,h);ctx.restore();
   // Restore the foreground orange dot from the supplied background.
   ctx.save();ctx.beginPath();ctx.arc(691.05,777.55,26,0,Math.PI*2);ctx.clip();ctx.drawImage(bg,0,0,1080,1350);ctx.restore();
  }
  drawText(ctx,data.doctorPrefix==='الدكتورة'?'الدكتورة':'الدكتور',317.11,437.5,390,80,61.4,400,'#fff',1);
  drawText(ctx,name,317.11,602,472,245,num(data.doctorNameSize,97,24,110),400,'#fff',2);
  drawText(ctx,title,388.23,798.77,517,55,num(data.doctorTitleSize,32.56,16,42),400,'#fff',2);
  var schedules=[{days:days,time_from:data.doctorTimeFrom,time_to:data.doctorTimeTo}].concat(JSON.parse(data.doctorScheduleExtra||'[]')).filter(function(r){return r.days||r.time_from||r.time_to;});
  if(!schedules.length)issues.push('حدد أيام العمل وموعد البداية والنهاية.');
  if(schedules.length){days=schedules[0].days;start=time(schedules[0].time_from);end=time(schedules[0].time_to);}
  if(schedules.some(function(r){return !r.days||!time(r.time_from)||!time(r.time_to);}))issues.push('أكمل كل المواعيد.');
  if(schedules.length>4)issues.push('مساحة القالب تتسع لأربعة مواعيد مختلفة. اجمع الأيام التي لها نفس الساعات.');
  var shared=schedules.every(function(r){return r.time_from===schedules[0].time_from&&r.time_to===schedules[0].time_to;});
  if(shared)days=schedules.map(function(r){return r.days;}).join(' - ');
  if(!shared){schedules.forEach(function(r,i){var a=time(r.time_from),b=time(r.time_to);drawText(ctx,r.days,710,968+i*29,220,28,23,700,'#fff',1);drawText(ctx,a&&b?a.value+' '+a.period+' — '+b.value+' '+b.period:'أكمل الموعد',405,968+i*29,340,28,21,400,'#fff',1);});}else{
  ctx.fillStyle='#fff';ctx.beginPath();ctx.roundRect(598,972,218,33,17);ctx.fill();
  drawText(ctx,days,707.18,988,208,30,23.85,700,'#0c3b9d',1);
  drawText(ctx,'من كل أسبوع',707.18,1037,205,48,27,400,'#fff',1);
  ctx.strokeStyle='rgba(255,255,255,.5)';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(560,974);ctx.lineTo(560,1051);ctx.stroke();
  [[start,468.35,'من الساعة'],[end,319.61,'وحتى الساعة']].forEach(function(row){
   drawText(ctx,row[2],row[1],973,120,30,18,400,'#c1cce5',1);
   if(row[0]){ctx.save();ctx.direction='ltr';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='700 32.94px DoctorLatin';ctx.fillStyle='#fff';ctx.fillText(row[0].value,row[1],1016);ctx.restore();drawText(ctx,row[0].period,row[1],1044,110,27,18,400,'#c1cce5',1);}
  });
  }
  canvas.designIssues=issues;canvas.designWarnings=[];return canvas;
 }
 window.SSMPDDoctorTemplate={render:render};
})();
