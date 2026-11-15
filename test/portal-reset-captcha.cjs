// The portal password-reset request must carry the browser's Turnstile token end-to-end,
// so enabling GoTrue CAPTCHA keeps this public endpoint gated instead of breaking it.
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const app=fs.readFileSync(path.join(root,'patient-portal/app.js'),'utf8');
const fn=fs.readFileSync(path.join(root,'supabase/functions/patient-portal-self-service/index.ts'),'utf8');
assert.match(app,/SSMPDTurnstile\.token\(\)\.then\(function\(ct\)\{return invoke\("patient-portal-self-service",\{op:"request_password_reset",email:email,captcha_token:ct\}\)/);
const op=fn.slice(fn.indexOf('if (op === "request_password_reset")'));
assert.match(op,/const captchaToken = typeof body\.captcha_token === "string"/);
assert.match(op,/gotrue_meta_security: \{ captcha_token: captchaToken \}/);
assert.doesNotMatch(op.slice(0,op.indexOf('/auth/v1/recover')+400),/Authorization: "Bearer " \+ SERVICE_ROLE_KEY/,'must not bypass CAPTCHA with service role');
console.log('portal reset captcha forwarding: OK');
