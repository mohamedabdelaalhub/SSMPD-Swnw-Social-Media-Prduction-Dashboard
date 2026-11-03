(function () {
  'use strict';
  if (document.getElementById('ssmpd-scroll-top')) return;
  var button = document.createElement('button');
  button.id = 'ssmpd-scroll-top';
  button.type = 'button';
  button.hidden = true;
  button.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
  document.body.appendChild(button);
  var previous = Math.max(0, window.scrollY || 0), timer;
  function label() {
    var text = document.documentElement.lang === 'en' ? 'Back to top' : 'الرجوع لأعلى الصفحة';
    button.setAttribute('aria-label', text);
    button.title = text;
  }
  function hide() { button.hidden = true; }
  label();
  new MutationObserver(label).observe(document.documentElement, {attributes:true, attributeFilter:['lang']});
  window.addEventListener('scroll', function () {
    var current = Math.max(0, window.scrollY || 0);
    clearTimeout(timer);
    if (current > previous && current > 120) {
      button.hidden = false;
      timer = setTimeout(hide, 700);
    } else hide();
    previous = current;
  }, {passive:true});
  button.addEventListener('click', function () {
    clearTimeout(timer);
    hide();
    window.scrollTo({top:0, behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'});
  });
  document.addEventListener('visibilitychange', function () { if(document.hidden) hide(); });

  // Employee assistant stays independent. Administrative assistant assets are loaded once from ui-titles.js.
  if (!document.querySelector('link[data-ssmpd-ea]')) {
    var employeeStyle = document.createElement('link');
    employeeStyle.rel = 'stylesheet';
    employeeStyle.href = 'assets/css/employee-assistant.css?v=employee-assistant-v2';
    employeeStyle.setAttribute('data-ssmpd-ea', 'style');
    document.head.appendChild(employeeStyle);
  }
  if (!document.querySelector('script[data-ssmpd-ea]')) {
    var employeeScript = document.createElement('script');
    employeeScript.src = 'assets/js/employee-assistant.js?v=employee-assistant-v1';
    employeeScript.defer = true;
    employeeScript.setAttribute('data-ssmpd-ea', 'script');
    document.body.appendChild(employeeScript);
  }
})();
