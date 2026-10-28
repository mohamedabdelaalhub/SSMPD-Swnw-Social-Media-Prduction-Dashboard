/* SSMPD — الدخول والخروج عبر Supabase Auth */
(function () {
  "use strict";

  var client = window.SSMPDDb.client;

  function isNetworkError(err) {
    var m = String(err && err.message || err || "");
    return /Failed to fetch|NetworkError|Load failed|fetch failed|network request failed/i.test(m);
  }

  function retryNetwork(work, attempts, delayMs) {
    attempts = Math.max(1, attempts || 1);
    delayMs = delayMs || 450;
    return Promise.resolve().then(work).catch(function (err) {
      if (!isNetworkError(err) || attempts <= 1) throw err;
      return new Promise(function (resolve) { setTimeout(resolve, delayMs); })
        .then(function () { return retryNetwork(work, attempts - 1, Math.min(delayMs * 1.7, 1400)); });
    });
  }

  var Auth = {
    currentUser: null,   // { id, email }
    currentAdmin: null,  // صف من جدول admins { id, name, role, active }

    signIn: function (email, password) {
      return retryNetwork(function () {
        return client.auth.signInWithPassword({ email: email, password: password })
          .then(function (res) {
            if (res.error) throw res.error;
            return res.data;
          });
      }, 3, 400);
    },

    signUp: function (email, password, name) {
      return retryNetwork(function () {
        return client.auth.signUp({
          email: email, password: password,
          options: { data: { name: name } }
        }).then(function (res) {
          if (res.error) throw res.error;
          return res.data;
        });
      }, 3, 400);
    },

    signOut: function () {
      return client.auth.signOut();
    },

    getSession: function () {
      return retryNetwork(function () {
        return client.auth.getSession().then(function (res) {
          if (res.error) throw res.error;
          return res.data.session;
        });
      }, 2, 300);
    },

    // بيحط .roles (الرول الأساسي + أي أدوار إضافية من admin_extra_roles) على صف
    // الأدمن — كل كود الصلاحيات في الواجهة (roles.js وما بعده) بيقرا من هنا.
    // لو جدول admin_extra_roles مش موجود لسه (تحديث SQL ما اتشغّلش)، بيتجاهل
    // بهدوء ويرجع بس [row.role] (نفس السلوك القديم قبل تعدد الأدوار).
    _attachRoles: function (row) {
      if (!row) return row;
      return retryNetwork(function () { return window.SSMPDDb.listAdminExtraRoles(row.id); }, 2, 350).then(function (extra) {
        var set = {}; set[row.role] = true;
        (extra || []).forEach(function (r) { set[r.role] = true; });
        row.extra_roles = (extra || []).map(function (r) { return r.role; });
        row.roles = Object.keys(set);
        if(!row.roles.some(function(role){return role==='accountant'||role==='financial_manager';}) || typeof window.SSMPDDb.listModulePermissions!=='function'){row.module_permissions=[];return row;}
        return retryNetwork(function(){ return window.SSMPDDb.listModulePermissions(row.id); }, 2, 350)
          .then(function(rows){row.module_permissions=rows||[];return row;},function(){row.module_permissions=[];return row;});
      }).catch(function () {
        row.extra_roles = [];
        row.roles = [row.role];
        row.module_permissions=[];
        return row;
      }).then(function(result){
        if(typeof client.rpc!=='function')return result;
        return Promise.resolve().then(function(){return client.rpc('inventory_my_access');}).then(function(r){result.inventory_assigned=!!r&&!r.error&&r.data===true;return result;},function(){result.inventory_assigned=false;return result;}).then(function(r){return Promise.resolve().then(function(){return client.rpc('inventory_supply_my_access');}).then(function(x){r.inventory_supply_access=!!x&&!x.error&&x.data===true;return r;},function(){r.inventory_supply_access=false;return r;});});
      });
    },

    // يجيب صف admins المرتبط بالمستخدم الحالي، ويتأكد إنه مفعّل.
    // لو أول مرة يدخل فيها بعد التسجيل، وصفه لسه معلّق (user_id فاضي —
    // اتضاف بالإيميل بس من السوبر أدمن قبل ما يعمل حساب)، بنربطه تلقائياً هنا.
    loadCurrentAdmin: function (userId, email) {
      return retryNetwork(function () { return window.SSMPDDb.getMyAdminRow(userId); }, 3, 450).then(function (row) {
        if (row) {
          if (!row.active) throw new Error("INACTIVE");
          return Auth._attachRoles(row).then(function (withRoles) {
            Auth.currentAdmin = withRoles;
            return withRoles;
          });
        }
        if (!email) throw new Error("NOT_INVITED");
        return retryNetwork(function () { return window.SSMPDDb.getPendingInviteByEmail(email); }, 3, 450).then(function (invite) {
          if (!invite) throw new Error("NOT_INVITED");
          return retryNetwork(function () { return window.SSMPDDb.claimInvite(invite.id, userId); }, 3, 450).then(function (claimed) {
            if (!claimed.active) throw new Error("INACTIVE");
            return Auth._attachRoles(claimed).then(function (withRoles) {
              Auth.currentAdmin = withRoles;
              return withRoles;
            });
          });
        });
      });
    },

    changePassword: function (newPassword) {
      return client.auth.updateUser({ password: newPassword }).then(function (res) {
        if (res.error) throw res.error;
        return res.data;
      });
    },

    // "نسيت كلمة السر؟" في شاشة الدخول — بيبعت لينك استرجاع للإيميل (لو مسجل
    // عندنا). الرابط بيرجّع المستخدم لنفس صفحة الداشبورد، وSupabase بينشئ
    // جلسة مؤقتة تلقائياً وبيطلق حدث "PASSWORD_RECOVERY" — مضبوط في app.js
    // إنه يفتح مودال "تغيير كلمة السر" الموجود بالفعل تلقائياً.
    resetPasswordForEmail: function (email) {
      var redirectTo = window.location.href.split("#")[0].split("?")[0];
      return retryNetwork(function () {
        return client.auth.resetPasswordForEmail(email, { redirectTo: redirectTo }).then(function (res) {
          if (res.error) throw res.error;
          return res.data;
        });
      }, 3, 400);
    },

    onAuthChange: function (cb) {
      client.auth.onAuthStateChange(function (event, session) {
        cb(event, session);
      });
    }
  };

  window.SSMPDAuth = Auth;
})();



