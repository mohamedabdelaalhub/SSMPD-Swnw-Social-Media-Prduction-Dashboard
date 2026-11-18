/* Isolated preview boot. Uses the dashboard shell with fictional, in-browser sessions. */
(function (root) {
  'use strict';

  const accounts = root.SSMPDTrainingFixtures.accounts;
  const url = new URL(root.location.href);
  const account = accounts.find(item => item.id === url.searchParams.get('account')) || accounts[0];
  const selector = root.document.getElementById('training-preview-account');
  accounts.forEach(item => selector.add(new root.Option(item.name, item.id)));
  selector.value = account.id;
  selector.addEventListener('change', () => {
    url.searchParams.set('account', selector.value);
    root.location.assign(url.href);
  });

  root.__SSMPD_ADMIN_ASSISTANT_ASSETS_REQUESTED__ = true;
  root.SSMPD_CONFIG = {};
  root.SSMPDAuth = {
    currentAdmin: null,
    getSession: async () => ({ user: { id: account.id } }),
    loadCurrentAdmin: async () => {
      if (!account.active) throw new Error('INACTIVE');
      root.SSMPDAuth.currentAdmin = account;
      if (root.SSMPDRoles.canSeeTab(account, 'training_evaluation')) {
        try {
          root.sessionStorage.setItem('ssmpd_active_tab', 'training_evaluation');
          root.sessionStorage.setItem('ssmpd_active_tab_owner', account.id);
        } catch (_) {
          // The preview's home button is still available.
        }
      }
      return account;
    },
    signOut: async () => { root.SSMPDAuth.currentAdmin = null; },
    onAuthChange: () => {}
  };

  const empty = async () => [];
  root.SSMPDDb = {
    startLoginSession: async () => ({}),
    subscribeTable: () => null,
    searchContentItems: empty,
    listLeads: empty,
    listPatientsArchive: empty,
    listAdminsBasic: empty
  };

  function previewOnly(container) {
    const section = root.document.createElement('section');
    section.className = 'training-page-section';
    const available = root.SSMPDRoles.canSeeTab(account, 'training_evaluation');
    const notice = root.document.createElement('p');
    notice.textContent = available ? 'الأقسام الأخرى غير متاحة في معاينة التدريب.' : 'قسم التدريب غير متاح لهذا الحساب التجريبي.';
    section.append(notice);
    if (available) {
      const link = root.document.createElement('button');
      link.type = 'button';
      link.className = 'btn';
      link.textContent = 'افتح التدريب والتقييم';
      link.onclick = () => root.SSMPDGotoTab('training_evaluation');
      section.append(link);
    }
    container.replaceChildren(section);
  }

  const placeholder = { render: previewOnly };
  [
    'HumanResources', 'PriceLists', 'RenderSummary', 'RenderProduction', 'RenderReview', 'RenderDesign',
    'RenderPublish', 'RenderComments', 'RenderClinicInfo', 'RenderOrgLegal', 'RenderPerformance',
    'IndicatorReports', 'RenderStaffKpi', 'RenderMyKpi', 'RenderArchive', 'RenderPatients',
    'RenderLeads', 'RenderContractingEntities', 'RenderAdmin', 'RenderMetaAds', 'RenderMediaBuyer',
    'Reception', 'BookingCash', 'RenderTasks', 'RenderInventory'
  ].forEach(name => { root['SSMPD' + name] = placeholder; });
  root.SSMPDRenderAccounting = { ...placeholder, openInventory: () => {}, selectSection: () => {} };
  root.SSMPDPersonalHome = { ...placeholder, mountNotifications: () => {}, stop: () => {} };

})(window);
