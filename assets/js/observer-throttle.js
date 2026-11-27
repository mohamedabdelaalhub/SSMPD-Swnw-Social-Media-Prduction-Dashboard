/* First-load / big-screen smoothness (owner 2026-11-27: «بتتجمد لمدة ثواني أول ما بفتحها»).
   ~15 modules watch the WHOLE page (document / body / #app-root, subtree) and re-scan it on EVERY batch of changes; while a screen is drawing that is
   hundreds of batches, each one walking the full page. This shim keeps every one of those observers and callbacks exactly as they are, but delivers a page-wide
   observer's records at most once per animation frame (all the records of that frame, in order) instead of once per change batch. rAF runs before the paint of the
   same frame, so nothing flickers; observers on small elements are untouched. Must load before every other script. Opt out for one observer with
   observer.__noThrottle = true before observe(). */
(function (w, d) {
  'use strict';
  if (w.__moThrottle || !w.MutationObserver) return; w.__moThrottle = true;
  var Orig = w.MutationObserver, raf = w.requestAnimationFrame ? w.requestAnimationFrame.bind(w) : function (f) { return setTimeout(f, 16); }, caf = w.cancelAnimationFrame ? w.cancelAnimationFrame.bind(w) : clearTimeout;
  function pageWide(t, o) { return !!(o && o.subtree && t && (t === d.documentElement || t === d.body || t.id === 'app-root')); }
  function Wrapped(cb) {
    var self = this, pending = null, handle = 0, throttle = false;
    function flush() { handle = 0; var recs = pending; pending = null; if (recs && recs.length) cb.call(self, recs, self); }
    var real = new Orig(function (recs) {
      if (!throttle || self.__noThrottle) { cb.call(self, recs, self); return; }
      pending = pending ? pending.concat(recs) : recs.slice(); if (!handle) handle = raf(flush);
    });
    this.observe = function (t, o) { if (pageWide(t, o)) throttle = true; return real.observe(t, o); };
    this.disconnect = function () { real.disconnect(); if (handle) { caf(handle); handle = 0; } pending = null; };
    this.takeRecords = function () { var r = real.takeRecords(); if (pending) { r = pending.concat(r); pending = null; if (handle) { caf(handle); handle = 0; } } return r; };
  }
  Wrapped.prototype = Orig.prototype; w.MutationObserver = Wrapped;
})(window, document);
