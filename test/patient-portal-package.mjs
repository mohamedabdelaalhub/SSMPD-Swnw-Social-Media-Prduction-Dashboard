import {buildPortal} from '../scripts/build-patient-portal.mjs';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'portal-package-'));const source=path.join(temp,'source');
function put(file,text){fs.mkdirSync(path.dirname(path.join(source,file)),{recursive:true});fs.writeFileSync(path.join(source,file),text);}
const key=role=>'x.'+Buffer.from(JSON.stringify({role})).toString('base64url')+'.x';
put('config.js','window.SSMPD_CONFIG='+JSON.stringify({supabase:{url:'https://example.supabase.co',anonKey:key('anon')},privateSecret:'must-not-export'})+';');
put('patient-portal/index.html','<html><head><link href="styles.css"><script src="../config.js"></script><script src="app.js"></script></head></html>');
put('patient-portal/styles.css','');put('patient-portal/app.js','/* unchanged */');
for(const f of ['assets/js/nutrition-view.js','assets/css/nutrition.css','assets/img/logo.svg','assets/img/mark.svg','assets/fonts/test.woff2','deploy/patient-portal.web.config'])put(f,'fixture');
const output=path.join(temp,'output');buildPortal(source,output);
assert.match(fs.readFileSync(path.join(output,'index.html'),'utf8'),/<base href="\/patient-portal\/">/);
assert.equal(fs.readFileSync(path.join(output,'patient-portal/app.js'),'utf8'),'/* unchanged */');
assert.ok(!fs.readFileSync(path.join(output,'config.js'),'utf8').includes('must-not-export'));
assert.throws(()=>buildPortal(source,output),/must be new/);
put('config.js','window.SSMPD_CONFIG='+JSON.stringify({supabase:{url:'https://example.supabase.co',anonKey:key('service_role')}}));
assert.throws(()=>buildPortal(source,path.join(temp,'blocked')),/Only public/);
fs.rmSync(temp,{recursive:true,force:true});console.log('PASS portal package assets, base path, source preservation, public config and service-key rejection');
