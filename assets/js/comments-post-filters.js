/* SSMPD — extra filters for social comments by classification and source post. */
(function () {
  "use strict";

  var filterState = { category: "", postRef: "" };
  var cache = null;
  var cacheAt = 0;
  var scheduled = false;
  var BRANDS = { sono: "سونو", dr_dina: "د. دينا" };
  var CATEGORY = {
    handoff: "محتاج حد من الفريق",
    general: "استفسار",
    medical_sensitive: "سؤال طبي",
    emergency: "طوارئ",
    complaint: "شكوى",
    thanks: "شكر",
    spam: "سبام"
  };

  function db() {
    return window.SSMPDDb && window.SSMPDDb.client;
  }

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function shortText(value, max) {
    var s = String(value || "").replace(/\s+/g, " ").trim();
    if (!s) return "بوست";
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  }

  function arabicDate(value) {
    if (!value) return "";
    try {
      return new Date(value).toLocaleDateString("ar-EG", { day: "numeric", month: "short" });
    } catch (e) {
      return "";
    }
  }

  function topComment(row) {
    return row && !row.author_is_page && !row.parent_comment_id;
  }

  function loadData(force) {
    var client = db();
    if (!client) return Promise.resolve({ rows: [], titles: {} });
    if (!force && cache && Date.now() - cacheAt < 60000) return Promise.resolve(cache);
    return Promise.all([
      client.from("social_comments").select("id,post_ref,content_id,job_id,brand,platform,category,commented_at,author_is_page,parent_comment_id").order("commented_at", { ascending: false }).limit(400),
      client.from("content_items").select("id,title")
    ]).then(function (r) {
      var titles = {};
      (r[1].error ? [] : (r[1].data || [])).forEach(function (item) { titles[item.id] = item.title || ""; });
      cache = { rows: r[0].error ? [] : (r[0].data || []), titles: titles };
      cacheAt = Date.now();
      return cache;
    }).catch(function () {
      return { rows: [], titles: {} };
    });
  }

  function selectHtml(id, value, options, className) {
    return '<select id="' + id + '" class="' + (className || "") + '">' + options.map(function (o) {
      return '<option value="' + esc(o.value) + '"' + (o.value === value ? " selected" : "") + '>' + esc(o.label) + '</option>';
    }).join("") + "</select>";
  }

  function baseRowsForCards(data, cards) {
    var ids = {};
    cards.forEach(function (card) { ids[card.getAttribute("data-id")] = 1; });
    return data.rows.filter(function (row) { return topComment(row) && ids[row.id]; });
  }

  function postKey(row) {
    return row.post_ref || "";
  }

  function postOptions(data, rows) {
    var groups = {};
    rows.forEach(function (row) {
      var key = postKey(row);
      if (!key) return;
      if (!groups[key]) groups[key] = { key: key, row: row, count: 0, latest: row.commented_at };
      groups[key].count += 1;
      if (new Date(row.commented_at) > new Date(groups[key].latest)) {
        groups[key].latest = row.commented_at;
        groups[key].row = row;
      }
    });
    var list = Object.keys(groups).map(function (key) { return groups[key]; }).sort(function (a, b) {
      return new Date(b.latest) - new Date(a.latest);
    });
    return [{ value: "", label: "كل البوستات" }].concat(list.map(function (g) {
      var row = g.row;
      var title = data.titles[row.content_id] || ("بوست " + String(g.key).split("_").pop().slice(-12));
      var label = (BRANDS[row.brand] || row.brand || "الصفحة") + " | " + arabicDate(g.latest) + " | " + shortText(title, 52) + " | " + g.count + " تعليق";
      return { value: g.key, label: label };
    }));
  }

  function categoryMatch(row) {
    if (!filterState.category) return true;
    if (filterState.category === "__unclassified") return !row.category;
    return row.category === filterState.category;
  }

  function applyFilters(root, data, baseRows) {
    var byId = {};
    baseRows.forEach(function (row) { byId[row.id] = row; });
    var cards = Array.prototype.slice.call(root.querySelectorAll('.cm-card[data-id]'));
    var shown = 0;
    cards.forEach(function (card) {
      var row = byId[card.getAttribute("data-id")];
      var visible = !!row && categoryMatch(row) && (!filterState.postRef || row.post_ref === filterState.postRef);
      card.style.display = visible ? "" : "none";
      if (visible) shown += 1;
    });

    var empty = root.querySelector(".cm-extra-filter-empty");
    if (!shown && cards.length) {
      if (!empty) {
        empty = document.createElement("div");
        empty.className = "empty cm-extra-filter-empty";
        empty.textContent = "مفيش تعليقات مطابقة للفلاتر المختارة.";
        var filters = root.querySelector(".cm-filters");
        if (filters) filters.insertAdjacentElement("afterend", empty);
      }
      empty.style.display = "";
    } else if (empty) {
      empty.style.display = "none";
    }

    var summary = root.querySelector(".cm-extra-filter-summary");
    if (summary) summary.textContent = "عرض " + shown + " من " + cards.length + " تعليق";
  }

  function fillPostFilter(root, data, baseRows) {
    var post = root.querySelector("#cm-post-ref");
    if (!post) return;
    var categoryRows = baseRows.filter(categoryMatch);
    var options = postOptions(data, categoryRows);
    var allowed = {};
    options.forEach(function (o) { allowed[o.value] = 1; });
    if (filterState.postRef && !allowed[filterState.postRef]) filterState.postRef = "";
    post.innerHTML = options.map(function (o) {
      return '<option value="' + esc(o.value) + '"' + (o.value === filterState.postRef ? " selected" : "") + '>' + esc(o.label) + '</option>';
    }).join("");
    post.value = filterState.postRef;
  }

  function enhance() {
    scheduled = false;
    var root = document.querySelector(".cm-wrap");
    if (!root) return;
    var filters = root.querySelector(".cm-filters");
    if (!filters) return;
    var cards = Array.prototype.slice.call(root.querySelectorAll('.cm-card[data-id]'));

    loadData(false).then(function (data) {
      if (!document.documentElement.contains(root) || !root.querySelector(".cm-filters")) return;
      var baseRows = baseRowsForCards(data, cards);

      if (!filters.querySelector("#cm-category")) {
        var categoryWrap = document.createElement("span");
        categoryWrap.className = "cm-extra-filter-control";
        categoryWrap.innerHTML = selectHtml("cm-category", filterState.category, [
          { value: "", label: "كل التصنيفات" },
          { value: "general", label: "استفسار" },
          { value: "medical_sensitive", label: "سؤال طبي" },
          { value: "emergency", label: "طوارئ" },
          { value: "complaint", label: "شكوى" },
          { value: "thanks", label: "شكر" },
          { value: "handoff", label: "محتاج حد من الفريق" },
          { value: "spam", label: "سبام" },
          { value: "__unclassified", label: "غير مصنف" }
        ], "cm-category-filter");
        filters.appendChild(categoryWrap);
      }

      if (!filters.querySelector("#cm-post-ref")) {
        var postWrap = document.createElement("span");
        postWrap.className = "cm-extra-filter-control cm-post-filter-wrap";
        postWrap.innerHTML = selectHtml("cm-post-ref", filterState.postRef, [{ value: "", label: "كل البوستات" }], "cm-post-filter");
        filters.appendChild(postWrap);
      }

      if (!filters.querySelector(".cm-extra-filter-summary")) {
        var summary = document.createElement("span");
        summary.className = "muted cm-extra-filter-summary";
        filters.appendChild(summary);
      }

      if (!document.getElementById("cm-extra-filter-style")) {
        var style = document.createElement("style");
        style.id = "cm-extra-filter-style";
        style.textContent = [
          '.cm-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}',
          '.cm-extra-filter-control{display:inline-flex;min-width:0;}',
          '.cm-category-filter{min-width:150px;}',
          '.cm-post-filter-wrap{flex:1 1 300px;max-width:520px;}',
          '.cm-post-filter{width:100%;min-width:240px;max-width:520px;}',
          '.cm-extra-filter-summary{font-size:12px;margin-inline-start:4px;white-space:nowrap;}',
          '@media(max-width:640px){.cm-extra-filter-control,.cm-post-filter-wrap{flex:1 1 100%;max-width:none}.cm-category-filter,.cm-post-filter{width:100%;max-width:none;min-width:0}.cm-extra-filter-summary{width:100%;margin:0}}'
        ].join("\n");
        document.head.appendChild(style);
      }

      var category = root.querySelector("#cm-category");
      var post = root.querySelector("#cm-post-ref");
      if (category && !category.dataset.extraWired) {
        category.dataset.extraWired = "1";
        category.onchange = function () {
          filterState.category = category.value;
          fillPostFilter(root, data, baseRows);
          applyFilters(root, data, baseRows);
        };
      }
      if (post && !post.dataset.extraWired) {
        post.dataset.extraWired = "1";
        post.onchange = function () {
          filterState.postRef = post.value;
          applyFilters(root, data, baseRows);
        };
      }

      category.value = filterState.category;
      fillPostFilter(root, data, baseRows);
      applyFilters(root, data, baseRows);
    });
  }

  function schedule(forceReload) {
    if (forceReload) { cache = null; cacheAt = 0; }
    if (scheduled) return;
    scheduled = true;
    setTimeout(enhance, 30);
  }

  document.addEventListener("click", function (e) {
    if (e.target && e.target.id === "cm-refresh") schedule(true);
  }, true);

  if (typeof MutationObserver !== "undefined") {
    new MutationObserver(function (rows) {
      var relevant = rows.some(function (r) {
        return Array.prototype.some.call(r.addedNodes || [], function (node) {
          return node.nodeType === 1 && (node.matches && (node.matches(".cm-wrap") || node.querySelector && node.querySelector(".cm-filters")));
        });
      });
      if (relevant) schedule(false);
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  document.addEventListener("change", function (e) {
    if (!e.target) return;
    if (["cm-filter", "cm-brand", "cm-platform"].indexOf(e.target.id) !== -1) schedule(false);
  }, true);

  schedule(false);
})();
