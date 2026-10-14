const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),http=require('http'),zlib=require('zlib');
const {chromium}=require('playwright');const root=path.resolve(__dirname,'..');
function png(w,h){const crc=(b)=>{let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}let x=0xffffffff;for(const v of b)x=t[(x^v)&255]^(x>>>8);return(x^0xffffffff)>>>0};
 const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const td=Buffer.concat([Buffer.from(type),data]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([len,td,c])};
 const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;const raw=Buffer.alloc((w*3+1)*h);for(let y=0;y<h;y++)for(let x=0;x<w*3;x++)raw[y*(w*3+1)+1+x]=(x*7+y*3)&255;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))])}
const big=png(1200,1200);let hits=0;
const html=`<!doctype html><meta charset="utf-8"><body><div id="r"></div><script>
window.SSMPDDesignFiles={path:function(u){return u.indexOf('/auth/cd/')===0?u.slice(9):null},resolve:async function(u){return u.indexOf('/auth/cd/')===0?'/img.png?t='+Math.random():u}};
</script><script src="/assets/js/media-thumbs.js"></script>`;
(async()=>{const s=http.createServer((q,r)=>{const u=q.url.split('?')[0];if(u==='/'){r.setHeader('content-type','text/html');return r.end(html)}if(u==='/img.png'){hits++;r.setHeader('content-type','image/png');return r.end(big)}const f=path.join(root,u);if(!fs.existsSync(f)){r.statusCode=404;return r.end()}r.setHeader('content-type','text/javascript');r.end(fs.readFileSync(f))}).listen(0);
const b=await chromium.launch({args:['--no-sandbox']});const ctx=await b.newContext();const url='http://localhost:'+s.address().port+'/';
let p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));await p.goto(url);
const r1=await p.evaluate(async()=>{const u=await SSMPDThumbs.get('/auth/cd/a/b/output.png');const i=new Image();i.src=u;await i.decode();return {u:u.slice(0,5),w:i.naturalWidth}});
assert.equal(r1.u,'blob:');assert(r1.w<=320,'downscaled to <=320px, got '+r1.w);assert.equal(hits,1,'first view downloads once');
// نفس الصفحة: من الذاكرة
await p.evaluate(()=>SSMPDThumbs.get('/auth/cd/a/b/output.png'));assert.equal(hits,1,'memo hit');
// فتح جديد (زي ريفريش): من Cache API من غير تحميل
await p.close();p=await ctx.newPage();await p.goto(url);
const r2=await p.evaluate(async()=>{const u=await SSMPDThumbs.get('/auth/cd/a/b/output.png');const i=new Image();i.src=u;await i.decode();return i.naturalWidth});
assert.equal(r2,r1.w);assert.equal(hits,1,'second visit served from device cache, zero downloads');
// ملف تاني = تحميل جديد
await p.evaluate(()=>SSMPDThumbs.get('/auth/cd/a/c/output.png'));assert.equal(hits,2);
// رابط مش تابع للتخزين يفضل زي ما هو
assert.equal(await p.evaluate(()=>SSMPDThumbs.get('https://drive.google.com/x')),'https://drive.google.com/x','non-storage urls pass through');
assert.deepEqual(errs,[]);await b.close();s.close();console.log('PASS: thumbnail downscaled to 320px, downloaded once per file, reused from memory and from device cache across page loads.')})().catch(e=>{console.error(e);process.exit(1)});
