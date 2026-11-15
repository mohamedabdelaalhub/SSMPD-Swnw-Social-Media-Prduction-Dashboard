// Website video posters: size rule, area-average downscale flattened on white, and the publish hook (cover → body.image).
const assert=require('assert/strict'),fs=require('fs');
(async()=>{
 const {posterSize,downscaleOnWhite,imageBytes}=await import('../supabase/functions/website-publish-process/transport.mjs');
 assert.deepEqual(posterSize(1080,1920),[720,1280]);assert.deepEqual(posterSize(640,360),[640,360]);assert.deepEqual(posterSize(1440,1),[720,1]);
 assert.throws(()=>posterSize(0,10),/INVALID_FILE/);
 // 2x2 → 1x1: opaque black+white average to grey; a fully transparent pixel counts as white.
 const src=new Uint8ClampedArray([0,0,0,255, 255,255,255,255, 0,0,0,255, 0,0,0,0]);
 const one=downscaleOnWhite(src,2,2,1,1);assert.deepEqual([...one],[128,128,128,255]);
 const same=downscaleOnWhite(new Uint8ClampedArray([10,20,30,255]),1,1,1,1);assert.deepEqual([...same],[10,20,30,255]);
 const half=downscaleOnWhite(new Uint8ClampedArray([200,100,0,128]),1,1,1,1);assert.deepEqual([...half].slice(0,3),[227,177,127]);
 assert.equal(imageBytes(new Uint8Array([255,216,255,224,0,16])).mime,'image/jpeg');
 const src2=fs.readFileSync('supabase/functions/website-publish-process/index.ts','utf8');
 assert.match(src2,/imagescript@1\.3\.0/);
 assert.match(src2,/job\.action==='upsert' && job\.payload\._videoUrl\)\{\n[^\n]*\n    const cover=await videoCoverUrl\(db,job\.content_id\);/);
 assert.match(src2,/body\.image=imageBytes\(await posterJpeg\(await readWebsiteImage\(db,cover,/);
 assert.ok(src2.indexOf('const cover=await videoCoverUrl')<src2.indexOf('result=await deliver(target.href,secret,body);'),'poster is attached before delivery');
 assert.match(src2,/catch\(e\)\{console\.warn\('website poster skipped'/,'a broken cover never blocks the video');
 assert.match(src2,/cover_settings\.cover_image_url/);assert.match(src2,/selected_cover_id/);
 console.log('PASS website video posters: ≤720px area-average on white, cover from item then selected job, attached as image before delivery, failure-tolerant');
})().catch(e=>{console.error(e);process.exit(1);});
