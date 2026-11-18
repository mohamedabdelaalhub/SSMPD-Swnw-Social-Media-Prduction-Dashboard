/* SSMPD — shared motion & sound foundation (owner-approved table, docs/ui-references/README.md).
   - One quiet Web Audio sound library (no files): click / toggle / success / error / notify.
   - Per-user on/off switch («أصوات الأزرار والحركة») mounted inside «إعداداتي».
   - Global, low-risk feedback: a soft tick when a person presses a button, a pressed ring (no clipping),
     success / error sounds on the existing toasts, an 8ms haptic tick on touch devices.
   - Opt-in helpers for redesigned screens: .fx-ripple (ripple from the press point).
   Never a sound on hover or on automatic refresh: only trusted user presses and explicit results. */
(function (w, d) {
  'use strict';
  var KEY = 'ssmpd_ui_sound_', MASTER = 0.22, ctx = null, lastTick = 0;
  function adminId() { return w.SSMPDAuth && w.SSMPDAuth.currentAdmin && w.SSMPDAuth.currentAdmin.id || 'anon'; }
  function enabled() { try { return w.localStorage.getItem(KEY + adminId()) !== 'off'; } catch (e) { return true; } }
  function setEnabled(on) { try { w.localStorage.setItem(KEY + adminId(), on ? 'on' : 'off'); } catch (e) { /* private mode: keep default */ } }
  function reduced() { return !!(w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches); }
  function audio() {
    var C = w.AudioContext || w.webkitAudioContext; if (!C) return null;
    if (!ctx) { try { ctx = new C(); } catch (e) { return null; } }
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    return ctx;
  }
  function tone(type, f1, f2, dur, vol, at) {
    var x = audio(); if (!x) return;
    var t = x.currentTime + (at || 0), o = x.createOscillator(), g = x.createGain();
    o.type = type; o.frequency.setValueAtTime(f1, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(x.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  var sound = {
    click: function () {
      if (!enabled()) return; var x = audio(); if (!x) return;
      var now = Date.now(); if (now - lastTick < 40) return; lastTick = now;
      var t = x.currentTime, dur = 0.035, n = Math.floor(x.sampleRate * dur), b = x.createBuffer(1, n, x.sampleRate), a = b.getChannelData(0);
      for (var i = 0; i < n; i++) a[i] = (Math.random() * 2 - 1) * (1 - i / n);
      var s = x.createBufferSource(), f = x.createBiquadFilter(), g = x.createGain();
      s.buffer = b; f.type = 'bandpass'; f.frequency.value = 2600; f.Q.value = 1.4;
      g.gain.setValueAtTime(MASTER * 0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(x.destination);
      s.onended = function () { s.disconnect(); f.disconnect(); g.disconnect(); };
      s.start(t);
    },
    toggle: function (up) { if (enabled()) tone('sine', up === false ? 720 : 520, up === false ? 520 : 720, 0.11, MASTER * 0.7); },
    success: function () { if (!enabled()) return; tone('sine', 660, 0, 0.13, MASTER * 0.8); tone('sine', 990, 0, 0.2, MASTER * 0.8, 0.09); },
    error: function () { if (enabled()) tone('triangle', 330, 220, 0.22, MASTER * 0.8); },
    notify: function () { if (!enabled()) return; tone('sine', 880, 0, 0.16, MASTER * 0.7); tone('sine', 1320, 0, 0.28, MASTER * 0.55, 0.12); }
  };
  function haptic() { try { if (w.navigator.vibrate && w.matchMedia && w.matchMedia('(pointer: coarse)').matches) w.navigator.vibrate(8); } catch (e) { /* not supported */ } }

  var PRESSABLE = 'button,[role=button],a.btn,.fx-press';
  function pressTarget(el) {
    var t = el && el.closest ? el.closest(PRESSABLE) : null;
    if (!t || t.disabled || t.getAttribute('aria-disabled') === 'true' || t.closest('[data-fx-silent]')) return null;
    return t;
  }
  function ripple(t, e) {
    if (reduced()) return;
    var r = t.getBoundingClientRect(), z = Math.max(r.width, r.height) * 2.2, s = d.createElement('span');
    s.className = 'fx-ripple-dot'; s.setAttribute('aria-hidden', 'true');
    s.style.width = s.style.height = z + 'px'; s.style.left = (e.clientX - r.left - z / 2) + 'px'; s.style.top = (e.clientY - r.top - z / 2) + 'px';
    t.appendChild(s); setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 560);
  }
  d.addEventListener('pointerdown', function (e) {
    if (!e.isTrusted || (e.button && e.button !== 0)) return;
    var t = pressTarget(e.target); if (!t) return;
    if (t.classList.contains('fx-ripple')) ripple(t, e);
    else if (!reduced()) { t.classList.remove('fx-pressed'); void t.offsetWidth; t.classList.add('fx-pressed'); setTimeout(function () { t.classList.remove('fx-pressed'); }, 420); }
    haptic();
  }, true);
  d.addEventListener('click', function (e) {
    if (!e.isTrusted) return;
    var t = pressTarget(e.target); if (!t) return;
    if (t.getAttribute('role') === 'switch' || t.hasAttribute('aria-pressed')) sound.toggle(t.getAttribute('aria-checked') !== 'true' && t.getAttribute('aria-pressed') !== 'true');
    else sound.click();
  }, true);

  // Existing confirmations and errors speak too (toast.js is loaded before this file).
  function hookToast() {
    var T = w.SSMPDToast; if (!T || T.__fx) return;
    var show = T.show, ok = T.success, err = T.error;
    T.show = function (m, type) { if (type === 'error') sound.error(); else if (type === 'success') sound.success(); return show.apply(T, arguments); };
    if (ok) T.success = function (m) { sound.success(); return ok.apply(T, arguments); };
    if (err) T.error = function (m) { sound.error(); return err.apply(T, arguments); };
    T.__fx = true;
  }
  hookToast();

  // «إعداداتي» row: personal-home.js calls mountControl(section).
  function mountControl(host) {
    if (!host) return;
    host.classList.add('ph-preference-row'); host.setAttribute('data-fx-silent', '');
    host.innerHTML = '<div><h3>أصوات الأزرار والحركة</h3><p>صوت خفيف لما تدوس زرار، ونغمة لما الحفظ ينجح أو يحصل خطأ.</p></div><button type="button" class="preferences-toggle" role="switch" data-ui-sound aria-label="أصوات الأزرار والحركة" aria-checked="' + enabled() + '"></button>';
    var b = host.querySelector('[data-ui-sound]');
    b.onclick = function () { var on = !enabled(); setEnabled(on); b.setAttribute('aria-checked', String(on)); if (on) sound.success(); };
  }

  w.SSMPDMotion = { sound: sound, enabled: enabled, setEnabled: setEnabled, mountControl: mountControl, hookToast: hookToast };
})(window, document);
