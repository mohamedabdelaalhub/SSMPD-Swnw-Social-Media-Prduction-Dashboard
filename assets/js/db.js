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
      var headers = { Authorization: "Bearer " + token, apikey: cfg.anonKey, "X-Client-Info": "ssmpd-dashboard" };
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

  // Read-only archive queries use the signed-in client. Existing leads RLS remains authoritative.
  // Registration (received_by), assignment and last contact are different actions.
  var registrationCache = null, registrationRevision = 0;
  function invalidateRegistration() { registrationCache = null; registrationRevision += 1; }
  function archiveDates(query, f) {
    if (f.date_from) query = query.gte('created_at', f.date_from);
    if (f.date_to) {
      var end = new Date(f.date_to + 'T00:00:00Z');
      if (!Number.isFinite(end.getTime())) throw new Error('تاريخ غير صالح');
      end.setUTCDate(end.getUTCDate() + 1);
      query = query.lt('created_at', end.toISOString());
    }
    return query;
  }
  function listLeadArchive(params) {
    var f = params || {}, size = Math.min(50, Math.max(1, Number(f.page_size) || 20)), page = Math.max(1, Number(f.page) || 1);
    var query = client.from('leads').select('id, customer_name, phone_raw, phone_normalized, source, current_status, patient_type, assigned_to, received_by, interested_service, requested_department, priority, booking_reference, booking_date, booked_by, created_at, closed_at, missing_data_completed_at', { count: 'exact' }).order('created_at', { ascending: false }).order('id', { ascending: false });
    if (f.status) query = query.eq('current_status', f.status);
    if (f.received_by === '__unrecorded__') query = query.is('received_by', null);
    else if (f.received_by) query = query.eq('received_by', f.received_by);
    if (f.search) {
      var pattern = JSON.stringify('%' + String(f.search).replace(/[\\%_]/g, '\\$&') + '%');
      query = query.or('customer_name.ilike.' + pattern + ',phone_raw.ilike.' + pattern + ',phone_normalized.ilike.' + pattern);
    }
    query = archiveDates(query, f);
    return query.range((page - 1) * size, page * size - 1).then(function (r) {
      if (r.error) throw r.error;
      return { leads: r.data || [], total: r.count || 0, page: page, page_size: size };
    });
  }
  async function getLeadRegistrationStats(filters, employees, force) {
    if (force) invalidateRegistration();
    var revision = registrationRevision;
    var f = filters || {}, admin = window.SSMPDAuth && window.SSMPDAuth.currentAdmin;
    var key = JSON.stringify([admin && admin.id, f.date_from || '', f.date_to || '', (employees || []).map(function (e) { return e.id; })]);
    if (!force && registrationCache && registrationCache.key === key && Date.now() - registrationCache.at < 30000) return registrationCache.data;
    var counts = Object.create(null), last = Object.create(null), seen = new Set(), offset = 0, size = 500, expected = null;
    while (true) {
      var query = archiveDates(client.from('leads').select('id, received_by, created_at', { count: 'exact' }).order('id', { ascending: true }), f);
      var result = await query.range(offset, offset + size - 1);
      if (result.error) throw result.error;
      if (expected === null) expected = result.count;
      (result.data || []).forEach(function (lead) {
        if (seen.has(lead.id)) return;
        seen.add(lead.id);
        var id = lead.received_by || '__unrecorded__';
        counts[id] = (counts[id] || 0) + 1;
        if (!last[id] || lead.created_at > last[id]) last[id] = lead.created_at;
      });
      if ((result.data || []).length < size) break;
      offset += size;
    }
    if (expected !== null && expected !== seen.size) throw new Error('الليدز اتغيرت أثناء تحميل المؤشرات. اضغط تحديث.');
    var names = await handle(client.rpc('list_admins_basic'));
    var byId = Object.create(null);
    (names || []).forEach(function (e) { byId[e.id] = e; });
    var ids = Object.keys(counts);
    (employees || []).forEach(function (e) { if (!ids.includes(e.id)) ids.push(e.id); if (!byId[e.id]) byId[e.id] = e; });
    var rows = ids.map(function (id) {
      var profile = byId[id], count = counts[id] || 0;
      return { employee_id: id === '__unrecorded__' ? null : id, employee_name: id === '__unrecorded__' ? 'بدون مسجل' : profile ? profile.name : 'حساب غير متاح (' + id.slice(0, 8) + ')', active: profile ? profile.active !== false : false, count: count, percentage: seen.size ? count * 100 / seen.size : 0, last_registered_at: last[id] || null };
    }).sort(function (a, b) { return b.count - a.count || a.employee_name.localeCompare(b.employee_name, 'ar'); });
    var data = { total: seen.size, employees: rows, registrars: (names || []).filter(function (e) { return counts[e.id] || (employees || []).some(function (x) { return x.id === e.id; }); }) };
    if (revision === registrationRevision) registrationCache = { key: key, at: Date.now(), data: data };
    return data;
  }

  var Db = {
    client: client,

    listModulePermissions: function (adminId) { return handle(client.from("admin_module_permissions").select("module_key,can_view,can_create,can_update,can_delete").eq("admin_id",adminId)); },
    saveModulePermissions: function (adminId,permissions) { return handle(client.rpc("set_admin_module_permissions",{p_admin_id:adminId,p_permissions:permissions})); },
    hrSaveEmployee: function (payload, mode, role, requestId) { return handle(client.rpc('hr_save_employee', {p_payload:payload,p_mode:mode,p_role:role||null,p_request_id:requestId})); },
    hrAccountStatus: function (personId) { return handle(client.rpc('hr_account_status',{p_person_id:personId})); },
    staffAccountInvite: function (jobId) { return client.functions.invoke('hr-staff-account',{body:{job_id:jobId}}).then(async function(r){ if(r.error){var b=r.error.context;try {b=await b.json();}catch(_){} throw Error(b&&b.error||'تعذر إرسال الدعوة؛ الملف محفوظ');} if(r.data.error)throw Error(r.data.error); return r.data; }); },
    staffProfilePhoto: function (body) { return client.functions.invoke('staff-profile-photo',{body:body}).then(function(r){if(r.error||r.data&&r.data.error)throw Error(r.data&&r.data.error||'تعذر الاتصال بجوجل درايف');return r.data;}); },
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
    // طلبات تصميم Claude Creative — Claude بيصمم ويوصّل المادة للاعتماد النهائي، والاعتماد بيفضل بإيد إنسان
    requestClaudeDesign: function (contentId, style, requestedBy, note) {
      return handle(client.from("claude_design_requests").insert({
        content_id: contentId, style: style, requested_by: requestedBy || null, note: note || null
      }).select().single());
    },
    latestClaudeDesignRequest: function (contentId) {
      return handle(client.from("claude_design_requests").select("*").eq("content_id", contentId)
        .order("created_at", { ascending: false }).limit(1)).then(function (rows) { return (rows && rows[0]) || null; });
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
    logUsageActivity: function (adminId, actionType, reportName, entityType, entityId) {
      var row = { admin_id: adminId, action_type: actionType, report_name: reportName || null };
      if (entityType && entityId) { row.entity_type = entityType; row.entity_id = entityId; }
      return handle(client.from("usage_activity_log").insert(row));
    },
    listLoginSessions: function (limit) {
      return handle(client.from("login_sessions").select("id, admin_id, login_at, last_seen_at, logout_at, admins(name)").order("login_at", { ascending: false }).limit(limit || 200));
    },
    listUsageActivity: function (limit) {
      return handle(client.from("usage_activity_log").select("id, admin_id, action_type, report_name, entity_type, entity_id, created_at, admins(name)").order("created_at", { ascending: false }).limit(limit || 200));
    },
    // ---------- مركز إشعارات الأدمن/الإدارة (بيعيد استخدام activity_log + usage_activity_log الموجودين) ----------
    listRecentContentActivity: function (sinceIso, limit) {
      return handle(client.from("activity_log").select("id, actor_id, action, from_stage, to_stage, content_id, created_at, admins!actor_id(name), content_items(title, content_format, brand, stage)").gt("created_at", sinceIso).order("created_at", { ascending: false }).limit(limit || 20));
    },
    listUsageActivitySince: function (sinceIso, limit) {
      return handle(client.from("usage_activity_log").select("id, admin_id, action_type, report_name, entity_type, entity_id, created_at, admins(name)").gt("created_at", sinceIso).order("created_at", { ascending: false }).limit(limit || 20));
    },
    listContentActivityRecent: function (limit) {
      return handle(client.from("activity_log").select("id, actor_id, action, from_stage, to_stage, content_id, created_at, admins!actor_id(name), content_items(title, content_format, brand, stage)").order("created_at", { ascending: false }).limit(limit || 20));
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
      if (!window.SSMPDContentText.confirmSave(row)) return Promise.reject(new Error("تم إلغاء الحفظ. عدّل النص ثم احفظه."));
      return handle(client.from("content_items").insert(row).select().single());
    },
    updateContentItem: function (id, patch) {
      if (!window.SSMPDContentText.confirmSave(patch)) return Promise.reject(new Error("تم إلغاء الحفظ. عدّل النص ثم احفظه."));
      return handle(client.from("content_items").update(patch).eq("id", id).select().single());
    },
    submitContentDraft: function (id, correctedText) {
      return handle(client.from("content_items").update(Object.assign({}, correctedText || {}, {stage:"initial_approval"}))
        .eq("id", id).eq("stage", "idea_selection").select().single());
    },
    // ---------- Content AI + idea bank ----------
    proofreadContent: function (fields, fieldLabels) {
      return edgeFetch("content-proofread", { method: "POST", json: { fields: fields, field_labels: fieldLabels || {} } });
    },
    generateContentIdeas: function (payload) {
      return edgeFetch("/content-ai", { method: "POST", json: payload });
    },
    listSavedContentIdeas: function () {
      return handle(client.from("content_idea_bank").select("*")
        .eq("status", "saved").order("created_at", { ascending: false }));
    },
    saveContentIdea: function (idea, context) {
      if (!window.SSMPDContentText.confirmSave({ body: idea.idea, caption_text: idea.caption, script_text: idea.script })) return Promise.reject(new Error("تم إلغاء الحفظ. عدّل النص ثم احفظه."));
      context = context || {};
      return handle(client.rpc("save_content_idea", {
        p_brand: context.brand || "",
        p_specialty: context.specialty || "",
        p_advertising_objective: context.advertisingObjective || "",
        p_preferred_format: idea.formatKey || context.format || "",
        p_title: idea.title || "",
        p_idea: idea.idea || "",
        p_hook: idea.hook || "",
        p_content_angle: idea.angle || "",
        p_script_text: idea.script || "",
        p_caption_text: idea.caption || "",
        p_cta_type: idea.ctaType || "",
        p_cta_text: idea.cta || "",
        p_duration_min_seconds: idea.durationMin == null ? null : idea.durationMin,
        p_duration_max_seconds: idea.durationMax == null ? null : idea.durationMax,
        p_video_template: idea.videoTemplate || "",
        p_hypothesis_reason: idea.why || "",
        p_raw_output: idea.raw || null
      }));
    },
    markContentIdeaUsed: function (ideaId) {
      return handle(client.rpc("mark_content_idea_used", { p_idea_id: ideaId }));
    },
    discardContentIdea: function (ideaId) {
      return handle(client.rpc("discard_content_idea", { p_idea_id: ideaId }));
    },
    // حذف نهائي — مقصور على السوبر أدمن حسب صلاحيات RLS "super deletes content"
    deleteContentItem: function (id) {
      return handle(client.from("content_items").delete().eq("id", id));
    },

    // ---------- video_jobs ----------
    getVideoStudioCapabilities: function () {
      return handle(client.rpc('get_video_studio_capabilities')).catch(function (e) {
        if (['PGRST202','42883'].includes(e.code)) return {schema_version:3};
        throw e;
      });
    },
    listVideoJobsForContent: function (contentId) {
      return handle(client.from("video_jobs").select("*")
        .eq("content_id", contentId)
        .order("created_at", { ascending: false }));
    },
    listVideoWorkerHeartbeats: function () {
      return handle(client.from("video_worker_heartbeats").select("*")
        .order("last_seen_at", { ascending: false }));
    },
    routeContentDesign: function (contentId, target, designerId) {
      return handle(client.rpc("route_content_design", { p_content_id: contentId, p_target: target, p_designer_id: designerId || null })).catch(function (e) {
        // Preserve human assignment while the additive migration is being deployed.
        if (target !== 'human' || ['PGRST202','42883'].indexOf(e.code) === -1) throw e;
        return handle(client.from('content_items').update({stage:'in_design',assigned_designer:designerId}).eq('id',contentId).eq('stage','initial_approval').select().single());
      });
    },
    submitAiDesign: function (contentId) {
      return handle(client.rpc("submit_ai_design", { p_content_id: contentId }));
    },
    saveVideoStoryboard: function (contentId, storyboard) {
      return handle(client.rpc('save_video_storyboard', { p_content_id: contentId, p_storyboard: storyboard }));
    },
    createVideoJob: function (contentId) {
      return handle(client.rpc("create_video_job", { p_content_id: contentId }));
    },
    listVideoCoverCandidates: function (jobId) {
      return handle(client.from("video_cover_candidates").select("*")
        .eq("job_id", jobId).order("candidate_index", { ascending: true }));
    },
    listBrandLogos: function () {
      return handle(client.from("brand_logos").select("*"));
    },
    getBrandLogoUrl: function (path) {
      return client.storage.from("brand-logos").createSignedUrl(path, 900).then(function (res) {
        if (res.error) throw res.error;
        return res.data.signedUrl;
      });
    },
    uploadBrandLogo: function (brand, variant, file) {
      if (['sono','dr_dina'].indexOf(brand) < 0) return Promise.reject(new Error('براند غير معروف'));
      if (['primary','alternate'].indexOf(variant) < 0) return Promise.reject(new Error('نسخة لوجو غير صالحة'));
      var types = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
      if (!types[file.type] || !file.size || file.size > 5 * 1024 * 1024) {
        return Promise.reject(new Error('ارفع PNG أو JPG أو WebP بحجم لا يتجاوز 5MB'));
      }
      var path = brand + '/' + variant + '/' + crypto.randomUUID() + types[file.type];
      return client.storage.from('brand-logos').upload(path, file, { upsert: false, contentType: file.type }).then(function (res) {
        if (res.error) throw res.error;
        return handle(client.rpc('set_brand_logo', { p_brand: brand, p_variant: variant, p_storage_path: path, p_file_name: file.name }));
      });
    },
    selectVideoCover: function (jobId, candidateId) {
      return handle(client.rpc("select_video_cover", { p_job_id: jobId, p_candidate_id: candidateId }));
    },
    listVideoAssetsForContent: function (contentId) {
      return handle(client.from("video_assets").select("*")
        .eq("content_id", contentId)
        .order("created_at", { ascending: true }));
    },
    uploadVideoAsset: function (contentId, adminId, assetType, file) {
      var safeName = String(file.name || "asset")
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "asset";
      var storagePath = adminId + "/" + contentId + "/" +
        Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "-" + safeName;
      var bucket = client.storage.from("video-inputs");

      return bucket.upload(storagePath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type || undefined
      }).then(function (res) {
        if (res.error) throw res.error;
        return handle(client.rpc("register_video_asset", {
          p_content_id: contentId,
          p_asset_type: assetType,
          p_storage_path: storagePath,
          p_file_name: file.name || safeName,
          p_mime_type: file.type || "",
          p_file_size: file.size
        })).catch(function (e) {
          bucket.remove([storagePath]).catch(function () {});
          throw e;
        });
      });
    },
    deleteVideoAsset: function (asset) {
      var bucket = client.storage.from("video-inputs");
      return bucket.remove([asset.storage_path]).then(function (res) {
        if (res.error) throw res.error;
        return handle(client.rpc("delete_video_asset_record", { p_asset_id: asset.id }));
      });
    },
    getVideoAssetSignedUrl: function (storagePath) {
      return client.storage.from("video-inputs").createSignedUrl(storagePath, 900)
        .then(function (res) {
          if (res.error) throw res.error;
          return res.data && res.data.signedUrl;
        });
    },

    // ---------- comments ----------
    listComments: function (contentId) {
      return handle(client.from("comments").select("*").eq("content_id", contentId).order("created_at", { ascending: true }));
    },
    // كل الكومنتات في النظام — تُستخدم لحساب عداد "تعليق جديد" في الشاشات
    deleteComment: function (id) {
      return handle(client.from("comments").delete().eq("id", id).select("id").single());
    },
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

    // ---------- Meta Ads المُطبّعة (قسم ٣٥ — جداول + Views جديدة، ad_campaigns فوق فضل زي ما هو) ----------
    listMetaAdPerformance: function () {
      return handle(client.from("vw_meta_ad_performance").select("*").order("spend", { ascending: false, nullsFirst: false }));
    },
    listMetaSpecialtyPerformance: function () {
      return handle(client.from("vw_meta_specialty_performance").select("*").order("spend", { ascending: false, nullsFirst: false }));
    },
    listMetaCreativePerformance: function () {
      return handle(client.from("vw_meta_creative_performance").select("*").order("spend", { ascending: false, nullsFirst: false }));
    },
    listMetaLeadAttribution: function () {
      return handle(client.from("vw_lead_meta_attribution").select("*").order("received_at", { ascending: false }));
    },

    // ---------- content_meta_links (قسم ٣٦ — ربط يدوي بين المحتوى وإعلانات Meta) ----------
    // من غير contentId بيرجع كل الروابط (بيُستخدم في تاب Meta Ads للربط العكسي)
    listContentMetaPerformance: function (contentId) {
      var q = client.from("vw_content_meta_performance").select("*");
      if (contentId) q = q.eq("content_id", contentId);
      return handle(q.order("linked_at", { ascending: false }));
    },
    createContentMetaLink: function (row) {
      return handle(client.from("content_meta_links").insert(row));
    },
    deleteContentMetaLink: function (id) {
      return handle(client.from("content_meta_links").delete().eq("id", id));
    },
    // ---------- Content Intelligence (قسم ٣٧ — أنماط أداء تاريخية + mapping تخصصات) ----------
    listContentSpecialtyMap: function () {
      return handle(client.from("content_meta_specialty_map").select("*").eq("active", true));
    },
    listContentIntelligencePatterns: function () {
      return handle(client.from("vw_content_intelligence_patterns").select("*"));
    },

    // ---------- Media Buyer Control Center (قسم ٣٨ — Phase 1، مفيش اتصال بـMeta API خالص) ----------
    listMediaBuyerPlans: function () {
      return handle(client.from("media_buyer_plans").select("*").order("created_at", { ascending: false }));
    },
    updateMediaBuyerPlan: function (id, patch) {
      return handle(client.from("media_buyer_plans").update(patch).eq("id", id).select().single());
    },
    approveMediaBuyerPlan: function (id, adminId) {
      return handle(client.from("media_buyer_plans")
        .update({ status: "approved", approved_by: adminId, approved_at: new Date().toISOString() })
        .eq("id", id).select().single());
    },
    rejectMediaBuyerPlan: function (id, adminId, reason) {
      return handle(client.from("media_buyer_plans")
        .update({ status: "rejected", rejected_by: adminId, rejected_at: new Date().toISOString(), rejection_reason: reason || null })
        .eq("id", id).select().single());
    },
    listMediaBuyerActions: function () {
      return handle(client.from("media_buyer_actions").select("*").order("created_at", { ascending: false }));
    },
    approveMediaBuyerAction: function (id, adminId) {
      return handle(client.from("media_buyer_actions")
        .update({ status: "approved", approved_by: adminId, approved_at: new Date().toISOString() })
        .eq("id", id).select().single());
    },
    rejectMediaBuyerAction: function (id) {
      return handle(client.from("media_buyer_actions").update({ status: "rejected" }).eq("id", id).select().single());
    },
    // Phase 2B: كود ربط مؤقت (10 دقايق) للوكيل الخارجي — النص الصريح بيترجع
    // مرة واحدة بس من الدالة، القاعدة عندها الهاش بس (media-buyer-pair)
    createMediaBuyerPairingCode: function () {
      return edgeFetch("media-buyer-pair", { method: "POST", json: { op: "create_pairing_code" } });
    },
    // Phase 3D — صحة الـWorker المحلي + طابور التصعيدات (observability بس،
    // مفيش أي كتابة من هنا — الكتابة حصريًا عن طريق media-buyer-propose بمفتاح service_role)
    listMediaBuyerWorkerRuns: function () {
      return handle(client.from("media_buyer_worker_runs").select("*").order("started_at", { ascending: false }).limit(20));
    },
    listMediaBuyerEscalations: function () {
      return handle(client.from("media_buyer_escalations").select("*").order("created_at", { ascending: false }));
    },
    setMediaBuyerEscalationStatus: function (id, status, adminId, notes) {
      var patch = { status: status, updated_at: new Date().toISOString() };
      if (status === "resolved" || status === "dismissed") {
        patch.resolution_notes = notes || null;
        patch.resolved_by = adminId;
        patch.resolved_at = new Date().toISOString();
      }
      return handle(client.from("media_buyer_escalations").update(patch).eq("id", id).select().single());
    },

    // ---------- أرشيف المرضى (Edge Functions) ----------
    psychologySnapshot: function(id) { return handle(client.rpc("psychology_snapshot",{p_patient:id||null})); },
    psychologyLookup: function(query) { return handle(client.rpc("psychology_lookup",{p_query:query})); },
    psychologyCommand: function(action,payload,token) { return handle(client.rpc("psychology_command",{p_action:action,p_payload:payload,p_token:token})); },
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
    listContractsForPatientVisit: function (patientId) {
      return handle(client.rpc("list_contracts_for_patient_visit", { p_patient_id: patientId }));
    },
    listVisitMedications: function (visitId) {
      return handle(client.from("patient_visit_medications").select("*").eq("visit_id", visitId).order("created_at"));
    },
    setVisitMedications: function (visitId, medications) {
      return handle(client.rpc("set_patient_visit_medications", { p_visit_id: visitId, p_medications: medications || [] }));
    },
    listVisitMedicationDoseCompletions: function (visitId) {
      return handle(client.from("patient_medication_dose_completions").select("*, patient_visit_medications!inner(visit_id, medicine_name)").eq("patient_visit_medications.visit_id", visitId).order("scheduled_date", { ascending: false }).order("scheduled_time", { ascending: false }).limit(100));
    },
    listDevelopmentAssessments: function (patientId) {
      return handle(client.from("patient_development_assessments").select("*").eq("patient_id", patientId).order("assessment_date", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }));
    },
    saveDevelopmentAssessment: function (patientId, kind, existing, details) {
      var row = { patient_id: patientId, assessment_kind: kind, assessment_date: details.assessment_date || null, details: details };
      if (!existing) return handle(client.from("patient_development_assessments").insert(row).select().single());
      return handle(client.from("patient_development_assessments").update({ assessment_date: row.assessment_date, details: details }).eq("id", existing.id).eq("patient_id", patientId).eq("assessment_kind", kind).eq("updated_at", existing.updated_at).select().maybeSingle()).then(function (saved) {
        if (!saved) throw new Error("تم تعديل الاستمارة بواسطة مستخدم آخر. أعد فتحها قبل الحفظ.");
        return saved;
      });
    },
    getPatientSpeechProfile: function (patientId) {
      return handle(client.from("patient_speech_profiles").select("*").eq("patient_id", patientId).maybeSingle());
    },
    savePatientSpeechProfile: function (patientId, patch, adminId) {
      var row = Object.assign({}, patch, { patient_id: patientId, updated_by: adminId, updated_at: new Date().toISOString() });
      if (!row.created_by) row.created_by = adminId;
      return handle(client.from("patient_speech_profiles").upsert(row, { onConflict: "patient_id" }).select().single());
    },
    listPatientSpeechSessions: function (patientId) {
      return handle(client.from("patient_speech_sessions").select("*").eq("patient_id", patientId).order("session_at", { ascending: false }));
    },
    addPatientSpeechSession: function (patientId, session, adminId) {
      var row = Object.assign({}, session, { patient_id: patientId, created_by: adminId, updated_by: adminId });
      return handle(client.from("patient_speech_sessions").insert(row).select().single());
    },
    updatePatientSpeechSession: function (sessionId, patch, adminId) {
      return handle(client.from("patient_speech_sessions").update(Object.assign({}, patch, { updated_by: adminId, updated_at: new Date().toISOString() })).eq("id", sessionId).select().single());
    },
    deletePatientSpeechSession: function (sessionId) {
      return handle(client.from("patient_speech_sessions").delete().eq("id", sessionId));
    },
    getPatientPsychologyProfile: function (patientId) {
      return handle(client.from("patient_psychology_profiles").select("*").eq("patient_id", patientId).maybeSingle());
    },
    savePatientPsychologyProfile: function (patientId, patch, adminId) {
      var row = Object.assign({}, patch, { patient_id: patientId, updated_by: adminId, updated_at: new Date().toISOString() });
      if (!row.created_by) row.created_by = adminId;
      return handle(client.from("patient_psychology_profiles").upsert(row, { onConflict: "patient_id" }).select().single());
    },
    listPatientPsychologySessions: function (patientId) {
      return handle(client.from("patient_psychology_sessions").select("*").eq("patient_id", patientId).order("session_at", { ascending: false }));
    },
    addPatientPsychologySession: function (patientId, session, adminId) {
      var row = Object.assign({}, session, { patient_id: patientId, created_by: adminId, updated_by: adminId });
      return handle(client.from("patient_psychology_sessions").insert(row).select().single());
    },
    updatePatientPsychologySession: function (sessionId, patch, adminId) {
      return handle(client.from("patient_psychology_sessions").update(Object.assign({}, patch, { updated_by: adminId, updated_at: new Date().toISOString() })).eq("id", sessionId).select().single());
    },
    deletePatientPsychologySession: function (sessionId) {
      return handle(client.from("patient_psychology_sessions").delete().eq("id", sessionId));
    },
    refreshOverdueFollowups: function () {
      return handle(client.rpc("refresh_overdue_followups"));
    },
    // تحويل مريض لطبيب آخر (من داخل فورم الزيارة) → بيعمل ليد جديد بمصدر
    // "تحويل من طبيب العيادة" عشان الريسبشن/خدمة العملاء يحجزوا معاد جديد
    createDoctorReferralLead: function (patientId, doctorName) {
      return handle(client.rpc("create_doctor_referral_lead", { p_patient_id: patientId, p_doctor_name: doctorName }));
    },
    deletePatientVisit: function (visitId) {
      return handle(client.from("patient_visits").delete().eq("id", visitId));
    },
    // ---------- جهات التعاقد ----------
    listContractingEntities: function (includeSummary) {
      return handle(client.rpc("contracting_entities_overview_categories")).then(function(rows){
        if(!includeSummary || !rows || !rows.length) return rows;
        return handle(client.from("contracting_entities").select("id,partner_code,contracting_entity_contacts(full_name,is_primary)").in("id",rows.map(function(r){return r.entity_id;}))).then(function(details){
          var byId={};(details||[]).forEach(function(d){byId[d.id]=d;});
          return rows.map(function(r){var d=byId[r.entity_id]||{},contacts=d.contracting_entity_contacts||[],primary=contacts.find(function(c){return c.is_primary;})||contacts[0];return Object.assign({},r,{partner_code:d.partner_code||'',primary_contact_name:primary?primary.full_name:''});});
        });
      });
    },
    deleteContractingEntity: function (entityId) {
      return handle(client.rpc("delete_contracting_entity", { p_entity_id: entityId }));
    },
    listActiveContracts: function () {
      return handle(client.from("contracting_entity_contracts")
        .select("id, entity_id, start_date, end_date, status, contracting_entities(name)")
        .eq("status", "active").order("start_date", { ascending: false }));
    },
    createContractingEntity: function (entity, contact, contract, activity) {
      return handle(client.from("contracting_entities").insert(entity).select().single()).then(function (created) {
        var jobs = [];
        if (contact && contact.full_name) jobs.push(client.from("contracting_entity_contacts").insert(Object.assign({}, contact, { entity_id: created.id, is_primary: true })));
        var contractJob = contract ? client.from("contracting_entity_contracts").insert(Object.assign({}, contract, { entity_id: created.id })).select().single() : Promise.resolve({ data: null });
        return Promise.all([Promise.all(jobs), contractJob]).then(function (rows) {
          var savedContract = rows[1] && rows[1].data;
          if (!activity || !activity.summary) return created;
          return handle(client.from("contracting_entity_activities").insert(Object.assign({}, activity, { entity_id: created.id, contract_id: savedContract && savedContract.id }))).then(function () { return created; });
        });
      });
    },
    getContractingEntityDetails: function (entityId) {
      return Promise.all([
        handle(client.from("contracting_entities").select("*").eq("id", entityId).single()),
        handle(client.from("contracting_entity_contacts").select("*").eq("entity_id", entityId).order("is_primary", { ascending: false })),
        handle(client.from("contracting_entity_contracts").select("*").eq("entity_id", entityId).order("start_date", { ascending: false })),
        handle(client.from("contracting_entity_activities").select("*").eq("entity_id", entityId).order("created_at", { ascending: false })),
        handle(client.rpc("contract_entity_financial_rows", { p_entity_id: entityId }))
      ]).then(function (r) { return { entity: r[0], contacts: r[1], contracts: r[2], activities: r[3], finance: r[4] }; });
    },
    updateContractingEntityContract: function (contractId, entityId, patch) {
      return handle(client.from("contracting_entity_contracts").update(patch)
        .eq("id", contractId).eq("entity_id", entityId).select().single());
    },
    addContractActivity: function (row) { return handle(client.from("contracting_entity_activities").insert(row).select().single()); },
    linkPatientToContract: function (row) { return handle(client.from("contract_patient_links").insert(row).select().single()); },
    uploadContractingEntityContract: function (formData) {
      return edgeFetchForm("contracting-entity-contract-upload", formData);
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
    // ---------- روشتة (Prescription) ----------
    listPrescriptions: function (patientId) {
      return handle(client.from("patient_prescriptions").select("*").eq("patient_id", patientId).order("report_date", { ascending: false }));
    },
    savePrescription: function (patientId, patch, createdBy) {
      var row = Object.assign({}, patch, { patient_id: patientId });
      if (patch && patch.id) {
        var id = patch.id;
        delete row.id;
        row.updated_at = new Date().toISOString();
        return handle(client.from("patient_prescriptions").update(row).eq("id", id).select().single());
      }
      row.created_by = createdBy;
      return handle(client.from("patient_prescriptions").insert(row).select().single());
    },
    deletePrescription: function (id) {
      return handle(client.from("patient_prescriptions").delete().eq("id", id));
    },
    // ---------- فورم طلب تحاليل (Lab Request) ----------
    listLabRequests: function (patientId) {
      return handle(client.from("patient_lab_requests").select("*").eq("patient_id", patientId).order("report_date", { ascending: false }));
    },
    saveLabRequest: function (patientId, patch, createdBy) {
      var row = Object.assign({}, patch, { patient_id: patientId });
      if (patch && patch.id) {
        var id = patch.id;
        delete row.id;
        row.updated_at = new Date().toISOString();
        return handle(client.from("patient_lab_requests").update(row).eq("id", id).select().single());
      }
      row.created_by = createdBy;
      return handle(client.from("patient_lab_requests").insert(row).select().single());
    },
    deleteLabRequest: function (id) {
      return handle(client.from("patient_lab_requests").delete().eq("id", id));
    },
    // ---------- فورم طلب أشعة (Radiology Request) ----------
    listRadiologyRequests: function (patientId) {
      return handle(client.from("patient_radiology_requests").select("*").eq("patient_id", patientId).order("report_date", { ascending: false }));
    },
    saveRadiologyRequest: function (patientId, patch, createdBy) {
      var row = Object.assign({}, patch, { patient_id: patientId });
      if (patch && patch.id) {
        var id = patch.id;
        delete row.id;
        row.updated_at = new Date().toISOString();
        return handle(client.from("patient_radiology_requests").update(row).eq("id", id).select().single());
      }
      row.created_by = createdBy;
      return handle(client.from("patient_radiology_requests").insert(row).select().single());
    },
    deleteRadiologyRequest: function (id) {
      return handle(client.from("patient_radiology_requests").delete().eq("id", id));
    },
    // ---------- تقييم تجربة المريض (Patient Experience Rating) — تكراري لكل زيارة ----------
    listPatientExperienceRatings: function (patientId) {
      return handle(client.from("patient_experience_ratings").select("*").eq("patient_id", patientId).order("visit_date", { ascending: false }));
    },
    saveExperienceRating: function (patientId, patch, createdBy) {
      var row = Object.assign({}, patch, { patient_id: patientId, created_by: createdBy });
      return handle(client.from("patient_experience_ratings").insert(row).select().single());
    },
    deleteExperienceRating: function (id) {
      return handle(client.from("patient_experience_ratings").delete().eq("id", id));
    },
    // قائمة كل التقييمات عبر كل المرضى (لتاب "تقييمات العملاء" في خدمة العملاء) —
    // مع اسم/هاتف المريض عن طريق join، وفلتر تاريخ اختياري (from/to على visit_date)
    listAllExperienceRatings: function (params) {
      params = params || {};
      var q = client.from("patient_experience_ratings").select("*, patients(full_name, phone)").order("visit_date", { ascending: false });
      if (params.from) q = q.gte("visit_date", params.from);
      if (params.to) q = q.lte("visit_date", params.to);
      return handle(q);
    },
    // بحث آمن ومحدود عن المرضى (اسم/هاتف/كود بس) — لخدمة العملاء لما تحتاج
    // تلاقي مريض تربط بيه تقييم تجربة جديد
    searchPatientsBasic: function (term) {
      return handle(client.rpc("search_patients_basic", { p_term: term }));
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
    // ---------- التغذية: قوالب وجبات + زيارات + مستندات + تتبع التزام ----------
    listNutritionTemplates: function () {
      return handle(client.from("nutrition_meal_templates").select("*, admins(name)").order("usage_count", { ascending: false }));
    },
    saveNutritionTemplate: function (patch, createdBy) {
      var row = Object.assign({}, patch);
      if (patch && patch.id) {
        var id = patch.id;
        delete row.id;
        row.updated_at = new Date().toISOString();
        return handle(client.from("nutrition_meal_templates").update(row).eq("id", id).select().single());
      }
      row.created_by = createdBy;
      return handle(client.from("nutrition_meal_templates").insert(row).select().single());
    },
    deleteNutritionTemplate: function (id) {
      return handle(client.from("nutrition_meal_templates").delete().eq("id", id));
    },
    bumpNutritionTemplateUsage: function (id, currentCount) {
      return handle(client.from("nutrition_meal_templates").update({ usage_count: (currentCount || 0) + 1 }).eq("id", id));
    },
    listNutritionVisits: function (patientId) {
      return handle(client.from("patient_nutrition_visits").select("*").eq("patient_id", patientId).order("visit_date", { ascending: false }));
    },
    saveNutritionVisit: function (patientId, patch, createdBy) {
      var row = Object.assign({}, patch, { patient_id: patientId });
      if (patch && patch.id) {
        var id = patch.id;
        delete row.id;
        row.updated_at = new Date().toISOString();
        return handle(client.from("patient_nutrition_visits").update(row).eq("id", id).select().single());
      }
      row.created_by = createdBy;
      return handle(client.from("patient_nutrition_visits").insert(row).select().single());
    },
    deleteNutritionVisit: function (id) {
      return handle(client.from("patient_nutrition_visits").delete().eq("id", id));
    },
    listNutritionVisitFiles: function (visitId) {
      return handle(client.from("patient_nutrition_visit_files")
        .select("id, created_at, patient_files(id, file_name, file_size, mime_type, uploaded_at)")
        .eq("visit_id", visitId)
        .order("created_at", { ascending: true }));
    },
    linkNutritionVisitFile: function (visitId, patientFileId) {
      return handle(client.from("patient_nutrition_visit_files")
        .insert({ visit_id: visitId, patient_file_id: patientFileId })
        .select().single());
    },
    listNutritionMealCompletions: function (visitId) {
      return handle(client.from("patient_nutrition_meal_completions").select("*").eq("visit_id", visitId));
    },
    listNutritionDailyCompletions: function (visitId, day) {
      return handle(client.from("patient_nutrition_daily_completions").select("*").eq("visit_id", visitId).eq("tracking_date", day));
    },
    listNutritionDailyCompletionHistory: function (visitId, fromDay, toDay) {
      return handle(client.from("patient_nutrition_daily_completions")
        .select("meal_id, meal_name_snapshot, tracking_date, completed, completed_at, recorded_by_admin_id, recorded_by_account_id, updated_at")
        .eq("visit_id", visitId)
        .gte("tracking_date", fromDay)
        .lte("tracking_date", toDay)
        .order("tracking_date", { ascending: false }));
    },
    setNutritionDailyCompletion: function (visitId, mealId, day, completed) {
      return handle(client.from("patient_nutrition_daily_completions").upsert({
        visit_id: visitId, meal_id: mealId, tracking_date: day, completed: completed
      }, { onConflict: "visit_id,meal_id,tracking_date" }).select().single());
    },
    setNutritionMealCompletion: function (visitId, mealId, completed, adminId) {
      return handle(client.from("patient_nutrition_meal_completions")
        .upsert({
          visit_id: visitId, meal_id: mealId, completed: completed,
          completed_at: completed ? new Date().toISOString() : null,
          recorded_by_admin_id: adminId, recorded_by_account_id: null, updated_at: new Date().toISOString()
        }, { onConflict: "visit_id,meal_id" })
        .select().single());
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
    // أداء الفريق (KPIs): الدالة بتحسب كل حاجة في القاعدة، والمستهدفات والتقييم الشهري جداول للإدارة بس
    staffKpis: function (from, to) { return handle(client.rpc("staff_kpis", { p_from: from, p_to: to })); },
    kpiDefs: function () { return handle(client.from("kpi_defs").select("*").order("sort_order")); },
    kpiTargets: function () { return handle(client.from("kpi_targets").select("role,kpi,target,weight")); },
    saveKpiTargets: function (rows) { return handle(client.from("kpi_targets").upsert(rows, { onConflict: "role,kpi" })); },
    contentLearnings: function () { return handle(client.from("content_learnings").select("id,brand,dimension,value,verdict,confidence,evidence,note,source,expires_at").eq("active", true).gt("expires_at", new Date().toISOString()).order("brand").order("verdict")); },
    setLearningActive: function (id, on) { return handle(client.from("content_learnings").update({ active: !!on }).eq("id", id)); },
    metaPublishIssues: function () { return handle(client.rpc("meta_publish_issues")); },
    metaJobRetry: function (id) { return handle(client.rpc("meta_job_retry", { p_job: id })); },
    ratingQueue: function () { return handle(client.rpc("personal_home_rating_queue")); },
    myStaffKpis: function (from, to) { return handle(client.rpc("my_staff_kpis", { p_from: from, p_to: to })); },
    staffKpiSelfView: function () { return handle(client.from("staff_kpi_settings").select("value").eq("key", "self_view").maybeSingle()); },
    setStaffKpiSelfView: function (on) { return handle(client.from("staff_kpi_settings").upsert({ key: "self_view", value: !!on, updated_by: window.SSMPDAuth.currentAdmin.id, updated_at: new Date().toISOString() }, { onConflict: "key" })); },
    staffAlerts: function () { return handle(client.from("staff_kpi_alerts").select("id,admin_id,kpi,message,created_at,acknowledged_at").is("acknowledged_at", null).order("created_at", { ascending: false }).limit(20)); },
    ackStaffAlert: function (id) { return handle(client.from("staff_kpi_alerts").update({ acknowledged_at: new Date().toISOString() }).eq("id", id)); },
    staffSummaries: function (month) { return handle(client.from("staff_monthly_summaries").select("admin_id,month,strength,improve,action,score,source,created_at").eq("month", month)); },
    staffReviews: function (month) { return handle(client.from("staff_reviews").select("admin_id,month,rating,note,updated_at").eq("month", month)); },
    staffReviewHistory: function (adminId) { return handle(client.from("staff_reviews").select("month,rating,note").eq("admin_id", adminId).order("month", { ascending: false }).limit(12)); },
    saveStaffReview: function (adminId, month, rating, note) { return handle(client.from("staff_reviews").upsert({ admin_id: adminId, month: month, rating: rating, note: String(note || "").slice(0, 1000), reviewed_by: window.SSMPDAuth.currentAdmin.id, updated_at: new Date().toISOString() }, { onConflict: "admin_id,month" })); },
    // تقييم الموظف لأداء مادة منشورة (strong/ok/weak + سبب) — بيغذّي ذاكرة التعلّم
    getContentLearningBrief: function (brand) {
      return handle(client.rpc("content_learning_brief_staff", { p_brand: brand }));
    },
    getContentRating: function (contentId) {
      return handle(client.from("content_ratings").select("rating,reason,failure_cause,rated_at").eq("content_id", contentId).maybeSingle());
    },
    setContentRating: function (contentId, rating, reason, cause) {
      return handle(client.from("content_ratings").upsert({ content_id: contentId, rating: rating, reason: String(reason || "").slice(0, 400), failure_cause: rating === "weak" && cause ? cause : null, rated_by: window.SSMPDAuth.currentAdmin.id, rated_at: new Date().toISOString() }, { onConflict: "content_id" }));
    },
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
    // كل الإحالات لسه "قيد الكشف" (pending) — مستخدمة في شاشة "تصفح وفلترة" عشان
    // تعرض "تم التحويل للطبيب فلان" بدل زرار "تحويل لطبيب سونو" العادي. من غير
    // embed لجدول admins (فيه FK مزدوج doctor_id/assigned_by — نفس فخ ?v=22) —
    // الاسم بيتجاب منفصل عن طريق listAdminsBasic() في الواجهة.
    listPendingDoctorAssignments: function () {
      return handle(client.from("patient_doctor_assignments")
        .select("id, patient_id, doctor_id, assigned_at")
        .eq("status", "pending"));
    },

    // ---------- إدارة الليدز (Edge Functions) ----------
    createLead: function (payload) {
      invalidateRegistration();
      return edgeFetch("leads-create", { method: "POST", json: payload });
    },
    listLeadArchive: listLeadArchive,
    getLeadRegistrationStats: getLeadRegistrationStats,
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
      invalidateRegistration();
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
      invalidateRegistration();
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

    // ---------- AI Customer Agent Bookings (قسم ٤٤) ----------
    // Read-only mirror. Writes arrive through booking-sync-ingest server-side.
    listCustomerBookings: function (params) {
      params = params || {};
      var q = client.from("customer_bookings").select("*")
        .order("appointment_date", { ascending: true, nullsFirst: false })
        .order("appointment_time", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (params.status) q = q.eq("status", params.status);
      if (params.from) q = q.gte("appointment_date", params.from);
      if (params.to) q = q.lte("appointment_date", params.to);
      if (params.limit) q = q.limit(params.limit);
      return handle(q).then(async function(rows){var linked=[];for(var page=0;page<Math.min(params.limit||500,500);page+=100){var report=await handle(client.rpc('clinic_reception_shared_records',{p_context:'bookings',p_id:null,p_from:params.from||null,p_to:params.to||null,p_offset:page}));if(!report)break;var extra=(report.appointments||[]).map(function(a){return {id:'reception:'+a.id,booking_reference:'RX-'+a.id,customer_name:a.patient_name,phone:a.phone,doctor_name:a.provider_name,specialty_name:a.service_name,appointment_date:a.appointment_date,appointment_time:a.appointment_time,status:a.status==='booked'?'confirmed':a.status,created_at:a.created_at,reception_id:a.id};});linked=linked.concat(extra);if(extra.length<100)break;}return (rows||[]).concat(linked).filter(function(r){return !params.status||r.status===params.status;}).sort(function(a,b){return String(a.appointment_date||'').localeCompare(String(b.appointment_date||''))||String(a.appointment_time||'').localeCompare(String(b.appointment_time||''));});});
    },

    // ---------- Meta Auto Publisher (قسم ٤٣) ----------
    // إنشاء job نشر (مجدول أو فوري لو scheduledAt=الآن) — الـstatus بيتفرض
    // 'pending' سيرفريًا عن طريق RLS، مش من هنا. الـEdge Function
    // meta-publish-process (بمفتاح service_role، عن طريق pg_cron كل دقيقة)
    // هي الوحيدة اللي بتحدّث status/نتائج Meta بعد كده.
    createMetaPublishJob: function (payload) {
      return handle(client.from("meta_publish_jobs").insert({
        content_id: payload.contentId,
        brand: payload.brand,
        scheduled_at: payload.scheduledAt,
        publish_facebook: !!payload.publishFacebook,
        publish_instagram: !!payload.publishInstagram,
        created_by: payload.createdBy || null
      }).select().single());
    },
    // أحدث job لكل مادة من مجموعة IDs — للعرض في تاب النشر (حالة/نتيجة/خطأ)
    listMetaPublishJobsForContent: function (contentIds) {
      if (!contentIds || !contentIds.length) return Promise.resolve([]);
      return handle(client.from("meta_publish_jobs").select("*")
        .in("content_id", contentIds).order("created_at", { ascending: false }));
    },
    // إلغاء job لسه pending — الـRLS بتمنع أي حالة تانية غير 'cancelled' هنا
    cancelMetaPublishJob: function (id) {
      return handle(client.from("meta_publish_jobs").update({ status: "cancelled" }).eq("id", id).select().single());
    },

    createTikTokPublishJob: function (payload) {
      return handle(client.from("tiktok_publish_jobs").insert({
        content_id:payload.contentId,brand:payload.brand,scheduled_at:payload.scheduledAt,
        privacy_level:payload.privacyLevel,disable_comment:!!payload.disableComment,
        disable_duet:!!payload.disableDuet,disable_stitch:!!payload.disableStitch,
        commercial_content:!!payload.commercialContent,your_brand:!!payload.yourBrand,
        branded_content:!!payload.brandedContent,music_confirmation:!!payload.musicConfirmation,
        created_by:payload.createdBy||null
      }).select().single());
    },
    listTikTokPublishJobsForContent: function (contentIds) {
      if(!contentIds||!contentIds.length)return Promise.resolve([]);
      return handle(client.from("tiktok_publish_jobs").select("*").in("content_id",contentIds).order("created_at",{ascending:false}));
    },
    cancelTikTokPublishJob: function (id) {
      return handle(client.from("tiktok_publish_jobs").update({status:"cancelled"}).eq("id",id).select().single());
    },
    tiktokRequest: function(payload) {
      return client.functions.invoke("tiktok-auth",{body:payload}).then(function(r){if(r.error)throw r.error;if(r.data&&r.data.error)throw new Error(r.data.error);return r.data||{};});
    },
    tiktokConnection: function(brand){return this.tiktokRequest({op:"connection",brand:brand});},
    tiktokCreatorInfo: function(brand){return this.tiktokRequest({op:"creator_info",brand:brand});},
    tiktokConnect: function(brand){return this.tiktokRequest({op:"connect",brand:brand});},

    // ---------- مراجعة طلبات تفعيل بوابة المرضى ----------
    patientVerificationRequest: function (payload) {
      return client.functions.invoke("patient-verification-review", { body: payload }).then(function (res) {
        if (res.error) throw res.error;
        return res.data || {};
      });
    },
    listPatientIdentityVerifications: function (status) {
      return this.patientVerificationRequest({ op: "list", status: status || "pending" })
        .then(function (r) { return r.items || []; });
    },
    approvePatientIdentityVerification: function (verificationId) {
      return this.patientVerificationRequest({ op: "approve", verification_id: verificationId });
    },
    rejectPatientIdentityVerification: function (verificationId, reason) {
      return this.patientVerificationRequest({ op: "reject", verification_id: verificationId, reason: reason || null });
    },
    resendPatientActivation: function (verificationId) {
      return this.patientVerificationRequest({ op: "resend_activation", verification_id: verificationId });
    },
    revokePatientAccountAccess: function (accessId, reason) {
      return this.patientVerificationRequest({ op: "revoke", access_id: accessId, reason: reason || null });
    },
    getPatientVerificationDocumentUrl: function (documentId) {
      return this.patientVerificationRequest({ op: "document_url", document_id: documentId })
        .then(function (r) { return r.url; });
    },

    // ---------- realtime ----------
    subscribeTable: function (table, onChange) {
      var channel = client
        .channel("ssmpd-" + table + "-" + Math.random().toString(36).slice(2))
        .on("postgres_changes", { event: "*", schema: "public", table: table }, function (payload) { if (table === "leads") invalidateRegistration(); onChange(payload); })
        .subscribe();
      return channel;
    },
    unsubscribe: function (channel) {
      if (channel) client.removeChannel(channel);
    },

    bookingMessageResolve: function(id,decision,confirmed,note){return handle(client.rpc('clinic_booking_message_resolve',{p_id:id,p_decision:decision,p_confirmed:confirmed,p_note:note}));},
    financeLegacyAsset: function(action,payload,token){return handle(client.rpc('clinic_finance_legacy_asset',{p_action:action,p_payload:payload,p_token:token}));},
    bookingCommand: function(action,payload,token){return handle(client.rpc('clinic_booking_command',{p_action:action,p_payload:payload,p_token:token}));},
    bookingShift: function(action,payload,token){return handle(client.rpc('clinic_booking_shift',{p_action:action,p_payload:payload,p_token:token}));},
    bookingSnapshot: function(from,to){return handle(client.rpc('clinic_booking_snapshot',{p_from:from,p_to:to}));},
    financeTreasuryCommand:function(action,payload,token){return handle(client.rpc('clinic_finance_treasury_command',{p_action:action,p_payload:payload,p_token:token}));},
    financeLedgerCommand:function(action,payload,token){return handle(client.rpc('clinic_finance_ledger_command',{p_action:action,p_payload:payload,p_token:token}));},
    financeEntryOrigin:function(id){return handle(client.rpc('clinic_finance_entry_origin',{p_entry:id}));},
    financeManualCommand: function(action,payload,token){return handle(client.rpc('clinic_finance_manual_command',{p_action:action,p_payload:payload,p_token:token}));},
    financeBusinessCommand: function(action,payload,token){return handle(client.rpc('clinic_finance_business_command',{p_action:action,p_payload:payload,p_token:token}));},
    financeReconciliationTask:function(row,assignee,due,note,token){return handle(client.rpc('clinic_finance_reconciliation_task',{p_row:row,p_assignee:assignee,p_due:due,p_note:note,p_token:token}));},
    financeReconciliationMatch:function(row,lines,note,token){return handle(client.rpc('clinic_finance_reconciliation_match',{p_row:row,p_lines:lines,p_note:note,p_token:token}));},
    financeReconciliationReport:function(id){return handle(client.rpc('clinic_finance_reconciliation_report',{p_statement:id}));},
    financeBankCommand: function(action,payload,token){return handle(client.rpc('clinic_finance_bank_command',{p_action:action,p_payload:payload,p_token:token}));},
    financeSupplierReceive: function(order,lines,reference,token,invoiceDate,documentUrl){if(invoiceDate)return handle(client.rpc('inventory_receive_invoice',{p_order:order,p_lines:lines,p_reference:reference,p_token:token,p_invoice_date:invoiceDate,p_document_url:documentUrl||''}));return handle(client.rpc('clinic_finance_supplier_receive',{p_order:order,p_lines:lines,p_reference:reference,p_token:token}));},
    financeSupplierCommand: function(action,payload,token){return handle(client.rpc('clinic_finance_supplier_command',{p_action:action,p_payload:payload,p_token:token}));},
    financeDoctorCommand: function(action,payload,token){return handle(client.rpc('clinic_finance_doctor_command',{p_action:action,p_payload:payload,p_token:token}));},
    financeBill: function(payload,token){return handle(client.rpc('clinic_finance_bill',{p_payload:payload,p_token:token}));},
    financeCaseStep: function(id,step,note,responsibility,person,decision){return handle(client.rpc('clinic_finance_case_step',{p_id:id,p_step:step,p_note:note,p_responsibility:responsibility,p_person:person,p_decision:decision}));},
    financeInsuranceClaim: function(invoice,reference,insurer,amount,token){return handle(client.rpc('clinic_finance_insurance_claim',{p_invoice:invoice,p_reference:reference,p_insurer:insurer,p_amount:amount,p_token:token}));},
    financeInsuranceAction: function(payload,token){return handle(client.rpc('clinic_finance_insurance_action',{p_payload:payload,p_token:token}));},
    financeInsuranceReview: function(id,approve,note){return handle(client.rpc('clinic_finance_insurance_review',{p_id:id,p_approve:approve,p_note:note}));},
    pricingDoctorContracts: function(){return handle(client.rpc('pricing_doctor_contracts',{}));},
    financeAccountStatement: function(code,from,to,children,register,offset,limit,asof){return handle(client.rpc('clinic_finance_account_statement',{p_code:code||null,p_from:from,p_to:to,p_children:children!==false,p_register:register||null,p_offset:offset||0,p_limit:limit||200,p_asof:asof==null?null:asof}));},
    financeCashVouchers: function(from,to,offset){return handle(client.rpc('clinic_finance_cash_vouchers',{p_from:from,p_to:to,p_offset:offset||0}));},
    financeCashVoucherCommand: function(action,payload,token){return handle(client.rpc('clinic_finance_cash_voucher_command',{p_action:action,p_payload:payload,p_token:token}));},
    financeSnapshot: function(from,to,offset){return handle(client.rpc('clinic_finance_snapshot',{p_from:from,p_to:to,p_offset:offset||0}));},
    financeSaveRegister: function(id,name,limit,mode){return handle(client.rpc('clinic_finance_save_register',{p_id:id,p_name:name,p_limit:limit,p_mode:mode}));},
    receptionLinks: function(workspace){return handle(client.rpc("clinic_reception_links",{p_workspace:workspace}));},
    receptionDirectory: function(workspace,term){return handle(client.rpc("clinic_reception_directory",{p_workspace:workspace,p_term:term}));},
    receptionMasters: function(workspace){return handle(client.rpc("clinic_reception_masters",{p_workspace:workspace}));},
    receptionIndicatorPublication: function(workspace,action,payload){return handle(client.rpc("clinic_reception_indicator_publication",{p_workspace:workspace,p_action:action,p_payload:payload||{}}));},
    receptionPrepareLead: function(lead,details){return handle(client.rpc("clinic_reception_prepare_lead",{p_lead:lead,p_details:details||{}}));},
    receptionPatientLeads: function(workspace,patient){return handle(client.rpc("clinic_reception_patient_leads",{p_workspace:workspace,p_patient:patient}));},
    receptionSharedRecords: function(context,id,from,to,offset){return handle(client.rpc("clinic_reception_shared_records",{p_context:context,p_id:id||null,p_from:from||null,p_to:to||null,p_offset:offset||0}));},
    receptionIndicatorExport: function(workspace,from,to){return handle(client.rpc("clinic_reception_indicator_export",{p_workspace:workspace,p_from:from,p_to:to}));},
    receptionFinanceOverview: function(from,to){return handle(client.rpc("clinic_reception_finance_overview",{p_from:from,p_to:to}));},
    receptionMarketing: function(workspace,from,to){return handle(client.rpc("clinic_reception_marketing",{p_workspace:workspace,p_from:from,p_to:to}));},
    receptionReport: function(workspace,from,to){return handle(client.rpc("clinic_reception_report",{p_workspace:workspace,p_from:from,p_to:to}));},
    receptionWorkspaces: function(){return handle(client.rpc("clinic_reception_workspaces",{}));},
    receptionBootstrap: function(){return handle(client.rpc("clinic_reception_bootstrap",{}));},
    receptionCatalogIssues: function(){return handle(client.rpc("clinic_reception_catalog_issues",{}));},
    receptionSnapshot: function(workspace,from,to){return handle(client.rpc("clinic_reception_snapshot",{p_workspace:workspace,p_from:from,p_to:to}));},
    receptionCommand: function(workspace,action,payload,token){return handle(client.rpc("clinic_reception_command",{p_workspace:workspace,p_action:action,p_payload:payload,p_token:token}));},
    financeRegister: function(name,limit){return handle(client.rpc('clinic_finance_register',{p_name:name,p_limit:limit}));},
    financeOpenShift: function(register,token){return handle(client.rpc('clinic_finance_open_shift',{p_register:register,p_token:token}));},
    financeInvoice: function(reference,patient,description,amount,token){return handle(client.rpc('clinic_finance_invoice',{p_reference:reference,p_patient_ref:patient,p_description:description,p_amount:amount,p_token:token}));},
    financeCollect: function(invoice,shift,method,amount,reference,token,patientFile,visit){if(patientFile!==undefined)return handle(client.rpc('clinic_finance_collect_linked',{p_invoice:invoice,p_shift:shift,p_method:method,p_amount:amount,p_reference:reference,p_token:token,p_patient_file:patientFile,p_visit:visit}));return handle(client.rpc('clinic_finance_collect',{p_invoice:invoice,p_shift:shift,p_method:method,p_amount:amount,p_reference:reference,p_token:token}));},
    financeRequest: function(payload,token){return handle(client.rpc('clinic_finance_request',{p_payload:payload,p_token:token}));},
    financeReviewRequest: function(id,approve,note){return handle(client.rpc('clinic_finance_review_request',{p_id:id,p_approve:approve,p_note:note}));},
    financeCloseShift: function(shift,counts,note){return handle(client.rpc('clinic_finance_close_shift',{p_shift:shift,p_counts:counts,p_note:note}));},
    financeReviewShift: function(shift,note){return handle(client.rpc('clinic_finance_review_shift',{p_shift:shift,p_note:note}));},
    financeClosePeriod: function(through){return handle(client.rpc('clinic_finance_close_period',{p_through:through}));},
    // ---------- الحسابات (Accounting): تسعير الخدمات + الباكجز ----------
    listPricingSupplies: function () {
      return handle(client.from("pricing_supplies").select("*").order("name", { ascending: true }));
    },
    savePricingSupply: function (patch, createdBy) {
      var row = Object.assign({}, patch, { updated_at: new Date().toISOString() });
      if (patch && patch.id) {
        var id = patch.id;
        delete row.id;
        return handle(client.from("pricing_supplies").update(row).eq("id", id).select().single());
      }
      row.created_by = createdBy;
      return handle(client.from("pricing_supplies").insert(row).select().single());
    },
    deletePricingSupply: function (id) {
      return handle(client.from("pricing_supplies").delete().eq("id", id));
    },
    listPricingServices: function () {
      return handle(client.from("pricing_services").select("*").order("name", { ascending: true }));
    },
    savePricingService: function (patch, createdBy) {
      var row = Object.assign({}, patch, { updated_at: new Date().toISOString() });
      if (patch && patch.id) {
        var id = patch.id;
        delete row.id;
        return handle(client.from("pricing_services").update(row).eq("id", id).select().single());
      }
      row.created_by = createdBy;
      return handle(client.from("pricing_services").insert(row).select().single());
    },
    deletePricingService: function (id) {
      return handle(client.from("pricing_services").delete().eq("id", id));
    },
    listPricingPackages: function () {
      return handle(client.from("pricing_packages").select("*").order("name", { ascending: true }));
    },
    savePricingPackage: function (patch, createdBy) {
      var row = Object.assign({}, patch, { updated_at: new Date().toISOString() });
      if (patch && patch.id) {
        var id = patch.id;
        delete row.id;
        return handle(client.from("pricing_packages").update(row).eq("id", id).select().single());
      }
      row.created_by = createdBy;
      return handle(client.from("pricing_packages").insert(row).select().single());
    },
    deletePricingPackage: function (id) {
      return handle(client.from("pricing_packages").delete().eq("id", id));
    },
    operationsReports: function () { return handle(client.from("operational_reports").select("id,title,branch,scope,period_from,period_to,source_approved_at").order("period_to",{ascending:false}).order("source_approved_at",{ascending:false}).limit(100)); },
    operationsReport: function (id) { return handle(client.from("operational_reports").select("*").eq("id",id).single()); },
    operationsIssues: function () { return handle(client.from("operational_issues").select("id,title,branch,scope,status,appearance_count,updated_at").order("updated_at",{ascending:false}).limit(300)); },
    operationsIssueDetail: function (id) { return handle(client.rpc("operations_issue_detail",{p_issue_id:id})); },
    operationsCreateAction: function (args) { return handle(client.rpc("operations_create_action",args)); },
    operationsRecordOutcome: function (args) { return handle(client.rpc("operations_record_outcome",args)); },
    operationsTaskContext: function (id) { return handle(client.rpc("operations_task_context",{p_task_id:id})); },
    operationsContentBrief: function (brand,specialty) { return handle(client.rpc("operations_content_brief",{p_brand:brand,p_specialty:specialty||""})); },
    operationsAIEnabled: function () { return handle(client.rpc("operations_ai_enabled")).then(function(v){return v===true;}).catch(function(){return false;}); },
    operationsAdvice: function (id) { return client.functions.invoke("operations-advisor",{body:{issue_id:id}}).then(function(r){if(r.error||r.data?.error)throw Error(r.data?.error||"تعذر تشغيل المستشار. تحقق من التفعيل والرصيد.");return r.data;}); },
    employeeTaskPerformance: function(period,from,to,admin) { return handle(client.rpc("employee_task_performance",{p_period:period,p_from:from,p_to:to,p_admin:admin})); },
    taskListProjects: function () { return handle(client.rpc("task_list_projects")); },
    taskListVisible: function () { return handle(client.rpc("task_list_with_assignment")); },
    taskPeople: function () { return handle(client.rpc("task_people")); },
    taskListNotifications: function () {
      return handle(client.from("task_notifications").select("*").eq("recipient_id", window.SSMPDAuth.currentAdmin.id).order("created_at", { ascending: false }).limit(40));
    },
    taskRefreshOverdue: function () { return handle(client.rpc("task_refresh_overdue_notifications")); },
    taskCreateProject: function (title, description, managerId, members) {
      return handle(client.rpc("task_create_project", { p_title:title, p_description:description || "", p_manager_id:managerId, p_members:members || [] }));
    },
    taskUpdateProject: function (projectId, title, description, managerId, members) {
      return handle(client.rpc("task_update_project", { p_project_id:projectId, p_title:title, p_description:description || "", p_manager_id:managerId, p_members:members || [] }));
    },
    taskCreate: function (projectId, parentId, title, description, expectedOutput, assigneeId, dueAt, priority) {
      return handle(client.rpc("task_create", { p_project_id:projectId, p_parent_task_id:parentId, p_title:title, p_description:description || "", p_expected_output:expectedOutput || "", p_assignee_id:assigneeId, p_due_at:dueAt, p_priority:priority || "normal" }));
    },
    taskCreateRecurring: function (projectId, parentId, title, description, expectedOutput, assigneeId, dueAt, priority, intervalValue, intervalUnit, endsAt) {
      return handle(client.rpc("task_create_recurring", { p_project_id:projectId, p_parent_task_id:parentId, p_title:title, p_description:description || "", p_expected_output:expectedOutput || "", p_assignee_id:assigneeId, p_due_at:dueAt, p_priority:priority || "normal", p_interval_value:intervalValue, p_interval_unit:intervalUnit, p_ends_at:endsAt || null }));
    },
    taskSetOrder: function (taskIds) { return handle(client.rpc("task_set_order", { p_task_ids: taskIds || [] })); },
    taskDelete: function (taskId) { return handle(client.rpc("task_delete", { p_task_id: taskId })); },
    taskDeleteProject: function (projectId) { return handle(client.rpc("task_delete_project", { p_project_id: projectId })); },
    taskUpdateDetails: function (taskId, title, description, expectedOutput, assigneeId, dueAt, priority, repeatActive, intervalValue, intervalUnit, endsAt, updateFuture) {
      return handle(client.rpc("task_update_details", { p_task_id:taskId, p_title:title, p_description:description || "", p_expected_output:expectedOutput || "", p_assignee_id:assigneeId, p_due_at:dueAt, p_priority:priority || "normal", p_repeat_active:repeatActive, p_interval_value:intervalValue, p_interval_unit:intervalUnit, p_ends_at:endsAt || null, p_update_future:!!updateFuture }));
    },
    taskWorkResults: function (id) { return handle(client.from("task_work_results").select("id,request_id,body,link,attachments,status,created_at").eq("task_id",id).order("created_at",{ascending:false}).limit(30)); },
    taskSubmitWork: function (r) { return handle(client.rpc("task_submit_work",{p_task_id:r.task_id,p_request_id:r.request_id,p_status:r.status,p_body:r.body,p_link:r.link,p_attachments:r.attachments})); },
    taskSetStatus: function (taskId, status, note) {
      return handle(client.rpc("task_set_status", { p_task_id:taskId, p_status:status, p_note:note }));
    },
    taskReview: function (taskId, approve, note) {
      return handle(client.rpc("task_review", { p_task_id:taskId, p_approve:approve, p_note:note || "" }));
    },
    aiClipOverview: function (contentId) { return handle(client.rpc("ai_clip_overview", { p_content_id: contentId || null })); },
    aiClipRequest: function (contentId, prompt) { return handle(client.rpc("ai_clip_request", { p_content_id: contentId, p_prompt: prompt || null })); },
    aiClipCancel: function (id) { return handle(client.rpc("ai_clip_cancel", { p_id: id })); },
    aiClipSaveSettings: function (s) { return handle(client.rpc("ai_clip_save_settings", { p_enabled: !!s.enabled, p_auto: !!s.auto, p_budget_egp: s.budget, p_usd_to_egp: s.rate, p_model: s.model, p_seconds: s.seconds })); },
    taskChecklistList: function (taskId) { return handle(client.rpc("task_checklist_list", { p_task_id: taskId })); },
    taskChecklistCounts: function (ids) { return handle(client.rpc("task_checklist_counts", { p_task_ids: ids })); },
    taskChecklistAdd: function (taskId, body) { return handle(client.rpc("task_checklist_add", { p_task_id: taskId, p_body: body })); },
    taskChecklistToggle: function (id, done) { return handle(client.rpc("task_checklist_toggle", { p_id: id, p_done: !!done })); },
    taskChecklistRemove: function (id) { return handle(client.rpc("task_checklist_remove", { p_id: id })); },
    taskListUpdates: function (taskId) {
      return handle(client.from("task_updates").select("id,task_id,author_id,body,status_from,status_to,created_at").eq("task_id",taskId).order("created_at",{ascending:false}));
    },
    taskProjectArchives: function () { return handle(client.from("task_projects").select("id,archived_at")); },
    taskSetProjectArchived: function (projectId, on) {
      return handle(client.from("task_projects").update({ archived_at: on ? new Date().toISOString() : null }).eq("id", projectId));
    },
    // تعليق (+ مرفقات اختيارية) عن طريق الدالة اللي بترسل الإشعارات. لو الدالة لسه مش منشورة بنرجع للإدخال المباشر (من غير مرفقات).
    taskAddComment: function (taskId, body, attachments) {
      var atts = attachments || [], text = String(body || "").trim();
      return handle(client.rpc("task_add_comment", { p_task_id: taskId, p_body: text, p_attachments: atts })).catch(function (e) {
        if (atts.length || !/schema cache|could not find (the )?function/i.test(String(e && e.message || ""))) throw e;
        return handle(client.from("task_updates").insert({ task_id: taskId, author_id: window.SSMPDAuth.currentAdmin.id, body: text }));
      });
    },
    // الملف نفسه بيترفع على Google Drive (الأرشيف/مرفقات المهام)، والقاعدة بتحفظ الرابط بس
    taskUploadAttachment: function (taskId, file, taskTitle) {
      return window.SSMPDDrive.uploadTaskFile(file, { taskId: taskId, title: taskTitle || "" }).then(function (res) {
        var fid = res.fileId || res.id || "";
        var url = res.fileUrl || res.url || res.webViewLink || (fid ? "https://drive.google.com/file/d/" + fid + "/view" : "");
        if (!/^https:\/\/(drive|docs)\.google\.com\//.test(url)) throw new Error("الملف اترفع لكن جوجل درايف ما رجّعش رابط صالح — جرّب مرة تانية أو بلّغ الإدارة (الجسر محتاج إعادة نشر).");
        return { name: file.name, url: url, file_id: fid, size: file.size, mime: file.type || "" };
      });
    },
    taskListAttachments: function (taskId) {
      return handle(client.from("task_attachments").select("id,update_id,file_name,mime_type,size_bytes,file_url").eq("task_id", taskId));
    },
    taskMarkNotificationRead: function (id) {
      return handle(client.from("task_notifications").update({read_at:new Date().toISOString()}).eq("id",id).eq("recipient_id",window.SSMPDAuth.currentAdmin.id));
    },
  };

  ["taskCreate","taskCreateRecurring","taskUpdateDetails","taskSetStatus","taskSubmitWork","taskReview","taskDelete","taskDeleteProject","taskUpdateProject","taskSetProjectArchived"].forEach(function(name){var original=Db[name];if(!original)return;Db[name]=function(){return original.apply(Db,arguments).then(function(result){window.dispatchEvent(new Event("ssmpd-tasks-changed"));return result;});};});
  window.SSMPDDb = Db;

  // أسئلة استبيان "تقييم تجربة المريض" الرسمي — نفس الترتيب والنص بالحرف من
  // نموذج "استبيان سعادة الزوار" الورقي، مستخدمة في render-patients.js
  // (سكشن ملف المريض) وrender-leads.js (تاب "تقييمات العملاء") الاتنين
  window.SSMPDExperienceQuestions = [
    "كيف كانت تجربتك في التعامل مع طاقم الاستقبال؟",
    "كيف تقيم تواصل الطبيب واحترافيته؟",
    "هل شرح لك الطبيب حالتك والعلاج بشكل واضح؟",
    "ما مدى رضاك عن جودة الخدمة بشكل عام؟",
    "من وجهة نظرك هل كانت تكلفة الخدمة مناسبة؟",
    "إلى أي مدى قد ترشح عيادات سونو لعائلتك وأصدقائك؟"
  ];
})();



