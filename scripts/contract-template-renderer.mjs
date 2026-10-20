import fs from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createCanvas,loadImage,GlobalFonts} from '@napi-rs/canvas';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function renderContract(profile,photo,idea){
 if(profile.kind!=='doctor'){const error=new Error('قالب إعلان الجهات بانتظار الإضافة');error.code='TEMPLATE_NOT_READY';throw error;}
 const ctx={URL,console,window:{SSMPDDesignComposer:{loadImage:async u=>loadImage(await fs.readFile(fileURLToPath(u)))}}};
 ctx.FontFace=class {constructor(name,source){this.name=name;this.source=source;}async load(){const url=this.source.slice(4,-1);if(!GlobalFonts.registerFromPath(fileURLToPath(url),this.name))throw Error('تعذر تحميل خط قالب الطبيب');return this;}};
 ctx.document={currentScript:{src:pathToFileURL(path.join(root,'assets/js/design-doctor-template.js')).href},fonts:{add(){}}};
 vm.createContext(ctx);
 for(const f of ['assets/js/doctor-schedule.js','assets/js/doctor-template-map.js','assets/js/design-doctor-template.js'])vm.runInContext(await fs.readFile(path.join(root,f),'utf8'),ctx,{filename:f});
 const f=profile.facts,data={layoutTemplate:'sono_doctor',template:'sono-doctor-v1',doctorPrefix:f.prefix||'الدكتور',doctorName:idea.doctor_brief?.name||profile.name,doctorTitle:f.title,doctorDays:f.days,doctorTimeFrom:f.time_from,doctorTimeTo:f.time_to,doctorScheduleMode:'shared',doctorScheduleExtra:'[]'};
 const canvas=createCanvas(1080,1350);await ctx.window.SSMPDDoctorTemplate.render(canvas,await loadImage(photo),data);
 if(canvas.designIssues?.length)throw Error(canvas.designIssues.join(' '));
 return {bytes:canvas.toBuffer('image/png'),settings:{...data,width:1080,height:1350}};
}
