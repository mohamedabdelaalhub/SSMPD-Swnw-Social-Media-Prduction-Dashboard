/* SSMPD — حفظ مكان المستخدم داخل الشاشات (القسم/المجموعة) علشان الريفريش (F5) ما يطلّعوش برا الصفحة.
   sessionStorage فقط، مربوط بمعرّف المستخدم، بيتمسح عند الخروج/الدخول. بيخزّن نصوص قصيرة بس — لا مودالات ولا بيانات. */
(function (w) {
  'use strict';
  var KEY = 'ssmpd_nav_state_v1', MAX_LEN = 80, MAX_KEYS = 8;
  function owner() { var a = w.SSMPDAuth && w.SSMPDAuth.currentAdmin; return a && a.id ? String(a.id) : null; }
  function read() {
    try { var o = JSON.parse(w.sessionStorage.getItem(KEY) || 'null'); return o && typeof o === 'object' && o.m && typeof o.m === 'object' ? o : null; }
    catch (e) { return null; }
  }
  function write(o) { try { w.sessionStorage.setItem(KEY, JSON.stringify(o)); } catch (e) {} }
  function clean(v) {
    var out = {}, n = 0;
    if (!v || typeof v !== 'object') return out;
    Object.keys(v).forEach(function (k) {
      if (n >= MAX_KEYS) return;
      var x = v[k];
      if (typeof x === 'string' && x.length <= MAX_LEN) { out[k] = x; n++; }
    });
    return out;
  }
  var NavState = {
    /* آخر حالة محفوظة للموديول ده للمستخدم الحالي (أو null) */
    get: function (module) {
      var me = owner(), o = read();
      if (!me || !o || o.owner !== me) return null;
      var v = o.m[module];
      return v && typeof v === 'object' ? clean(v) : null;
    },
    set: function (module, value) {
      var me = owner();
      if (!me || !module) return;
      var o = read();
      if (!o || o.owner !== me) o = { owner: me, m: {} };
      var c = clean(value);
      if (Object.keys(c).length) o.m[module] = c; else delete o.m[module];
      write(o);
    },
    /* بيرجّع الحالة المحفوظة مرة واحدة بس لكل تحميل صفحة (بعد كده الحالة اللي في الذاكرة هي المرجع) */
    once: function (module) {
      var me = owner();
      if (!me) return null;
      NavState._used = NavState._used || {};
      var k = me + '|' + module;
      if (NavState._used[k]) return null;
      NavState._used[k] = true;
      return NavState.get(module);
    },
    clear: function () { try { w.sessionStorage.removeItem(KEY); } catch (e) {} NavState._used = {}; }
  };
  w.SSMPDNavState = NavState;
})(window);
