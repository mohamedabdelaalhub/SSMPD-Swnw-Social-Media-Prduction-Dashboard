/* Cloudflare Turnstile gate for Supabase Auth (public site key only; the secret lives in Supabase).
 * SSMPDTurnstile.token() resolves a fresh single-use token, or undefined when the gate is off / cannot load (fail-open client side; Supabase enforces).
 * Safe to ship before Supabase captcha is enabled: an extra captchaToken is ignored until then. */
(function (w) {
  "use strict";
  var SITE_KEY = "0x4AAAAAAF2Py3HkTPaxHh1d";
  var SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  var loading = null;

  function load() {
    if (w.turnstile) return Promise.resolve(w.turnstile);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var s = document.createElement("script");
      s.src = SRC; s.async = true;
      s.onload = function () { w.turnstile ? resolve(w.turnstile) : reject(new Error("turnstile")); };
      s.onerror = function () { loading = null; reject(new Error("turnstile-load")); };
      document.head.appendChild(s);
    });
    return loading;
  }

  function token() {
    if (!SITE_KEY) return Promise.resolve(undefined);
    return load().catch(function () { return null; }).then(function (ts) {
      if (!ts) return undefined;
      return new Promise(function (resolve) {
        var box = document.createElement("div");
        box.setAttribute("dir", "ltr");
        box.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483000;";
        document.body.appendChild(box);
        var id, done = false;
        function finish(fn, val) {
          if (done) return; done = true;
          try { ts.remove(id); } catch (e) {}
          if (box.parentNode) box.parentNode.removeChild(box);
          fn(val);
        }
        var timer = setTimeout(function () { finish(resolve, undefined); }, 45000);
        id = ts.render(box, {
          sitekey: SITE_KEY,
          appearance: "interaction-only",
          callback: function (t) { clearTimeout(timer); finish(resolve, t); },
          "error-callback": function () { clearTimeout(timer); finish(resolve, undefined); },
          "timeout-callback": function () { clearTimeout(timer); finish(resolve, undefined); }
        });
      });
    });
  }

  w.SSMPDTurnstile = { token: token, enabled: !!SITE_KEY };
})(window);
