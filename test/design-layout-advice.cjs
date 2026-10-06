const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict'),path=require('path');
const draws=[];
const ctx={font:'',measureText(text){return{width:String(text).length*Number(this.font.match(/(\d+)px/)[1])*.55};},fillText(text,x,y){draws.push({text,x,y,font:this.font});},fillRect(){},drawImage(){},save(){},restore(){},beginPath(){},rect(){},clip(){},roundRect(){},fill(){},createLinearGradient(){return{addColorStop(){}};}};
const window={},context={window,URL,document:{currentScript:{src:'https://fixture.test/assets/js/design-composer.js'},fonts:{add(){}}},FontFace:class{load(){return Promise.resolve(this);}},Image:class{set src(value){queueMicrotask(()=>this.onload());}}};
vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../assets/js/design-composer.js'),'utf8'),context);
(async()=>{
 const canvas={getContext:()=>ctx},scene={width:1080,height:1350};
 const data={headline:'تغيير الجو',subtitle:'مش هو السبب المباشر',headlineSize:120,titlePosition:'bottom',headlineOffset:300,subtitleOffset:-90};
 await window.SSMPDDesignComposer.render(canvas,scene,data);
 assert.equal(canvas.designIssues.length,0);assert.ok(canvas.designWarnings.length>0);assert.ok(draws.some(x=>x.text===data.headline&&x.font.includes('120px')));
 await window.SSMPDDesignComposer.render(canvas,scene,{headline:'كلمةطويلةجداًبدونمسافات'.repeat(4),headlineSize:180,textWidth:300},{preview:true});assert.equal(canvas.designIssues.length,0);assert.ok(canvas.designWarnings.some(x=>/أعرض/.test(x)));
 draws.length=0;await window.SSMPDDesignComposer.render(canvas,scene,{headline:'تغيير الجو مش هو السبب المباشر',headlineSize:100,textWidth:300});let narrow=draws.filter(x=>x.font.includes('700 100px')).length;
 draws.length=0;await window.SSMPDDesignComposer.render(canvas,scene,{headline:'تغيير الجو مش هو السبب المباشر',headlineSize:100,textWidth:1000});let wide=draws.filter(x=>x.font.includes('700 100px')).length;assert.ok(wide<narrow);
 console.log('Position/overlap advice does not block export; chosen size remains unchanged; width controls wrapping; whole long words remain editable.');
})().catch(e=>{console.error(e);process.exitCode=1;});
