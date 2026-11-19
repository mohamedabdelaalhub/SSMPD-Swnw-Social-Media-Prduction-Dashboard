/* اختبار شاشة «العائد على الصرف» بـjsdom (Supabase مموّه): حالة فاضية، أرقام وألوان الهدف، فلتر الصفحة، وغياب الدالة على السيرفر.
   تشغيل: node tests/ads-roi-dom.cjs */
const { JSDOM } = require("jsdom");
const fs = require("fs"), path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "assets/js/render-adsroi.js"), "utf8");
let failed = 0;
const ok = (c, m) => { if (!c) { console.error("❌ " + m); failed = 1; } else console.log("✓ " + m); };

function setup(db) {
  const dom = new JSDOM('<div id="ma-roi"></div>', { runScripts: "outside-only" });
  dom.window.SSMPDDb = db;
  dom.window.eval(src);
  return dom;
}
const tick = () => new Promise(r => setTimeout(r, 20));
const row = (o) => Object.assign({ campaign_id: "1", campaign_name: "SONO | PHY1 | علاج طبيعي", brand: "sono", spend: 0, msg_started: 0, form_leads: 0,
  attributed_leads: 0, booked_leads: 0, attended_leads: 0, paid_leads: 0, revenue: 0, cost_per_lead: null, cost_per_booking: null, cost_per_attended: null, roas: null }, o);
const limits = [{ label: "سونو — يومي", brand: "sono", amount: 200, spent: 188, pct: 94 }, { label: "د. دينا — شهري", brand: "dr_dina", amount: 3000, spent: 0, pct: 0 }];

(async () => {
  // 1) فاضي
  let d = setup({ adsRoiByCampaign: async () => [], adsActualLimitsStatus: async () => limits });
  d.window.SSMPDAdsRoi.mount(d.window.document.getElementById("ma-roi")); await tick();
  let t = d.window.document.getElementById("ma-roi").textContent;
  ok(t.includes("لسه مفيش صرف"), "empty state shown when there is no spend");
  ok(t.includes("188 من 200") && !t.includes("تكلفة الحجز"), "limits shown, no KPI tiles in empty state");

  // 2) أرقام
  const rows = [
    row({ campaign_id: "A", campaign_name: "SONO | PHY1 | علاج طبيعي", spend: 620, attributed_leads: 9, booked_leads: 6, attended_leads: 3, revenue: 1900, cost_per_booking: 103.33, roas: 3.06 }),
    row({ campaign_id: "B", campaign_name: "SONO | LZF1-F | ليزر", spend: 620, attributed_leads: 21, booked_leads: 8, attended_leads: 4, revenue: 1150, cost_per_booking: 77.5, roas: 1.85 }),
    row({ campaign_id: "C", campaign_name: "DINA | XX9 | تجربة", brand: "dr_dina", spend: 100, attributed_leads: 1, booked_leads: 0 }),
  ];
  d = setup({ adsRoiByCampaign: async () => rows, adsActualLimitsStatus: async () => limits });
  const el = d.window.document.getElementById("ma-roi");
  d.window.SSMPDAdsRoi.mount(el); await tick();
  const tot = d.window.SSMPDAdsRoi._totals(rows);
  ok(tot.spend === 1340 && tot.booked === 14 && tot.attended === 7, "totals: spend 1340, booked 14, attended 7");
  ok(Math.round(tot.cpb) === 96 && tot.roas.toFixed(2) === "2.28", "cost per booking ≈ 96, ROAS 2.28");
  t = el.textContent;
  ok(t.includes("حضر 7"), "attended shown next to bookings");
  ok(el.querySelectorAll(".roi-kpi").length === 5 && el.querySelectorAll(".roi-kpi.hero").length === 1, "5 KPI tiles, exactly one hero");
  const chips = [...el.querySelectorAll(".roi-tc .roi-chip")].map(c => c.className + "|" + c.textContent);
  ok(chips.length === 2 && chips[0].includes("ok|الهدف 120") && chips[1].includes("bad|الهدف 45"), "PHY1 within target (green), LZF1-F above target (red)");
  ok(/قرّب يوصل/.test(t), "limit at 94% is flagged «قرّب يوصل»");
  ok(el.querySelector(".roi-fill.mut") !== null, "zero-spend limit shows «مفيش صرف» state");

  // 3) فلتر الصفحة
  el.querySelector('[data-roi-brand="dr_dina"]').click(); await tick();
  ok(el.querySelectorAll(".roi-tbl tbody tr").length === 1 && el.textContent.includes("XX9"), "brand filter keeps only dr_dina campaigns");
  ok(!el.textContent.includes("سونو — يومي"), "brand filter also filters limits");

  // 4) الدالة مش متطبقة
  d = setup({ adsRoiByCampaign: async () => { throw { message: 'Could not find the function public.ads_roi_by_campaign in the schema cache' }; }, adsActualLimitsStatus: async () => [] });
  const e2 = d.window.document.getElementById("ma-roi");
  d.window.SSMPDAdsRoi.mount(e2); await tick();
  ok(e2.textContent.includes("لسه مش مفعّل على السيرفر"), "missing server function shows a friendly message, no crash");

  // 5) استخراج الكود والهدف
  const api = d.window.SSMPDAdsRoi;
  ok(api._codeOf("SONO | LZF1-F | ليزر") === "LZF1-F" && api._targetOf("SONO | PHY1 | x") === 120 && api._targetOf("random") === null, "campaign code and target parsing");

  // 5b) الأهداف من الداتابيز تغلب الافتراضي، والافتراضي يشتغل لو الجدول مش موجود
  d = setup({ adsRoiByCampaign: async () => rows.slice(0, 1), adsActualLimitsStatus: async () => [], adsRoiTargets: async () => [{ code: "PHY1", target_cost_per_booking: 100 }] });
  const e4 = d.window.document.getElementById("ma-roi");
  d.window.SSMPDAdsRoi.mount(e4); await tick();
  ok(e4.querySelector(".roi-tc .roi-chip.bad") && e4.textContent.includes("الهدف 100"), "DB target (100) overrides the default: 103 is now above target");
  d = setup({ adsRoiByCampaign: async () => rows.slice(0, 1), adsActualLimitsStatus: async () => [], adsRoiTargets: async () => { throw { message: "relation ads_roi_targets does not exist" }; } });
  const e5 = d.window.document.getElementById("ma-roi");
  d.window.SSMPDAdsRoi.mount(e5); await tick();
  ok(e5.querySelector(".roi-tc .roi-chip.ok") && e5.textContent.includes("الهدف 120"), "falls back to built-in targets when the table is missing");

  // 6) HTML injection
  d = setup({ adsRoiByCampaign: async () => [row({ campaign_name: '<img src=x onerror=alert(1)>', spend: 10, attributed_leads: 1 })], adsActualLimitsStatus: async () => [] });
  const e3 = d.window.document.getElementById("ma-roi");
  d.window.SSMPDAdsRoi.mount(e3); await tick();
  ok(!e3.querySelector("img"), "campaign names are escaped");
  process.exit(failed);
})();
