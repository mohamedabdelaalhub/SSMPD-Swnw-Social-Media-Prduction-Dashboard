// Shared JSDOM environment for the attendance hub DOM tests (الآن / الورديات / التقارير): the real HR page + the real hub modules, RPCs mocked.
const fs = require('fs'), { JSDOM } = require('jsdom');
const tick = (n = 25) => new Promise(r => setTimeout(r, n));
module.exports = async function env({ manager = true, rpc, people } = {}) {
  const dom = new JSDOM('<main></main>', { url: 'https://test.invalid', runScripts: 'outside-only', pretendToBeVisual: true }), w = dom.window, d = w.document;
  const hrData = { can_manage: manager, people: people || [{ id: 'p1', admin_id: 'hr', full_name: 'موظف أول', code: 'EMP-1', kind: 'employee', department: 'الاستقبال', branch: 'الفرع', status: 'active', revision: 2, leave_balance: 5, phone: '010 1234 5678' }], requests: [], attendance: [], documents: [], accounts: [], doctor_keys: [], employee_keys: [] };
  const calls = [], intervals = [];
  w.confirm = () => true; w.SSMPDAuth = { currentAdmin: { id: 'hr', role: 'reception', has_hr_access: manager } }; w.SSMPDToast = { show: (m, k) => { (w.__toasts = w.__toasts || []).push([m, k]); } };
  w.eval(fs.readFileSync('assets/js/roles.js', 'utf8'));
  w.SSMPDDb = { client: { rpc: async (fn, args) => {
    if (fn === 'hr_workspace') return { data: hrData };
    calls.push([fn, JSON.parse(JSON.stringify(args || {}))]);
    const r = rpc ? await rpc(fn, args) : undefined;
    if (r !== undefined) return r;
    return { data: { rules: [], adjustments: [], devices: [], imports: [], services: [] } };
  } } };
  w.setInterval = (fn) => { intervals.push(fn); return intervals.length; }; w.clearInterval = (id) => { intervals[id - 1] = null; };
  for (const f of ['workforce-prices', 'hr-payroll-workspace', 'hr-attendance-core', 'hr-presence', 'hr-shifts', 'hr-attendance-reports', 'hr-attendance-hub', 'hr-navigation']) w.eval(fs.readFileSync('assets/js/' + f + '.js', 'utf8'));
  const host = d.querySelector('main');
  const api = {
    w, d, host, hrData, calls, intervals, tick,
    count: fn => calls.filter(c => c[0] === fn).length,
    async openHub(tab) {
      w.SSMPDHumanResources.render(host); await tick();
      const t = d.querySelector('[data-hr-open=presence]'); if (!t) return null;
      t.click(); await tick(); await tick();
      if (tab && tab !== 'now') { d.querySelector('[data-att-tab=' + tab + ']').click(); await tick(); await tick(); }
      return d.querySelector('[data-att-hub]');
    },
    refresher() { return intervals.filter(Boolean).pop(); }
  };
  return api;
};
