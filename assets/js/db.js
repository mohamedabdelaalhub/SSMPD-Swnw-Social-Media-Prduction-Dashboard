/* SSMPD — طبقة الاتصال بقاعدة البيانات (Supabase) */
(function () {
  "use strict";

  var cfg = window.SSMPD_CONFIG.supabase;
  var client = window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true }
  });

  function handle(promise) {
    return promise.then(function (res) {
      if (res.error) throw res.error;
      return res.data;
    });
  }

  var Db = {
    client: client,

    // ---------- admins ----------
    getMyAdminRow: function (userId) {
      return handle(client.from("admins").select("*").eq("user_id", userId).maybeSingle());
    },
    // دعوة معلّقة (user_id لسه فاضي) بنفس البريد — لأول مرة يعمل فيها المستخدم حساب
    // مقارنة case-insensitive (ilike من غير % بيبقى مطابقة تامة بس مش حساس لحالة الحروف)
    // عشان تتطابق مع سياسة RLS في setup.sql اللي بتقارن lower(email)
    getPendingInviteByEmail: function (email) {
      return handle(client.from("admins").select("*").is("user_id", null).ilike("email", email).maybeSingle());
    },
    // يربط الدعوة المعلّقة بالحساب اللي اتعمل دلوقتي
    claimInvite: function (adminRowId, userId) {
      return handle(client.from("admins").update({ user_id: userId }).eq("id", adminRowId).select().single());
    },
    listAdmins: function () {
      return handle(client.from("admins").select("*").order("created_at", { ascending: true }));
    },
    inviteAdmin: function (email, name, role) {
      return handle(client.from("admins").insert({ email: email, name: name, role: role, active: true }));
    },
    updateAdmin: function (id, patch) {
      return handle(client.from("admins").update(patch).eq("id", id));
    },
    deleteAdmin: function (id) {
      return handle(client.from("admins").delete().eq("id", id));
    },

    // ---------- content_items ----------
    listContentItems: function (filters) {
      var q = client.from("content_items").select("*").order("created_at", { ascending: false });
      if (filters && filters.stage) q = q.eq("stage", filters.stage);
      if (filters && filters.createdBy) q = q.eq("created_by", filters.createdBy);
      if (filters && filters.assignedDesigner) q = q.eq("assigned_designer", filters.assignedDesigner);
      return handle(q);
    },
    getContentItem: function (id) {
      return handle(client.from("content_items").select("*").eq("id", id).single());
    },
    createContentItem: function (row) {
      return handle(client.from("content_items").insert(row).select().single());
    },
    updateContentItem: function (id, patch) {
      return handle(client.from("content_items").update(patch).eq("id", id).select().single());
    },
    // حذف نهائي — مقصور على السوبر أدمن حسب صلاحيات RLS "super deletes content"
    deleteContentItem: function (id) {
      return handle(client.from("content_items").delete().eq("id", id));
    },

    // ---------- comments ----------
    listComments: function (contentId) {
      return handle(client.from("comments").select("*").eq("content_id", contentId).order("created_at", { ascending: true }));
    },
    // كل الكومنتات في النظام — تُستخدم لحساب عداد "تعليق جديد" في الشاشات
    listAllComments: function () {
      return handle(client.from("comments").select("*").order("created_at", { ascending: true }));
    },
    addComment: function (row) {
      return handle(client.from("comments").insert(row).select().single());
    },
    // تحديث حالة الكومنت فقط: في انتظار التعديل (pending) / تم التعديل (done)
    updateComment: function (id, patch) {
      return handle(client.from("comments").update(patch).eq("id", id).select().single());
    },

    // ---------- comment_reads (تتبّع القراءة لعدّاد الكومنتات) ----------
    listMyCommentReads: function (adminId) {
      return handle(client.from("comment_reads").select("*").eq("admin_id", adminId));
    },
    markCommentsRead: function (adminId, contentId) {
      return handle(client.from("comment_reads").upsert(
        { admin_id: adminId, content_id: contentId, last_read_at: new Date().toISOString() },
        { onConflict: "admin_id,content_id" }
      ));
    },

    // ---------- activity_log ----------
    logActivity: function (row) {
      return handle(client.from("activity_log").insert(row));
    },
    listActivity: function (contentId) {
      return handle(client.from("activity_log").select("*").eq("content_id", contentId).order("created_at", { ascending: false }));
    },

    // ---------- weekly_social_metrics ----------
    listWeeklyMetrics: function (limit) {
      return handle(client.from("weekly_social_metrics").select("*").order("week_start", { ascending: false }).limit(limit || 12));
    },
    upsertWeeklyMetrics: function (row) {
      return handle(client.from("weekly_social_metrics").upsert(row, { onConflict: "week_start" }).select().single());
    },

    // ---------- ad_campaigns (تقرير حملات إعلانات مدفوعة مستورد من CSV) ----------
    listAdCampaigns: function () {
      return handle(client.from("ad_campaigns").select("*").order("amount_spent", { ascending: false }));
    },
    // بيمسح التقرير القديم بالكامل — كل استيراد جديد بيستبدل القديم (مش تراكمي)
    clearAdCampaigns: function () {
      return handle(client.from("ad_campaigns").delete().neq("id", "00000000-0000-0000-0000-000000000000"));
    },
    insertAdCampaigns: function (rows) {
      return handle(client.from("ad_campaigns").insert(rows));
    },

    // ---------- realtime ----------
    subscribeTable: function (table, onChange) {
      var channel = client
        .channel("ssmpd-" + table + "-" + Math.random().toString(36).slice(2))
        .on("postgres_changes", { event: "*", schema: "public", table: table }, onChange)
        .subscribe();
      return channel;
    },
    unsubscribe: function (channel) {
      if (channel) client.removeChannel(channel);
    }
  };

  window.SSMPDDb = Db;
})();
