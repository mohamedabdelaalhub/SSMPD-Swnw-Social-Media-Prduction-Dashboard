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

    // يجيب صف admins المرتبط بالمستخدم الحالي، ويتأكد إنه مفعّل
    loadCurrentAdmin: function (userId) {
      return window.SSMPDDb.getMyAdminRow(userId).then(function (row) {
        if (!row) throw new Error("NOT_INVITED");
        if (!row.active) throw new Error("INACTIVE");
        Auth.currentAdmin = row;
        return row;
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
