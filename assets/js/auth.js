/* SSMPD — الدخول والخروج عبر Supabase Auth */
(function () {
  "use strict";

  var client = window.SSMPDDb.client;

  var Auth = {
    currentUser: null,   // { id, email }
    currentAdmin: null,  // صف من جدول admins { id, name, role, active }

    signIn: function (email, password) {
      return client.auth.signInWithPassword({ email: email, password: password })
        .then(function (res) {
          if (res.error) throw res.error;
          return res.data;
        });
    },

    signUp: function (email, password, name) {
      return client.auth.signUp({
        email: email, password: password,
        options: { data: { name: name } }
      }).then(function (res) {
        if (res.error) throw res.error;
        return res.data;
      });
    },

    signOut: function () {
      return client.auth.signOut();
    },

    getSession: function () {
      return client.auth.getSession().then(function (res) { return res.data.session; });
    },

    // يجيب صف admins المرتبط بالمستخدم الحالي، ويتأكد إنه مفعّل.
    // لو أول مرة يدخل فيها بعد التسجيل، وصفه لسه معلّق (user_id فاضي —
    // اتضاف بالإيميل بس من السوبر أدمن قبل ما يعمل حساب)، بنربطه تلقائياً هنا.
    loadCurrentAdmin: function (userId, email) {
      return window.SSMPDDb.getMyAdminRow(userId).then(function (row) {
        if (row) {
          if (!row.active) throw new Error("INACTIVE");
          Auth.currentAdmin = row;
          return row;
        }
        if (!email) throw new Error("NOT_INVITED");
        return window.SSMPDDb.getPendingInviteByEmail(email).then(function (invite) {
          if (!invite) throw new Error("NOT_INVITED");
          return window.SSMPDDb.claimInvite(invite.id, userId).then(function (claimed) {
            if (!claimed.active) throw new Error("INACTIVE");
            Auth.currentAdmin = claimed;
            return claimed;
          });
        });
      });
    },

    onAuthChange: function (cb) {
      client.auth.onAuthStateChange(function (event, session) {
        cb(event, session);
      });
    }
  };

  window.SSMPDAuth = Auth;
})();
