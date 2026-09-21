/* Fixed Sono overlay. All lettering is rendered locally with the video fonts. */
(function () {
  'use strict';
  var base = new URL('../', document.currentScript.src);
  var fonts;
  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var image = new Image(); image.crossOrigin = 'anonymous';
      image.onload = function () { resolve(image); };
      image.onerror = function () { reject(new Error('تعذر تحميل الصورة.')); };
      image.src = url;
    });
  }
  function ready() {
    if (!fonts) fonts = Promise.all([
      new FontFace('SonoDesign', 'url(' + new URL('fonts/BigVesta-Bold.woff2', base) + ')', {weight:'700'}),
      new FontFace('SonoDesign', 'url(' + new URL('fonts/BigVesta-Regular.woff2', base) + ')', {weight:'400'}),
      new FontFace('SonoLatin', 'url(' + new URL('fonts/Hiragino-W6.woff2', base) + ')')
    ].map(function (f) { return f.load().then(function (loaded) { document.fonts.add(loaded); }); }));
    return fonts;
  }

  function number(value, fallback, min, max) {
    if (value === '' || value == null) return fallback;
    var n = Number(value); return Number.isFinite(n) ? Math.max(min,Math.min(max,n)) : fallback;
  }
  function family(value) { return /[\u0600-\u06ff]/.test(String(value || '')) ? 'SonoDesign, SonoLatin' : 'SonoLatin, SonoDesign'; }
  function measure(ctx, value, size, width, weight, leading) {
    var text = String(value || '').trim(); if (!text) return null;
    var fontFamily=family(text);ctx.font = weight + ' ' + size + 'px ' + fontFamily;
    var lines = [];
    text.split('\n').forEach(function(paragraph) {
      var line = '';
      paragraph.split(/\s+/).forEach(function(word) {
        if(ctx.measureText(word).width > width) throw new Error('حجم الخط أكبر من عرض المساحة. قلّل الحجم أو غيّر وضع العنوان.');
        var candidate = line ? line+' '+word : word;
        if(line && ctx.measureText(candidate).width > width) { lines.push(line); line=word; }
        else line=candidate;
      }); lines.push(line);
    });
    return {lines:lines,size:size,weight:weight,fontFamily:fontFamily,leading:leading,h:size*1.35+(lines.length-1)*size*leading};
  }
  function scenePrompt(prompt, data) {
    var instructions = {
      top:'Leave the upper middle area below the logo empty with a pale plain background for a heading. Place the main subject lower in the frame.',
      bottom:'Place the main subject naturally in the upper and middle image area. Keep the lower edge pale and uncluttered for a heading below the image.',
      right:'Leave the RIGHT half empty with a pale plain background for Arabic text. Place the person and all key details on the LEFT.',
      left:'Leave the LEFT half empty with a pale plain background for Arabic text. Place the person and all key details on the RIGHT.'
    };
    return String(prompt || '')+'\nComposition: '+(instructions[data.titlePosition]||instructions.bottom)+' Extend the photograph naturally to every edge, including the top. Keep only the small upper-left corner calm and light for a logo overlay; place faces and important details away from that corner. Do not add a blank horizontal header, white margin or separate top panel. Use a portrait frame with at least 300 additional pixels of lower body and background below the normal composition at final export scale. Do not crop at shoulders, elbows or torso. Reserve this lower extension for a gradual fade. No writing or logos.';
  }
  async function render(canvas, scene, data) {
    await ready();
    var overlay = await loadImage(new URL('design-templates/sono-white/overlay.png', base));
    canvas.width=1080; canvas.height=1350;
    var ctx=canvas.getContext('2d');
    ctx.fillStyle='#fff'; ctx.fillRect(0,0,1080,1350);
    var side = data.titlePosition==='left' || data.titlePosition==='right';
    var sceneX = data.titlePosition==='left' ? 550 : 0;
    var sceneWidth = side ? 530 : 1080;
    if(scene) {
      var sceneTop=0,height=1260-sceneTop,scale=Math.max(sceneWidth/scene.width,height/scene.height)*number(data.zoom,1,.5,3);
      var w=scene.width*scale,h=scene.height*scale;
      ctx.save();ctx.beginPath();ctx.rect(sceneX,sceneTop,sceneWidth,height);ctx.clip();
      ctx.drawImage(scene,sceneX+(sceneWidth-w)*number(data.x,50,0,100)/100,sceneTop+(height-h)*number(data.y,50,0,100)/100+number(data.imageOffsetY,0,-400,400),w,h);ctx.restore();
    }
    var fadeStart=number(data.fadeStartY,860,500,1000),fadeEnd=number(data.fadeEndY,1005,550,1120);
    if(fadeEnd<fadeStart+50)fadeEnd=Math.min(1120,fadeStart+50);
    var fade=ctx.createLinearGradient(0,fadeStart,0,fadeEnd);
    fade.addColorStop(0,'rgba(255,255,255,0)');fade.addColorStop(1,'rgba(255,255,255,1)');
    ctx.fillStyle=fade;ctx.fillRect(0,fadeStart,1080,1260-fadeStart);
    ctx.drawImage(overlay,0,0,1080,1350);
    ctx.direction='rtl';ctx.textAlign='center';ctx.textBaseline='middle';
    var presets={bottom:{x:540,y:883,w:960},top:{x:540,y:320,w:960},right:{x:775,y:390,w:450},left:{x:305,y:390,w:450}};
    var position=presets[data.titlePosition]?data.titlePosition:'bottom',p=presets[position];
    var title=measure(ctx,data.headline,number(data.headlineSize,83,20,180),p.w,700,1.12);
    var subtitle=measure(ctx,data.subtitle,number(data.subtitleSize,42,16,100),p.w,400,1.2);
    var titleY=p.y+number(data.headlineOffset,0,-600,600);
    var subtitleY=titleY+(title?title.h/2:0)+22+(subtitle?subtitle.h/2:0)+number(data.subtitleOffset,0,-600,600);
    if(data.textOrder==='subtitle_first' && title && subtitle) {
      // Keep the same text area while reversing the two blocks, including wrapped lines.
      var stackTop=titleY-title.h/2;
      subtitleY=stackTop+subtitle.h/2+number(data.subtitleOffset,0,-600,600);
      titleY=stackTop+subtitle.h+22+title.h/2;
    }
    var ctaSize=number(data.ctaSize,31*number(data.ctaScale,1,0.8,1.15),16,80);
    var cta=measure(ctx,data.cta,ctaSize,880,700,1.1);
    var ctaY=1088+number(data.ctaOffset,0,-900,60);
    if(cta && cta.lines.length>1) throw new Error('نص زر التفاعل طويل. قلّل حجم الخط أو اختصره.');
    var blocks=[];
    function block(layout,y,x,width) {
      if(!layout)return;
      if(y-layout.h/2<190 || y+layout.h/2>1160)throw new Error('النص خارج المساحة الآمنة. حرّكه بعيدًا عن اللوجو والفوتر أو قلّل حجمه.');
      blocks.push({top:y-layout.h/2,bottom:y+layout.h/2,left:x-width/2,right:x+width/2});
    }
    block(title,titleY,p.x,p.w);block(subtitle,subtitleY,p.x,p.w);
    var buttonWidth=0,buttonHeight=0;
    if(cta) {
      ctx.font='700 '+ctaSize+'px '+cta.fontFamily;
      buttonWidth=Math.max(220,ctx.measureText(cta.lines[0]).width+70);buttonHeight=cta.h+14;
      block({h:buttonHeight},ctaY,540,buttonWidth);
    }
    for(var i=0;i<blocks.length;i++)for(var j=i+1;j<blocks.length;j++){
      var a=blocks[i],b=blocks[j];
      if(a.left<b.right && a.right>b.left && a.top<b.bottom+8 && a.bottom+8>b.top)
        throw new Error('العناصر متداخلة. عدّل موضع السطر أو زر التفاعل.');
    }
    // Opaque quiet panel under text placed over the scene; fixed overlay remains unchanged.
    [title,subtitle].forEach(function(layout,index){
      if(!layout)return;var y=index?subtitleY:titleY;
      if(position==='bottom' && y-layout.h/2<fadeEnd) {
        // A moved bottom title needs contrast without a hard rectangular image edge.
        var quiet=ctx.createLinearGradient(0,y-layout.h/2-100,0,y+layout.h/2+100);
        quiet.addColorStop(0,'rgba(255,255,255,0)');quiet.addColorStop(.3,'rgba(255,255,255,.98)');
        quiet.addColorStop(.7,'rgba(255,255,255,.98)');quiet.addColorStop(1,'rgba(255,255,255,0)');
        ctx.save();ctx.beginPath();ctx.rect(0,160,1080,1000);ctx.clip();
        ctx.fillStyle=quiet;ctx.fillRect(0,y-layout.h/2-100,1080,layout.h+200);ctx.restore();
      } else if(position!=='bottom' && y-layout.h/2<905) {
        ctx.fillStyle='#fff';ctx.beginPath();
        ctx.roundRect(p.x-p.w/2-12,y-layout.h/2-10,p.w+24,layout.h+20,18);ctx.fill();
      }
    });
    function draw(layout,x,y,color,shadow) {
      if(!layout)return;ctx.font=layout.weight+' '+layout.size+'px '+layout.fontFamily;
      layout.lines.forEach(function(line,i){
        var baseline=y+(i-(layout.lines.length-1)/2)*layout.size*layout.leading;
        if(shadow){ctx.fillStyle='#00dedb';ctx.fillText(line,x+4,baseline+5);}
        ctx.fillStyle=color;ctx.fillText(line,x,baseline);
      });
    }
    draw(title,p.x,titleY,'#07599d',true);draw(subtitle,p.x,subtitleY,'#272727');
    if(cta){ctx.fillStyle='#ff541d';ctx.beginPath();ctx.roundRect(540-buttonWidth/2,ctaY-buttonHeight/2,buttonWidth,buttonHeight,buttonHeight/2);ctx.fill();draw(cta,540,ctaY,'#fff');}
    return canvas;
  }
  window.SSMPDDesignComposer={render:render,loadImage:loadImage,ready:ready,scenePrompt:scenePrompt};
})();
