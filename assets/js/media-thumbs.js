/* ثمبنيل خفيف للتصميمات الخاصة — بيوفّر الـEgress على Supabase.
   كل صورة بتتحمّل مرة واحدة على الجهاز، بتتصغّر لـ 320px (حوالي 20-40KB)، وبتتخزّن في ذاكرة المتصفح (Cache API)؛
   أي فتحة بعد كده للكروت من نفس الجهاز بتيجي من الجهاز نفسه من غير أي تحميل من Supabase.
   المفتاح هو مسار الملف (بيتغير مع كل نسخة جديدة) فمفيش خطر يظهر تصميم قديم. */
(function () {
  'use strict';
  var CACHE = 'ssmpd-thumbs-v1', MAX_ENTRIES = 400, WIDTH = 320, memo = new Map();
  function keyUrl(path) { return location.origin + '/__ssmpd-thumb/' + encodeURI(path); }
  async function shrink(blob) {
    var bmp = await createImageBitmap(blob);
    var scale = Math.min(1, WIDTH / bmp.width), w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
    var canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    return await new Promise(function (resolve, reject) { canvas.toBlob(function (b) { b ? resolve(b) : reject(new Error('thumb')); }, 'image/jpeg', 0.74); });
  }
  async function trim(cache) {
    var keys = await cache.keys();
    for (var i = 0; i < keys.length - MAX_ENTRIES; i++) await cache.delete(keys[i]);
  }
  async function build(url) {
    var files = window.SSMPDDesignFiles, path = files && files.path && files.path(url);
    if (!path || !window.caches || !window.createImageBitmap) return files ? files.resolve(url) : url;
    var cache = await caches.open(CACHE), req = new Request(keyUrl(path)), hit = await cache.match(req);
    if (hit) return URL.createObjectURL(await hit.blob());
    var signed = await files.resolve(url), resp = await fetch(signed);
    if (!resp.ok) throw new Error('thumb ' + resp.status);
    var small = await shrink(await resp.blob());
    try { await cache.put(req, new Response(small, { headers: { 'Content-Type': 'image/jpeg' } })); trim(cache); } catch (e) {}
    return URL.createObjectURL(small);
  }
  function get(url) {
    if (memo.has(url)) return memo.get(url);
    var p = build(url).catch(function () { return window.SSMPDDesignFiles ? window.SSMPDDesignFiles.resolve(url) : url; });
    memo.set(url, p);
    return p;
  }
  window.SSMPDThumbs = { get: get };
})();
