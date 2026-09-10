(function(){
  "use strict";
  if(!window.SSMPDDb || window.__swnwVisitContextFixLoaded) return;
  window.__swnwVisitContextFixLoaded = true;

  var Db = window.SSMPDDb;
  var pendingEditVisitId = null;
  var pendingViewVisitId = null;

  var TYPE_OPTIONS = [
    ["checkup","كشف"],
    ["follow_up","متابعة"],
    ["emergency","طوارئ"],
    ["session","جلسة"],
    ["lab","تحليل"],
    ["radiology","أشعة"],
    ["home_visit","زيارة منزلية"]
  ];

  function esc(v){
    return String(v == null ? "" : v)
      .replace(/&/g,"&amp;")
      .replace(/</g,"&lt;")
      .replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;");
  }

  function activeVisitModal(){
    var save = document.getElementById("vs-save");
    return save && save.closest(".modal-backdrop");
  }

  function visitContextFromDom(){
    var modal = activeVisitModal();
    if(!modal) return null;
    var type = modal.querySelector("#vs-encounter-type");
    var doctor = modal.querySelector("#vs-doctor-name");
    var specialty = modal.querySelector("#vs-specialty");
    if(!type || !doctor || !specialty) return null;
    return {
      encounter_type: type.value || "checkup",
      doctor_name: doctor.value.trim() || null,
      specialty: specialty.value.trim() || null
    };
  }

  function clinicalTypeNeedsProvider(type){
    return ["checkup","follow_up","emergency","session","home_visit"].indexOf(type) >= 0;
  }

  function enrichVisitPatch(patch){
    var ctx = visitContextFromDom();
    if(!ctx) return { patch: patch, error: null };
    if(clinicalTypeNeedsProvider(ctx.encounter_type) && (!ctx.doctor_name || !ctx.specialty)){
      return { patch: patch, error: "اكتب اسم الطبيب / مقدم الخدمة والتخصص داخل الزيارة." };
    }
    return { patch: Object.assign({}, patch || {}, ctx), error: null };
  }

  var originalAdd = Db.addPatientVisit;
  if(typeof originalAdd === "function"){
    Db.addPatientVisit = function(patientId, visit, createdBy){
      var x = enrichVisitPatch(visit);
      if(x.error) return Promise.reject(new Error(x.error));
      return originalAdd.call(Db, patientId, x.patch, createdBy);
    };
  }

  var originalUpdate = Db.updatePatientVisit;
  if(typeof originalUpdate === "function"){
    Db.updatePatientVisit = function(visitId, patch){
      var x = enrichVisitPatch(patch);
      if(x.error) return Promise.reject(new Error(x.error));
      return originalUpdate.call(Db, visitId, x.patch);
    };
  }

  function addLegacyNotice(modal, anchor){
    if(modal.querySelector(".visit-context-note")) return;
    var note = document.createElement("div");
    note.className = "visit-context-note";
    note.style.cssText = "padding:9px 11px;margin:0 0 10px;border:1px solid #d7e2f2;border-radius:10px;background:#f7faff;color:#51627d;font-size:12px;line-height:1.7;";
    note.textContent = "الطبيب والتخصص مرتبطان بكل زيارة بشكل مستقل، وليس بالملف الطبي كله.";
    anchor.insertAdjacentElement("beforebegin", note);
  }

  function enhanceVisitForm(modal){
    var save = modal.querySelector("#vs-save");
    if(!save || modal.dataset.visitContextReady === "1") return;
    modal.dataset.visitContextReady = "1";

    var number = modal.querySelector("#vs-number");
    var anchor = number && number.closest(".field");
    if(!anchor) return;

    var wrap = document.createElement("div");
    wrap.className = "visit-context-fields";
    wrap.style.cssText = "border:1px solid #dce5f2;background:#fbfdff;border-radius:12px;padding:10px;margin:8px 0 12px;";
    wrap.innerHTML =
      '<div class="field"><label>نوع الزيارة / الخدمة</label><select id="vs-encounter-type">' +
      TYPE_OPTIONS.map(function(o){return '<option value="'+o[0]+'">'+o[1]+'</option>';}).join("") +
      '</select></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      '<div class="field" style="flex:1;min-width:190px;"><label>الطبيب / مقدم الخدمة</label><input id="vs-doctor-name" placeholder="مثال: د. دينا حسني"></div>' +
      '<div class="field" style="flex:1;min-width:190px;"><label>التخصص / القسم</label><input id="vs-specialty" placeholder="مثال: مخ وأعصاب"></div>' +
      '</div>';
    anchor.insertAdjacentElement("afterend", wrap);

    var type = wrap.querySelector("#vs-encounter-type");
    var doctor = wrap.querySelector("#vs-doctor-name");
    var specialty = wrap.querySelector("#vs-specialty");

    function syncLabels(){
      var clinical = clinicalTypeNeedsProvider(type.value);
      doctor.required = clinical;
      specialty.required = clinical;
      doctor.closest(".field").querySelector("label").textContent = clinical ? "الطبيب / مقدم الخدمة" : "الطبيب / مقدم الخدمة (اختياري)";
      specialty.closest(".field").querySelector("label").textContent = clinical ? "التخصص / القسم" : "التخصص / القسم (اختياري)";
    }
    type.onchange = syncLabels;
    syncLabels();

    if(pendingEditVisitId && Db.client){
      var id = pendingEditVisitId;
      Db.client.from("patient_visits")
        .select("patient_id,doctor_name,specialty,encounter_type")
        .eq("id", id)
        .maybeSingle()
        .then(function(res){
          if(res.error || !res.data || !document.body.contains(modal)) return;
          type.value = res.data.encounter_type || "checkup";
          doctor.value = res.data.doctor_name || "";
          specialty.value = res.data.specialty || "";
          syncLabels();

          // Legacy visits were created before doctor/specialty moved onto the visit row.
          // Use the old profile values only as an editable suggestion; never save them automatically.
          if((!doctor.value || !specialty.value) && res.data.patient_id){
            Db.client.from("patient_medical_profile")
              .select("treating_doctor,specialty")
              .eq("patient_id", res.data.patient_id)
              .maybeSingle()
              .then(function(profileRes){
                if(profileRes.error || !profileRes.data || !document.body.contains(modal)) return;
                if(!doctor.value) doctor.value = profileRes.data.treating_doctor || "";
                if(!specialty.value) specialty.value = profileRes.data.specialty || "";
              });
          }
        });
    }
  }

  function hideLegacyProfileFields(modal){
    var doctor = modal.querySelector("#mp-doctor");
    var specialty = modal.querySelector("#mp-specialty");
    if(doctor && specialty){
      var df = doctor.closest(".field");
      var sf = specialty.closest(".field");
      if(df) df.style.display = "none";
      if(sf) sf.style.display = "none";
      var firstVisible = modal.querySelector("#mp-bp");
      if(firstVisible){
        var row = firstVisible.closest("div[style*='display:flex']") || firstVisible.closest(".field");
        if(row) addLegacyNotice(modal, row);
      }
    }

    var npDoctor = modal.querySelector("#np-doctor");
    var npSpecialty = modal.querySelector("#np-specialty");
    if(npDoctor && npSpecialty){
      var ndf = npDoctor.closest(".field");
      var nsf = npSpecialty.closest(".field");
      if(ndf) ndf.style.display = "none";
      if(nsf) nsf.style.display = "none";
      var save = modal.querySelector("#np-save");
      if(save) addLegacyNotice(modal, save);
    }
  }

  function removeFixedProviderSummary(modal){
    modal.querySelectorAll("p").forEach(function(p){
      var txt = (p.textContent || "").trim();
      if(txt.indexOf("الطبيب المعالج:") === 0 && txt.indexOf("التخصص:") >= 0 && txt.indexOf("ضغط الدم:") >= 0){
        var parts = p.innerHTML.split(/<br\s*\/?\s*>/i);
        if(parts.length >= 3){
          p.innerHTML = parts.slice(2).join("<br>");
        }
      }
    });
  }

  function enhanceViewedVisit(modal){
    if(!pendingViewVisitId || modal.dataset.visitViewContextReady === "1") return;
    var txt = modal.textContent || "";
    if(txt.indexOf("رقم الزيارة") < 0 || txt.indexOf("خطة العلاج") < 0) return;
    modal.dataset.visitViewContextReady = "1";
    var id = pendingViewVisitId;
    if(!Db.client) return;
    Db.client.from("patient_visits")
      .select("doctor_name,specialty,encounter_type")
      .eq("id", id)
      .maybeSingle()
      .then(function(res){
        if(res.error || !res.data || !document.body.contains(modal)) return;
        var labels = {checkup:"كشف",follow_up:"متابعة",emergency:"طوارئ",session:"جلسة",lab:"تحليل",radiology:"أشعة",home_visit:"زيارة منزلية"};
        var info = document.createElement("div");
        info.style.cssText = "padding:9px 11px;margin:0 0 10px;border:1px solid #dce5f2;border-radius:10px;background:#f7faff;font-size:12px;line-height:1.8;";
        info.innerHTML = '<b>نوع الزيارة:</b> '+esc(labels[res.data.encounter_type] || "كشف")+' &nbsp; · &nbsp; <b>الطبيب / مقدم الخدمة:</b> '+esc(res.data.doctor_name || "—")+' &nbsp; · &nbsp; <b>التخصص:</b> '+esc(res.data.specialty || "—");
        var head = modal.querySelector(".modal-head");
        if(head) head.insertAdjacentElement("afterend", info);
      });
  }

  function enhanceBackdrop(backdrop){
    if(!backdrop || backdrop.nodeType !== 1) return;
    enhanceVisitForm(backdrop);
    hideLegacyProfileFields(backdrop);
    removeFixedProviderSummary(backdrop);
    enhanceViewedVisit(backdrop);
  }

  document.addEventListener("click", function(e){
    var edit = e.target && e.target.closest ? e.target.closest("[data-edit-visit]") : null;
    var view = e.target && e.target.closest ? e.target.closest("[data-view-visit]") : null;
    var add = e.target && e.target.closest ? e.target.closest("[data-add-visit]") : null;
    if(edit){ pendingEditVisitId = edit.getAttribute("data-edit-visit"); pendingViewVisitId = null; }
    else if(view){ pendingViewVisitId = view.getAttribute("data-view-visit"); pendingEditVisitId = null; }
    else if(add){ pendingEditVisitId = null; pendingViewVisitId = null; }
  }, true);

  var observer = new MutationObserver(function(mutations){
    mutations.forEach(function(m){
      Array.prototype.forEach.call(m.addedNodes || [], function(node){
        if(!node || node.nodeType !== 1) return;
        if(node.classList && node.classList.contains("modal-backdrop")) enhanceBackdrop(node);
      });
    });
  });
  // Patient modals are appended directly to body, so there is no need to observe the whole dashboard subtree.
  observer.observe(document.body, {childList:true, subtree:false});

  document.querySelectorAll(".modal-backdrop").forEach(enhanceBackdrop);
})();
