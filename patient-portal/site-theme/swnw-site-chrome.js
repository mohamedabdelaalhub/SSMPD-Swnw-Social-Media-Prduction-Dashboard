(function () {
    "use strict";

    // Adds the website's header and footer around the patient portal so it reads as part of
    // the same site. Purely presentational: no portal logic, storage or network calls.
    // Usage (after the portal's own scripts):
    //   <script src="site-theme/swnw-site-chrome.js" data-site="https://swnwclinics.com" defer></script>
    var script = document.currentScript;
    var site = ((script && script.getAttribute("data-site")) || "https://swnwclinics.com").replace(/\/+$/, "");
    var base = script && script.src ? script.src.replace(/[^/]*$/, "") : "";
    if (document.querySelector(".swnw-chrome-header")) return;

    function element(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    }
    function link(parent, label, href, className) {
        var anchor = element("a", className || "", label);
        anchor.href = href;
        parent.appendChild(anchor);
        return anchor;
    }

    var header = element("header", "swnw-chrome-header");
    header.dir = "rtl";
    var inner = element("div", "swnw-chrome-header__inner");
    var brand = link(inner, "", site + "/User/Default", "swnw-chrome-header__brand");
    brand.setAttribute("aria-label", "عيادات سونو التخصصية — الصفحة الرئيسية");
    var logo = element("img");
    logo.src = base + "swnw-logo-white.png";
    logo.alt = "عيادات سونو التخصصية";
    logo.width = 128; logo.height = 54;
    brand.appendChild(logo);
    var nav = element("nav");
    nav.setAttribute("aria-label", "روابط الموقع");
    link(nav, "الرئيسية", site + "/User/Default");
    link(nav, "الأطباء", site + "/User/Doctor");
    // /User/Schedule only exists on the redesigned website: add data-schedule to the script tag once that is the live site.
    if (script && script.hasAttribute("data-schedule")) link(nav, "جدول العيادات", site + "/User/Schedule");
    link(nav, "اتصل بنا", site + "/User/Contact");
    inner.appendChild(nav);
    link(inner, "احجز موعدك", site + "/User/DoctorCalender", "swnw-chrome-header__cta");
    header.appendChild(inner);

    var footer = element("footer", "swnw-chrome-footer");
    footer.dir = "rtl";
    var footerInner = element("div", "swnw-chrome-footer__inner");
    footerInner.appendChild(element("span", "", "© " + new Date().getFullYear() + " عيادات سونو التخصصية — جميع الحقوق محفوظة"));
    var links = element("div", "swnw-chrome-footer__links");
    link(links, "0236230005", "tel:0236230005").dir = "ltr";
    link(links, "واتساب", "https://wa.me/201010686264").rel = "noopener";
    link(links, "سياسة الخصوصية", site + "/User/Privacy");
    link(links, "العودة إلى الموقع", site + "/User/Default");
    footerInner.appendChild(links);
    footer.appendChild(footerInner);

    function mount() {
        if (!document.body || document.querySelector(".swnw-chrome-header")) return;
        document.body.insertBefore(header, document.body.firstChild);
        document.body.appendChild(footer);
    }
    if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount);
    // The portal re-renders its root; keep the footer last without touching the portal's nodes, and tell the
    // header when the portal is signed in (the theme then shows the portal's account button inside the header).
    function sync() {
        if (footer.parentNode === document.body && document.body.lastElementChild !== footer) document.body.appendChild(footer);
        header.classList.toggle("has-account", !!document.querySelector(".app-topbar .user-area"));
    }
    new MutationObserver(sync).observe(document.documentElement, { childList: true, subtree: true });
    sync();
}());
