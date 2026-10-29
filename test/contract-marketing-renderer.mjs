import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {renderContract} from '../scripts/contract-template-renderer.mjs';
const photo=await fs.readFile('assets/design-templates/sono-doctor/background.webp');
const output=await renderContract({kind:'doctor',name:'طبيب تجريبي',facts:{prefix:'الدكتور',title:'استشاري تجريبي',days:'السبت',time_from:'10:00',time_to:'14:00'}},photo,{doctor_brief:{name:'طبيب تجريبي'}});
assert.equal(output.bytes.subarray(1,4).toString(),'PNG');assert.equal(output.settings.width,1080);assert.equal(output.settings.height,1350);
await assert.rejects(()=>renderContract({kind:'entity'},photo,{}),e=>e.code==='TEMPLATE_NOT_READY');
await fs.writeFile('test/contract-marketing-doctor-preview.png',output.bytes);console.log('PASS: original doctor template rendered with actual fonts; entity template waiting gate.');
