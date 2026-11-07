/* SWNW Today Operations — reception day order helper.
   The separate 7-column "unified" board was merged into the single board in today-operations.js (audit item 4, part 2).
   This file now only keeps «تشغيل اليوم» first in the reception sections and hides the old reception cash entry for reception-only staff. */
(function(){
'use strict';
if(window.__SWNWTodayOperationsUnifiedV1)return;
window.__SWNWTodayOperationsUnifiedV1=true;
function improveHubOrder(){
 document.querySelectorAll('.fc-section-grid').forEach(function(grid){var journey=grid.querySelector('[data-rx-section="journey"]');if(journey&&grid.firstElementChild!==journey)grid.insertBefore(journey,grid.firstElementChild);});
 var admin=window.SSMPDAuth&&window.SSMPDAuth.currentAdmin;
 if(admin&&window.SSMPDRoles&&window.SSMPDRoles.hasRole(admin,'reception')&&!window.SSMPDRoles.hasAnyRole(admin,['super_admin','general_manager']))document.querySelectorAll('[data-goto="booking_cash"]').forEach(function(n){n.hidden=true;});
}
improveHubOrder();setInterval(improveHubOrder,900);
})();
