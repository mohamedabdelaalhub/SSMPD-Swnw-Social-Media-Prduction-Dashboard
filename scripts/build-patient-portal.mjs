import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
export function buildPortal(source,output){
 source=path.resolve(source);output=path.resolve(output);
 if(output===source||source.startsWith(output+path.sep)||output.startsWith(path.join(source,'patient-portal')+path.sep))throw Error('Unsafe output path');
 if(fs.existsSync(output))throw Error('Output directory must be new');
 const context={window:{}};vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(source,'config.js'),'utf8'),context,{timeout:1000});
 const config=context.window.SSMPD_CONFIG?.supabase;
 if(!config?.url||!config?.anonKey||new URL(config.url).protocol!=='https:')throw Error('Missing public Supabase settings');
 if(!config.anonKey.startsWith('sb_publishable_')){
  let role;try{role=JSON.parse(Buffer.from(config.anonKey.split('.')[1],'base64url').toString()).role;}catch{}
  if(role!=='anon')throw Error('Only public anon/publishable keys can be packaged');
 }
 fs.mkdirSync(output,{recursive:true});
 fs.cpSync(path.join(source,'patient-portal'),path.join(output,'patient-portal'),{recursive:true});
 const assets=['assets/js/nutrition-view.js','assets/css/nutrition.css','assets/img/logo.svg','assets/img/mark.svg'];
 for(const entry of fs.readdirSync(path.join(source,'assets/fonts')))if(/\.(woff2?|ttf|otf)$/i.test(entry))assets.push('assets/fonts/'+entry);
 for(const asset of assets){fs.mkdirSync(path.dirname(path.join(output,asset)),{recursive:true});fs.copyFileSync(path.join(source,asset),path.join(output,asset));}
 const publicConfig={supabase:{url:config.url,anonKey:config.anonKey}};
 fs.writeFileSync(path.join(output,'config.js'),'window.SSMPD_CONFIG = '+JSON.stringify(publicConfig)+';\n');
 const original=fs.readFileSync(path.join(output,'patient-portal/index.html'),'utf8');
 fs.writeFileSync(path.join(output,'index.html'),original.replace('<head>','<head>\n  <base href="/patient-portal/">'));
 fs.copyFileSync(path.join(source,'deploy/patient-portal.web.config'),path.join(output,'web.config'));
 // Check local HTML assets from both entry points, including their base href.
 for(const entry of ['index.html','patient-portal/index.html']){
  const html=fs.readFileSync(path.join(output,entry),'utf8');const base=new URL(/<base href="([^"]+)"/.exec(html)?.[1]||entry,'https://portal.swnwclinics.com/');
  for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)){
   const url=new URL(match[1],base);if(url.origin!==base.origin||url.pathname.endsWith('/'))continue;
   if(!fs.existsSync(path.join(output,decodeURIComponent(url.pathname))))throw Error('Missing portal asset '+url.pathname);
  }
 }
 return output;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=buildPortal(process.argv[2]||'.',process.argv[3]||'dist/patient-portal');
 console.log('Patient portal package ready: '+result);
}
