// Offline opt-in packaging. Never changes the source tree; requires a NEW output directory.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
function build(source,output,previous){
 source=path.resolve(source);output=path.resolve(output);
 if(output===source||output.startsWith(source+path.sep)||source.startsWith(output+path.sep))throw Error('source/output must be separate');
 if(fs.existsSync(output))throw Error('output already exists');
 // Refuse symlinks rather than copy outside the reviewed source tree.
 function check(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isSymbolicLink())throw Error('symlink refused: '+p);if(e.isDirectory())check(p);}}
 check(source);fs.cpSync(source,output,{recursive:true});
 const manifest={schema:1,assets:[]};const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
 let html=fs.readFileSync(path.join(source,'index.html'),'utf8');
 html=html.replace(/<(script|link)\b[^>]*>/gi,tag=>tag.replace(/\b(src|href)="([^"]+)"/gi,(whole,attr,url)=>{
  if(!url.startsWith('assets/')||!/^assets\/[A-Za-z0-9_./-]+\.(js|css)(?:\?[^#]*)?$/.test(url))return whole;
  const rel=url.split('?')[0];if(rel.split('/').includes('..'))throw Error('unsafe asset path');
  const bytes=fs.readFileSync(path.join(source,rel)),digest=hash(bytes),ext=path.extname(rel),name=rel.slice(0,-ext.length)+'.'+digest+ext;
  fs.writeFileSync(path.join(output,name),bytes);if(!manifest.assets.some(x=>x.original===rel))manifest.assets.push({original:rel,versioned:name,sha256:digest});
  return attr+'="'+name+'"';
 }));
 // Retain previous immutable assets for old pages during an approved replacement/rollback.
 if(previous){check(previous);const old=JSON.parse(fs.readFileSync(path.join(previous,'CACHE-ASSETS.json'),'utf8'));for(const a of old.assets){if(!/^assets\/[A-Za-z0-9_./-]+\.[a-f0-9]{64}\.(js|css)$/.test(a.versioned)||a.versioned.split('/').includes('..'))throw Error('unsafe retained path');if(!a.versioned.endsWith('.'+a.sha256+path.extname(a.versioned)))throw Error('retained filename/hash mismatch');const b=fs.readFileSync(path.join(previous,a.versioned));if(hash(b)!==a.sha256)throw Error('retained hash mismatch');const p=path.join(output,a.versioned);fs.mkdirSync(path.dirname(p),{recursive:true});if(fs.existsSync(p)&&!fs.readFileSync(p).equals(b))throw Error('immutable collision');fs.writeFileSync(p,b);}}
 fs.writeFileSync(path.join(output,'index.html'),html);fs.writeFileSync(path.join(output,'CACHE-ASSETS.json'),JSON.stringify(manifest,null,2)+'\n');return manifest;
}
module.exports={build};if(require.main===module){const [source,output,previous]=process.argv.slice(2);if(!source||!output)throw Error('usage: node build-cache-assets.cjs SOURCE NEW_OUTPUT [PREVIOUS_OUTPUT]');console.log(JSON.stringify({assets:build(source,output,previous).assets.length}));}
