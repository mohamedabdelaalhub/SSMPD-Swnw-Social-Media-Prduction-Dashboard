// TikTok post panel (Content Sharing Guidelines / Direct Post audit) — jsdom, fake creator_info, no network.
const fs = require('node:fs'), assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const tick = () => new Promise(r => setTimeout(r, 5));
(async () => {
  const dom = new JSDOM('<body><div id="card"></div><button data-schedule="c1">s</button><button data-publish-now="c1">p</button></body>', { url: 'https://example.com', runScripts: 'outside-only' });
  const w = dom.window, d = w.document;
  w.queueMicrotask = queueMicrotask;
  const toasts = []; w.SSMPDToast = { show: m => toasts.push(m) };
  for (const f of ['i18n-dictionary.js', 'i18n.js', 'tiktok-post-panel.js']) w.eval(fs.readFileSync('assets/js/' + f, 'utf8'));
  const P = w.SSMPDTikTokPanel;
  const item = { id: 'c1', caption_text: 'كابشن المادة', design_file_url: 'https://drive.google.com/file/d/abc123/view', content_format: 'video' };
  d.getElementById('card').innerHTML = P.html(item);
  const $ = id => d.getElementById(id);
  const creator = { creator_nickname: 'Sono Clinic', creator_username: 'sono', creator_avatar_url: 'https://p16.tiktokcdn.com/a.jpg', privacy_level_options: ['PUBLIC_TO_EVERYONE', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'], comment_disabled: false, duet_disabled: true, stitch_disabled: false, max_video_post_duration_sec: 60 };
  let calls = 0; const api = () => { calls++; return Promise.resolve({ connected: true, can_post: true, creator }); };
  const btns = () => [...d.querySelectorAll('[data-schedule],[data-publish-now]')];

  // buttons are locked while creator_info loads
  const loading = P.load('c1', 'sono', api, () => {});
  assert.ok(btns().every(b => b.disabled));
  await loading; await tick();
  assert.equal(calls, 1);
  // account: avatar + nickname; preview of the video; caption editable and prefilled
  assert.match($('pb-tiktok-account-c1').textContent, /Sono Clinic/);
  assert.ok($('pb-tiktok-account-c1').querySelector('img[src="https://p16.tiktokcdn.com/a.jpg"]'));
  assert.ok($('pb-tiktok-preview-c1').querySelector('iframe[src="https://drive.google.com/file/d/abc123/preview"]'));
  assert.equal($('pb-tiktok-title-c1').value, 'كابشن المادة');
  // privacy: exactly creator_info's options, nothing preselected
  const sel = $('pb-tiktok-privacy-c1');
  assert.deepEqual([...sel.options].map(o => o.value), ['', 'PUBLIC_TO_EVERYONE', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY']);
  assert.equal(sel.value, '');
  // interactions unchecked; duet greyed out because the account disabled it
  assert.equal($('pb-tiktok-allow-comment-c1').checked, false);
  assert.equal($('pb-tiktok-allow-duet-c1').disabled, true);
  assert.equal($('pb-tiktok-allow-stitch-c1').disabled, false);
  assert.match($('pb-tiktok-duration-c1').textContent, /60/);
  // music declaration shown; buttons open now; but no privacy/consent -> validate refuses
  assert.match($('pb-tiktok-declaration-c1').innerHTML, /music-usage-confirmation/);
  assert.ok(btns().every(b => !b.disabled));
  assert.equal(P.validate('c1'), false);
  sel.value = 'SELF_ONLY'; sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(P.validate('c1'), false, 'consent is required');
  $('pb-tiktok-consent-c1').checked = true;
  assert.equal(P.validate('c1'), true);

  // commercial disclosure on with no choice: buttons disabled with the TikTok hint
  $('pb-tiktok-commercial-c1').checked = true; $('pb-tiktok-commercial-c1').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.ok(btns().every(b => b.disabled && /promotes yourself|لازم تحدد/.test(b.title)));
  assert.equal(P.validate('c1'), false);
  // your brand -> Promotional content label
  $('pb-tiktok-your-brand-c1').checked = true; $('pb-tiktok-your-brand-c1').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.match($('pb-tiktok-label-c1').textContent, /Promotional content/);
  assert.ok(btns().every(b => !b.disabled));
  // branded content -> Paid partnership label, SELF_ONLY disabled and cleared, branded policy in the declaration
  $('pb-tiktok-branded-c1').checked = true; $('pb-tiktok-branded-c1').dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.match($('pb-tiktok-label-c1').textContent, /Paid partnership/);
  assert.equal(sel.querySelector('option[value="SELF_ONLY"]').disabled, true);
  assert.equal(sel.value, '');
  assert.match($('pb-tiktok-declaration-c1').innerHTML, /bc-policy/);
  sel.value = 'PUBLIC_TO_EVERYONE'; sel.dispatchEvent(new w.Event('change', { bubbles: true }));
  $('pb-tiktok-title-c1').value = 'كابشن معدّل';
  const p = P.payload('c1');
  assert.deepEqual({ ...p }, { title: 'كابشن معدّل', privacyLevel: 'PUBLIC_TO_EVERYONE', disableComment: true, disableDuet: true, disableStitch: true, commercialContent: true, yourBrand: true, brandedContent: true, isAigc: false, musicConfirmation: true });

  // English mode: official TikTok declaration wording
  w.SSMPDI18n.set('en'); await tick();
  assert.equal($('pb-tiktok-declaration-c1').textContent, "By posting, you agree to TikTok's Branded Content Policy and Music Usage Confirmation.");
  assert.match($('pb-tiktok-label-c1').textContent, /labeled as 'Paid partnership'/);
  w.SSMPDI18n.set('ar');

  // creator_info is read again on every open (no stale cache)
  await P.load('c1', 'sono', api, () => {}); assert.equal(calls, 2);

  // video longer than max_video_post_duration_sec blocks posting
  P._state.c1.duration = 75; P.refresh('c1');
  assert.ok(btns().every(b => b.disabled)); assert.equal(P.validate('c1'), false);
  P._state.c1.duration = 30; P.refresh('c1'); assert.ok(btns().every(b => !b.disabled));

  // account can't post right now -> blocked with the reason
  await P.load('c1', 'sono', () => Promise.resolve({ connected: true, can_post: false, reason: 'spam_risk_too_many_posts' }), () => {});
  assert.match($('pb-tiktok-account-c1').textContent, /للحد اليومي/);
  assert.ok(btns().every(b => b.disabled)); assert.equal(P.validate('c1'), false);
  // unticking TikTok releases the buttons for the other platforms
  P.gate('c1', false); assert.ok(btns().every(b => !b.disabled));

  // render-publish uses the panel and sends the edited caption + AI flag; the worker uses them
  const rp = fs.readFileSync('assets/js/render-publish.js', 'utf8'), db = fs.readFileSync('assets/js/db.js', 'utf8');
  assert.match(rp, /SSMPDTikTokPanel\.html\(i\)/); assert.match(rp, /SSMPDTikTokPanel\.payload\(id\)/);
  assert.match(db, /title:payload\.title==null\?null/); assert.match(db, /is_aigc:!!payload\.isAigc/);
  const worker = fs.readFileSync('supabase/functions/tiktok-publish-process/index.ts', 'utf8');
  assert.match(worker, /job\.title!=null\?job\.title/); assert.match(worker, /is_aigc:job\.is_aigc===true/);
  assert.match(worker, /unaudited_client_can_only_post_to_private_accounts/);
  const auth = fs.readFileSync('supabase/functions/tiktok-auth/index.ts', 'utf8');
  assert.match(auth, /can_post:false/);
  const html = fs.readFileSync('index.html', 'utf8');
  assert.ok(html.indexOf('tiktok-post-panel.js') < html.indexOf('render-publish.js'));
  console.log('PASS: TikTok post panel follows the Content Sharing Guidelines');
})().catch(e => { console.error(e); process.exit(1); });
