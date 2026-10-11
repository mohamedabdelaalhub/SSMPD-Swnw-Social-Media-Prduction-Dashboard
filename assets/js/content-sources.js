/* SSMPD — المصادر الطبية للمحتوى.
   البيانات بتسافر جوه content_items.agent_raw_output (JSON) زي بريف الكاروسيل ودينا — من غير أعمدة جديدة:
     sources: [{name,title,url,type,is_primary}]  ·  cover_source_text: "المصدر الطبي للمحتوى: NHS"
   المحتوى القديم من غير الحقلين شغال عادي (sources=[] و cover_source_text=""). */
(function () {
  "use strict";
  var MAX_SOURCES = 8;
  var PREFIX = "المصدر الطبي للمحتوى: ";

  function str(value, max) {
    return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
  }
  function httpsUrl(value) {
    var text = str(value, 500);
    if (!text) return "";
    try { var url = new URL(text); return url.protocol === "https:" ? url.href : ""; } catch (e) { return ""; }
  }
  function truthy(value) { return value === true || value === "true" || value === 1 || value === "1"; }

  function cleanSources(list) {
    if (!Array.isArray(list)) return [];
    var out = [], seen = {};
    list.forEach(function (row) {
      if (!row || typeof row !== "object" || out.length >= MAX_SOURCES) return;
      var source = { name: str(row.name, 80), title: str(row.title, 200), url: httpsUrl(row.url), type: str(row.type, 40), is_primary: truthy(row.is_primary) };
      if (!source.name && !source.url) return;
      var key = source.url || source.name.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      out.push(source);
    });
    var primaryAt = -1;
    out.forEach(function (source, index) { if (source.is_primary && primaryAt < 0) primaryAt = index; else source.is_primary = false; });
    return out;
  }
  function cleanCover(value) { return str(value, 120); }
  function primary(sources) {
    var list = cleanSources(sources);
    return list.filter(function (s) { return s.is_primary; })[0] || list[0] || null;
  }
  function defaultCover(sources) {
    var main = primary(sources);
    return main && main.name ? PREFIX + main.name : "";
  }

  function parseRaw(raw) {
    if (raw && typeof raw === "object") return Array.isArray(raw) ? null : raw;
    if (typeof raw !== "string" || !raw.trim()) return null;
    try { var parsed = JSON.parse(raw); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null; } catch (e) { return null; }
  }
  function fromRaw(raw) {
    var obj = parseRaw(raw) || {};
    return { sources: cleanSources(obj.sources), cover_source_text: cleanCover(obj.cover_source_text) };
  }
  function fromItem(item) { return fromRaw(item && item.agent_raw_output); }

  // النص اللي يتحط على التصميم: image_post فقط. الكاروسيل بيتصمم برا (كفر فقط) والفيديو مفيهوش مصدر بصري.
  function designText(item) {
    if (!item || item.content_format !== "image_post") return "";
    return fromItem(item).cover_source_text;
  }

  // بيدمج الحقلين في agent_raw_output الحالي من غير ما يمس باقي المفاتيح. لو القيمة القديمة نص حر نحفظه كما هو.
  function merge(agentRaw, sources, cover) {
    var obj = parseRaw(agentRaw);
    if (!obj) obj = typeof agentRaw === "string" && agentRaw.trim() ? { original_agent_output: agentRaw } : {};
    obj = Object.assign({}, obj);
    obj.sources = cleanSources(sources);
    obj.cover_source_text = cleanCover(cover);
    return JSON.stringify(obj);
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function link(source) {
    return source.url ? ' <a href="' + esc(source.url) + '" target="_blank" rel="noopener noreferrer">فتح المصدر ↗</a>' : "";
  }

  function viewHtml(data, editable) {
    var main = primary(data.sources);
    var body;
    if (!main) {
      body = '<p style="font-size:12px;color:var(--c-muted);margin:0;">لا يوجد مصدر طبي لهذه المادة.</p>';
    } else {
      body = '<div style="margin-bottom:6px;"><b>' + esc(main.name || "—") + "</b>" + (main.title ? " — " + esc(main.title) : "") + link(main) + "</div>";
      var others = data.sources.filter(function (s) { return s !== main; });
      if (others.length) {
        body += '<div style="font-size:12px;color:var(--c-muted);margin-bottom:4px;">مصادر أخرى:</div><ul style="margin:0 0 6px;padding-inline-start:18px;font-size:12px;">' +
          others.map(function (s) { return "<li>" + esc(s.name || "—") + (s.title ? " — " + esc(s.title) : "") + link(s) + "</li>"; }).join("") + "</ul>";
      }
    }
    var cover = data.cover_source_text
      ? '<div style="font-size:12px;margin-top:6px;">النص على التصميم: <b>' + esc(data.cover_source_text) + '</b> <span style="color:var(--c-muted);">(الرابط وعنوان الصفحة لا يظهرون على التصميم)</span></div>'
      : "";
    return body + cover + (editable ? '<div style="margin-top:8px;"><button type="button" class="btn ghost sm" data-src-edit>تعديل المصدر</button></div>' : "");
  }

  function rowHtml(source, index, isMain) {
    return '<div class="src-row" style="border:1px solid var(--c-border);border-radius:10px;padding:8px;margin-bottom:8px;">' +
      '<div class="field"><label>اسم المصدر</label><input data-src="name" value="' + esc(source.name) + '" maxlength="80"></div>' +
      '<div class="field"><label>عنوان الصفحة أو الدراسة</label><input data-src="title" value="' + esc(source.title) + '" maxlength="200"></div>' +
      '<div class="field"><label>الرابط (https)</label><input data-src="url" type="url" dir="ltr" value="' + esc(source.url) + '"></div>' +
      '<label style="font-size:12px;margin-inline-end:12px;"><input type="radio" name="src-primary" data-src="primary"' + (isMain ? " checked" : "") + '> مصدر أساسي</label>' +
      '<button type="button" class="btn ghost sm" data-src-remove>حذف</button></div>';
  }

  function mount(host, item, options) {
    if (!host) return;
    options = options || {};
    var editable = !!options.editable;
    var data = fromItem(item);

    function show() {
      host.innerHTML = viewHtml(data, editable);
      var edit = host.querySelector("[data-src-edit]");
      if (edit) edit.onclick = form;
    }

    function form() {
      var main = primary(data.sources);
      var rows = data.sources.length ? data.sources : [{ name: "", title: "", url: "", type: "", is_primary: true }];
      host.innerHTML = '<div data-src-rows>' + rows.map(function (s, i) { return rowHtml(s, i, s === main || (!main && i === 0)); }).join("") + "</div>" +
        '<button type="button" class="btn ghost sm" data-src-add>+ مصدر آخر</button>' +
        '<div class="field" style="margin-top:8px;"><label>النص الذي يظهر على التصميم (يُترك فارغًا لو المحتوى غير طبي)</label>' +
        '<input data-src-cover maxlength="120" value="' + esc(data.cover_source_text) + '" placeholder="' + esc(PREFIX + "NHS") + '"></div>' +
        '<p style="font-size:11px;color:var(--c-muted);margin:0 0 8px;">الرابط وعنوان الصفحة للعرض هنا فقط ولا يظهرون على التصميم.</p>' +
        '<div style="display:flex;gap:8px;"><button type="button" class="btn sm" data-src-save>حفظ المصدر</button><button type="button" class="btn ghost sm" data-src-cancel>إلغاء</button></div>';
      var list = host.querySelector("[data-src-rows]");
      function wireRow(row) { row.querySelector("[data-src-remove]").onclick = function () { row.remove(); }; }
      list.querySelectorAll(".src-row").forEach(wireRow);
      host.querySelector("[data-src-add]").onclick = function () {
        var holder = document.createElement("div");
        holder.innerHTML = rowHtml({ name: "", title: "", url: "", type: "", is_primary: false }, 0, false);
        var row = holder.firstChild; list.appendChild(row); wireRow(row);
      };
      host.querySelector("[data-src-cancel]").onclick = show;
      host.querySelector("[data-src-save]").onclick = function () {
        var rawRows = Array.prototype.map.call(list.querySelectorAll(".src-row"), function (row, i) {
          var get = function (k) { return row.querySelector('[data-src="' + k + '"]').value; };
          return { name: get("name"), title: get("title"), url: get("url"), type: (rows[i] && rows[i].type) || "medical_authority", is_primary: row.querySelector('[data-src="primary"]').checked };
        });
        var badUrl = rawRows.some(function (r) { return String(r.url || "").trim() && !httpsUrl(r.url); });
        if (badUrl) { alert("الرابط لازم يبدأ بـ https:// ويكون صحيحًا."); return; }
        var sources = cleanSources(rawRows);
        var cover = cleanCover(host.querySelector("[data-src-cover]").value);
        if (sources.length && !cover) cover = defaultCover(sources);
        var save = host.querySelector("[data-src-save]");
        save.disabled = true;
        var merged = merge(item.agent_raw_output, sources, cover);
        window.SSMPDDb.updateContentItem(item.id, { agent_raw_output: merged }).then(function () {
          item.agent_raw_output = merged;
          data = fromItem(item);
          if (window.SSMPDToast) window.SSMPDToast.show("تم حفظ المصدر الطبي", "success");
          if (options.onSaved) options.onSaved(item);
          show();
        }).catch(function (e) { save.disabled = false; alert("خطأ: " + e.message); });
      };
    }
    show();
  }

  function sectionHtml(item) {
    return '<div class="section" style="margin-top:10px;" data-src-section><h4 style="font-size:13px;margin-bottom:8px;">المصدر الطبي</h4><div data-src-host></div></div>';
  }
  function wireSection(container, item, me, extraEditable) {
    var host = container && container.querySelector("[data-src-host]");
    if (!host) return;
    var W = window.SSMPDWorkflow;
    var editable = !!(me && ((W && W.canEditItem && W.canEditItem(me, item)) || (window.SSMPDRoles && window.SSMPDRoles.hasAnyRole(me, ["approver"])) || extraEditable));
    mount(host, item, { editable: editable });
  }

  window.SSMPDSources = {
    PREFIX: PREFIX, clean: cleanSources, cleanCover: cleanCover, primary: primary, defaultCover: defaultCover,
    fromRaw: fromRaw, fromItem: fromItem, designText: designText, merge: merge, mount: mount, sectionHtml: sectionHtml, wireSection: wireSection
  };
})();
