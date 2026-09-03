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

  // ---------- Edge Functions (أرشيف المرضى + إدارة الليدز) ----------
  // كل الاتصال بموديولي أرشيف المرضى والليدز بيعدّي من Supabase Edge Functions
  // (مش استعلام مباشر على القاعدة زي باقي db.js) عشان التحقق من الصلاحيات
  // والمنطق الحساس (كشف تكرار، توزيع تلقائي، رفع Drive) يفضل سيرفر-سايد بالكامل
  var EDGE_BASE = cfg.url.replace(/\/+$/, "") + "/functions/v1/";

  function qs(params) {
    if (!params) return "";
    var parts = [];
    Object.keys(params).forEach(function (k) {
      var v = params[k];
      if (v === undefined || v === null || v === "") return;
      parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v));
    });
    return parts.length ? "?" + parts.join("&") : "";
  }

  function getAccessToken() {
    return client.auth.getSession().then(function (res) {
      return res.data.session ? res.data.session.access_token : null;
    });
  }

  // JSON in / JSON out
  function edgeFetch(path, opts) {
    opts = opts || {};
    return getAccessToken().then(function (token) {
      var headers = { Authorization: "Bearer " + token };
      var body;
      if (opts.json !== undefined) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(opts.json);
      }
      return fetch(EDGE_BASE + path, { method: opts.method || "GET", headers: headers, body: body });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) {
          var err = new Error(data && data.error ? data.error : "HTTP " + r.status);
          err.status = r.status; err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  // multipart/form-data in (رفع ملفات) / JSON out
  function edgeFetchForm(path, formData) {
    return getAccessToken().then(function (token) {
      return fetch(EDGE_BASE + path, {
        method: "POST",
        headers: { Authorization: "Bearer " + token },
        body: formData
      });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) {
          var err = new Error(data && data.error ? data.error : "HTTP " + r.status);
          err.status = r.status; err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  // JSON/GET in / binary blob out (تنزيل ملفات — بروكسي من السيرفر بدون أي رابط Drive مباشر)
  function edgeFetchBlob(path) {
    return getAccessToken().then(function (token) {
      return fetch(EDGE_BASE + path, { headers: { Authorization: "Bearer " + token } });
    }).then(function (r) {
      if (!r.ok) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          throw new Error(data && data.error ? data.error : "HTTP " + r.status);
        });
      }
      var disposition = r.headers.get("Content-Disposition") || "";
      var m = /filename\*=UTF-8''([^;]+)/.exec(disposition);
      var filename = m ? decodeURIComponent(m[1]) : "file";
      return r.blob().then(function (blob) { return { blob: blob, filename: filename }; });
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
    // بيرجع كل المستخدمين ومعاهم .extra_roles (مصفوفة أسماء الأدوار الإضافية،
    // من جدول admin_extra_roles) — عشان لوحة "المستخدمون والصلاحيات" تقدر تعرض/تدير
    // تعدد الأدوار. لو التحديث القديم للقاعدة (setup.sql الجديد) لسه ما اتشغّلش،
    // الجدول ممكن ميبقاش موجود — بنتعامل مع الخطأ بهدوء ونرجّع extra_roles: [] للكل.
    listAdmins: function () {
      return handle(client.from("admins").select("*").order("created_at", { ascending: true })).then(function (admins) {
        return client.from("admin_extra_roles").select("admin_id, role").then(function (res) {
          var byAdmin = {};
          (res && !res.error && res.data ? res.data : []).forEach(function (r) {
            (byAdmin[r.admin_id] = byAdmin[r.admin_id] || []).push(r.role);
          });
          admins.forEach(function (a) { a.extra_roles = byAdmin[a.id] || []; a.roles = [a.role].concat(a.extra_roles); });
          return admins;
        });
      });
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
    adminSetUserPassword: function (adminId, newPassword) {
      return edgeFetch("admin-set-password", { method: "POST", json: { admin_id: adminId, new_password: newPassword } });
    },
    // ---------- تقرير الاستخدام: جلسات + أنشطة مهمة (رفع/إنشاء) ----------
    startLoginSession: function (adminId) {
      return handle(client.from("login_sessions").insert({ admin_id: adminId }).select("id").single());
    },
    touchLoginSession: function (sessionId) {
      return handle(client.from("login_sessions").update({ last_seen_at: new Date().toISOString() }).eq("id", sessionId));
    },
    endLoginSession: function (sessionId) {
      var now = new Date().toISOString();
      return handle(client.from("login_sessions").update({ logout_at: now, last_seen_at: now }).eq("id", sessionId));
    },
    logUsageActivity: function (adminId, actionType, reportName) {
      return handle(client.from("usage_activity_log").insert({ admin_id: adminId, action_type: actionType, report_name: reportName || null }));
    },
    listLoginSessions: function (limit) {
      return handle(client.from("login_sessions").select("id, admin_id, login_at, last_seen_at, logout_at, admins(name)").order("login_at", { ascending: false }).limit(limit || 200));
    },
    listUsageActivity: function (limit) {
      return handle(client.from("usage_activity_log").select("id, admin_id, action_type, report_name, created_at, admins(name)").order("created_at", { ascending: false }).limit(limit || 200));
    },
    // ---------- مركز إشعارات الأدمن/الإدارة (بيعيد استخدام activity_log + usage_activity_log الموجودين) ----------
    listRecentContentActivity: function (sinceIso, limit) {
      return handle(client.from("activity_log").select("id, actor_id, action, created_at, admins!actor_id(name)").gt("created_at", sinceIso).order("created_at", { ascending: false }).limit(limit || 20));
    },
    listUsageActivitySince: function (sinceIso, limit) {
      return handle(client.from("usage_activity_log").select("id, admin_id, action_type, report_name, created_at, admins(name)").gt("created_at", sinceIso).order("created_at", { ascending: false }).limit(limit || 20));
    },
    listContentActivityRecent: function (limit) {
      return handle(client.from("activity_log").select("id, actor_id, action, created_at, admins!actor_id(name)").order("created_at", { ascending: false }).limit(limit || 20));
    },
    getNotificationLastSeen: function (adminId) {
      return handle(client.from("notification_reads").select("last_seen_at").eq("admin_id", adminId).maybeSingle());
    },
    getNotificationSettings: function (adminId) {
      return handle(client.from("notification_reads").select("last_seen_at, clear_mode, clear_value").eq("admin_id", adminId).maybeSingle());
    },
    updateNotificationSettings: function (adminId, patch) {
      var row = { admin_id: adminId };
      if (patch.clear_mode) row.clear_mode = patch.clear_mode;
      if (patch.clear_value) row.clear_value = patch.clear_value;
      return handle(client.from("notification_reads").upsert(row));
    },
    markNotificationsSeen: function (adminId) {
      return handle(client.from("notification_reads").upsert({ admin_id: adminId, last_seen_at: new Date().toISOString() }));
    },
    // ---------- تعدد الأدوار (admin_extra_roles) ----------
    listAdminExtraRoles: function (adminId) {
      return handle(client.from("admin_extra_roles").select("*").eq("admin_id", adminId));
    },
    addAdminExtraRole: function (adminId, role, addedBy) {
      return handle(client.from("admin_extra_roles").insert({ admin_id: adminId, role: role, added_by: addedBy || null }));
    },
    removeAdminExtraRole: function (adminId, role) {
      return handle(client.from("admin_extra_roles").delete().eq("admin_id", adminId).eq("role", role));
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
    // بحث سريع بالعنوان/النص — للبحث الموحّد في الشريط العلوي (مرحلة ٦)
    searchContentItems: function (term) {
      return handle(client.from("content_items").select("id, title, stage")
        .or("title.ilike.%" + term + "%,body.ilike.%" + term + "%")
        .order("created_at", { ascending: false }).limit(6));
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

    // ---------- أرشيف المرضى (Edge Functions) ----------
    createPatientArchive: function (payload) {
      return edgeFetch("patients-create", { method: "POST", json: payload });
    },
    listPatientsArchive: function (params) {
      return edgeFetch("patient-files-list" + qs(params));
    },
    updatePatientRecord: function (id, patch) {
      return handle(client.from("patients").update(patch).eq("id", id).select().single());
    },
    sendPatientToNursing: function (id) {
      return handle(client.from("patients").update({ sent_to_nursing_at: new Date().toISOString() }).eq("id", id).select().single());
    },
    deletePatientRecord: function (id) {
      return handle(client.from("patients").delete().eq("id", id));
    },
    getPatientMedicalProfile: function (patientId) {
      return handle(client.from("patient_medical_profile").select("*").eq("patient_id", patientId).maybeSingle());
    },
    savePatientMedicalProfile: function (patientId, patch, updatedBy) {
      var row = Object.assign({}, patch, { patient_id: patientId, updated_by: updatedBy, updated_at: new Date().toISOString() });
      return handle(client.from("patient_medical_profile").upsert(row, { onConflict: "patient_id" }).select().single());
    },
    listPatientVisits: function (patientId) {
      return handle(client.from("patient_visits").select("*").eq("patient_id", patientId).order("visit_date", { ascending: false }));
    },
    addPatientVisit: function (patientId, visit, createdBy) {
      var row = Object.assign({}, visit, { patient_id: patientId, created_by: createdBy });
      return handle(client.from("patient_visits").insert(row).select().single());
    },
    updatePatientVisit: function (visitId, patch) {
      return handle(client.from("patient_visits").update(patch).eq("id", visitId).select().single());
    },
    // تحويل مريض لطبيب آخر (من داخل فورم الزيارة) → بيعمل ليد جديد بمصدر
    // "تحويل من طبيب العيادة" عشان الريسبشن/خدمة العملاء يحجزوا معاد جديد
    createDoctorReferralLead: function (patientId, doctorName) {
      return handle(client.rpc("create_doctor_referral_lead", { p_patient_id: patientId, p_doctor_name: doctorName }));
    },
    deletePatientVisit: function (visitId) {
      return handle(client.from("patient_visits").delete().eq("id", visitId));
    },
    // ---------- تقارير مُنشأة من الداشبورد: تقرير طبي + Echocardiography ----------
    listMedicalReports: function (patientId) {
      return handle(client.from("patient_medical_reports").select("*").eq("patient_id", patientId).order("report_date", { ascending: false }));
    },
    saveMedicalReport: function (patientId, patch, createdBy) {
      var row = Object.assign({}, patch, { patient_id: patientId });
      if (patch && patch.id) {
        var id = patch.id;
        delete row.id;
        row.updated_at = new Date().toISOString();
        return handle(client.from("patient_medical_reports").update(row).eq("id", id).select().single());
      }
      row.created_by = createdBy;
      return handle(client.from("patient_medical_reports").insert(row).select().single());
    },
    deleteMedicalReport: function (id) {
      return handle(client.from("patient_medical_reports").delete().eq("id", id));
    },
    listEchoReports: function (patientId) {
      return handle(client.from("patient_echo_reports").select("*").eq("patient_id", patientId).order("report_date", { ascending: false }));
    },
    saveEchoReport: function (patientId, patch, createdBy) {
      var row = Object.assign({}, patch, { patient_id: patientId });
      if (patch && patch.id) {
        var id = patch.id;
        delete row.id;
        row.updated_at = new Date().toISOString();
        return handle(client.from("patient_echo_reports").update(row).eq("id", id).select().single());
      }
      row.created_by = createdBy;
      return handle(client.from("patient_echo_reports").insert(row).select().single());
    },
    deleteEchoReport: function (id) {
      return handle(client.from("patient_echo_reports").delete().eq("id", id));
    },
    // صور مرفقة بتقرير Echo — عدد غير محدود، كل صورة صف مستقل، مفيش سقف ثابت
    listEchoReportImages: function (echoReportId) {
      return handle(client.from("patient_echo_report_images")
        .select("id, created_at, patient_files(id, file_name, file_size, mime_type, uploaded_at)")
        .eq("echo_report_id", echoReportId)
        .order("created_at", { ascending: true }));
    },
    linkEchoReportImage: function (echoReportId, patientFileId) {
      return handle(client.from("patient_echo_report_images")
        .insert({ echo_report_id: echoReportId, patient_file_id: patientFileId })
        .select().single());
    },
    // ---------- تقرير الأسنان + تقرير العلاج الطبيعي ----------
    listDentalReports: function (patientId) {
      return handle(client.from("patient_dental_reports").select("*").eq("patient_id", patientId).order("report_date", { ascending: false }));
    },
    saveDentalReport: function (patientId, patch, createdBy) {
      var row = Object.assign({}, patch, { patient_id: patientId });
      if (patch && patch.id) {
        var id = patch.id;
        delete row.id;
        row.updated_at = new Date().toISOString();
        return handle(client.from("patient_dental_reports").update(row).eq("id", id).select().single());
      }
      row.created_by = createdBy;
      return handle(client.from("patient_dental_reports").insert(row).select().single());
    },
    deleteDentalReport: function (id) {
      return handle(client.from("patient_dental_reports").delete().eq("id", id));
    },
    // صور أشعة أسنان مرفقة بتقرير الأسنان — نفس نمط صور Echo
    listDentalReportImages: function (dentalReportId) {
      return handle(client.from("patient_dental_report_images")
        .select("id, created_at, patient_files(id, file_name, file_size, mime_type, uploaded_at)")
        .eq("dental_report_id", dentalReportId)
        .order("created_at", { ascending: true }));
    },
    linkDentalReportImage: function (dentalReportId, patientFileId) {
      return handle(client.from("patient_dental_report_images")
        .insert({ dental_report_id: dentalReportId, patient_file_id: patientFileId })
        .select().single());
    },
    listPhysioReportImages: function (physioReportId) {
      return handle(client.from("patient_physio_report_images")
        .select("id, created_at, patient_files(id, file_name, file_size, mime_type, uploaded_at)")
        .eq("physio_report_id", physioReportId)
        .order("created_at", { ascending: true }));
    },
    linkPhysioReportImage: function (physioReportId, patientFileId) {
      return handle(client.from("patient_physio_report_images")
        .insert({ physio_report_id: physioReportId, patient_file_id: patientFileId })
        .select().single());
    },
    listPhysioReports: function (patientId) {
      return handle(client.from("patient_physio_reports").select("*").eq("patient_id", patientId).order("visit_date", { ascending: false }));
    },
    savePhysioReport: function (patientId, patch, createdBy) {
      var row = Object.assign({}, patch, { patient_id: patientId });
      if (patch && patch.id) {
        var id = patch.id;
        delete row.id;
        row.updated_at = new Date().toISOString();
        return handle(client.from("patient_physio_reports").update(row).eq("id", id).select().single());
      }
      row.created_by = createdBy;
      return handle(client.from("patient_physio_reports").insert(row).select().single());
    },
    deletePhysioReport: function (id) {
      return handle(client.from("patient_physio_reports").delete().eq("id", id));
    },
    getPatientFiles: function (patientId) {
      return edgeFetch("patient-files-list" + qs({ patient_id: patientId }));
    },
    uploadPatientFile: function (formData) {
      return edgeFetchForm("patient-files-upload", formData);
    },
    deletePatientFile: function (fileId) {
      return edgeFetch("patient-files-delete", { method: "POST", json: { file_id: fileId } });
    },
    downloadPatientFile: function (fileId) {
      return edgeFetchBlob("patient-files-download" + qs({ file_id: fileId }));
    },
    // داشبورد عام: إجماليات + آخر إضافات
    getPatientArchiveStats: function () {
      return edgeFetch("patient-files-list" + qs({ stats: 1 }));
    },
    // طابور المراجعة: ملفات بحالة مراجعة معينة عبر كل المرضى (لصاحب صلاحية المراجعة)
    listFilesForReview: function (params) {
      return edgeFetch("patient-files-list" + qs(params));
    },
    reviewPatientFile: function (payload) {
      return edgeFetch("patient-files-review", { method: "POST", json: payload });
    },

    // ---------- إحالة مريض لـ"طبيب سونو" (patient_doctor_assignments — جدول عادي، مش Edge Function) ----------
    // أسماء كل الموظفين النشطين بس (id/name/role/active) — من غير بيانات حساسة،
    // متاحة لأي مستخدم مسجّل (مش بس السوبر أدمن زي listAdmins()). استخدمها لأي
    // عرض اسم بس (بواسطة/صاحب كومنت/مصمم مسؤول)، مش لشاشة إدارة المستخدمين نفسها.
    listAdminsBasic: function () {
      return handle(client.rpc("list_admins_basic"));
    },
    // مصممين نشطين — يشمل رول "designer" الأساسي أو الإضافي، بديل أدق من
    // فلترة admins.role مباشرة (كانت بتفوت مصمم لو الرول ده إضافي بس).
    listDesignersAll: function () {
      return handle(client.rpc("list_designers_all"));
    },
    // إعدادات عامة قابلة للتعديل (حدود SLA حالياً) — صف واحد id=1.
    getAppSettings: function () {
      return handle(client.from("app_settings").select("*").eq("id", 1).single());
    },
    updateAppSettings: function (patch) {
      return handle(client.from("app_settings").update(patch).eq("id", 1));
    },
    listActiveSonoDoctors: function () {
      return handle(client.rpc("list_active_sono_doctors"));
    },
    assignPatientToDoctor: function (patientId, doctorId, assignedBy) {
      return handle(client.from("patient_doctor_assignments").insert({
        patient_id: patientId, doctor_id: doctorId, assigned_by: assignedBy
      }).select().single());
    },
    // قايمة الحالات المحالة للدكتور الحالي ولسه قيد الكشف (pending) — بترجع بيانات
    // المريض متضمّنة (embed) عشان شاشة الدكتور تعرضها من غير نداء تاني
    listMyDoctorAssignments: function (doctorId) {
      return handle(client.from("patient_doctor_assignments")
        .select("id, assigned_at, patients(id, patient_code, full_name, phone, status)")
        .eq("doctor_id", doctorId).eq("status", "pending")
        .order("assigned_at", { ascending: true }));
    },
    completeDoctorAssignment: function (assignmentId) {
      return handle(client.from("patient_doctor_assignments")
        .update({ status: "done", completed_at: new Date().toISOString() })
        .eq("id", assignmentId));
    },

    // ---------- إدارة الليدز (Edge Functions) ----------
    createLead: function (payload) {
      return edgeFetch("leads-create", { method: "POST", json: payload });
    },
    listLeads: function (params) {
      return edgeFetch("leads-list" + qs(params));
    },
    logLeadAttempt: function (payload) {
      return edgeFetch("leads-attempt", { method: "POST", json: payload });
    },
    updateLeadStatus: function (payload) {
      return edgeFetch("leads-update-status", { method: "POST", json: payload });
    },
    // حذف نهائي لليد — مقصور على السوبر أدمن أو أي مستخدم عنده صلاحية
    // can_delete_leads مفعّلة (RLS "leads delete" في setup.sql هي الحارس
    // الحقيقي، الزرار في الواجهة بيتخفي بس لغير المصرح له)
    deleteLead: function (id) {
      return handle(client.from("leads").delete().eq("id", id));
    },
    // استكمال بيانات عميل "ناقص بيانات" (اسم/تليفون كان ناقص وقت الرفع بالإكسيل)
    completeMissingDataLead: function (leadId, customerName, phone) {
      return edgeFetch("leads-complete-missing-data", { method: "POST", json: { lead_id: leadId, customer_name: customerName, phone: phone } });
    },
    // قراءة مباشرة (محكومة بـ RLS) — مفيش منطق حساس هنا، غير محتاجة Edge Function
    listLeadAttempts: function (leadId) {
      return handle(client.from("lead_attempts").select("*").eq("lead_id", leadId).order("attempt_date", { ascending: false }));
    },
    listLeadStatusLog: function (leadId) {
      return handle(client.from("lead_status_log").select("*").eq("lead_id", leadId).order("changed_at", { ascending: false }));
    },
    listLeadFieldChanges: function (leadId) {
      return handle(client.from("lead_field_changes").select("*").eq("lead_id", leadId).order("changed_at", { ascending: false }));
    },
    // قائمة موظفين خفيفة (اسم فقط) — لعرض أسماء "مين رفع/عدّل" ولفلتر "الموظف اللي أنهى الحجز"
    listEmployees: function () {
      return edgeFetch("leads-list" + qs({ list_employees: 1 }));
    },
    getLeadsStats: function (filters) {
      var f = filters || {};
      return edgeFetch("leads-list" + qs({ stats: 1, from: f.from || undefined, to: f.to || undefined }));
    },
    bulkCreateLeads: function (rows) {
      return edgeFetch("leads-bulk-create", { method: "POST", json: { leads: rows } });
    },
    uploadLeadInvoice: function (formData) {
      return edgeFetchForm("lead-invoice-upload", formData);
    },
    listLeadInvoices: function (leadId) {
      return handle(client.from("lead_invoices").select("*").eq("lead_id", leadId).order("uploaded_at", { ascending: false }));
    },

    // ---------- لوحة الشكر (kudos) ----------
    // بعت شكر لموظف — الصلاحية بتتفحص فعلياً في RLS (can_manage_all_content)
    sendKudos: function (givenBy, givenTo, message) {
      return handle(client.from("kudos").insert({ given_by: givenBy, given_to: givenTo, message: message }).select().single());
    },
    // آخر رسائل الشكر (لوحة الشرف) — أسماء المرسِل/المستلم عن طريق FK صريح
    // (نفس درس admin_extra_roles: أي embed لجدول admins محتاج اسم الـFK لأنه متكرر)
    listRecentKudos: function (limit) {
      return handle(client.from("kudos")
        .select("id, message, created_at, from_admin:admins!given_by(name), to_admin:admins!given_to(name)")
        .order("created_at", { ascending: false })
        .limit(limit || 20));
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
