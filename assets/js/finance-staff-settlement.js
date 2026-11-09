/* «مخالصات الموظفين» — accounting tab for end-of-service settlements. The accountant prepares the sheet, the financial manager approves (never the person who opened the case or prepared the sheet).
   The whole workflow lives in hr-offboarding.js (SSMPDHROffboarding); this tab only hosts it inside the finance panel. Server: hr_offboarding_* (migration 20261109160000, not applied until the owner approves).
   Chains onto SSMPDFinanceControls like finance-staff-tax.js does; registered in finance-cash.js (group «الصرف والمستحقات»). */
(function () {
  'use strict';
  var prior = window.SSMPDFinanceControls;
  if (!prior) return;
  var TAB = 'staff-settlement';
  function panelHtml() {
    setTimeout(function () {
      var host = document.querySelector('[data-settlement-host]');
      if (!host || host.dataset.mounted || !window.SSMPDHROffboarding) return;
      host.dataset.mounted = '1';
      window.SSMPDHROffboarding.mount(host, true);
    }, 0);
    return '<div data-settlement-host></div>';
  }
  window.SSMPDFinanceControls = {
    panel: function (tab, d, h) { return tab === TAB ? panelHtml() : prior.panel(tab, d, h); },
    act: function (action, id, d, h) { return prior.act(action, id, d, h); },
    due: prior.due
  };
})();
