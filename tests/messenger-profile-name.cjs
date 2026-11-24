const assert = require("node:assert/strict");
const fs = require("node:fs");
(async () => {
  const f = await import("../supabase/functions/meta-comments/flow.mjs");
  // what counts as a real name
  assert.equal(f.looksLikeRealName("منى أحمد"), "منى أحمد");
  assert.equal(f.looksLikeRealName("Mona Ahmed Ali"), "Mona Ahmed Ali");
  for (const bad of ["منى", "Mona", "Facebook user", "مستخدم فيسبوك", "Mona 😍", "mona_2020 x", "a b", "", null, "أ ب ج د ه و"]) assert.equal(f.looksLikeRealName(bad), null, String(bad));
  // profile name is used: the name question is skipped, the lead still starts at the phone
  let r = f.advance(null, "عايز أحجز", { category: "general", firstContact: true, defaultService: "physiotherapy", profileName: "منى أحمد" });
  assert.equal(r.state.name, "منى أحمد"); assert.equal(r.state.name_source, "facebook");
  r = f.advance(r.state, "01012345678", { category: "general", profileName: "منى أحمد" });
  assert.equal(r.leadNow, true); assert(r.reply.includes("اليوم أو الوقت") && !r.reply.includes("اسم حضرتك"), "name is not asked again");
  // single word / nickname: still asked
  r = f.advance({ stage: "collecting", service: "physiotherapy", phone: "+201012345678", lead_id: "L1", expect: "name" }, "بكام الجلسة؟", { category: "general", profileName: "Mona" });
  assert.equal(r.state.name, null); assert(r.reply.includes("اسم حضرتك"));
  // a typed name wins over the profile name
  r = f.advance({ stage: "collecting", service: "physiotherapy", phone: "+201012345678", lead_id: "L1", name: "منى أحمد", name_source: "facebook", expect: "name" }, "اسمي سارة محمود", { category: "general" });
  assert.equal(r.state.name, "سارة محمود"); assert.equal(r.state.name_source, null);
  // static UI/DB guards
  const ui = fs.readFileSync("assets/js/render-leads.js", "utf8");
  assert(ui.includes("function nameHtml") && !/escapeHtml\(l\.customer_name\) \+ '<\/td>/.test(ui), "lead tables use nameHtml");
  assert(fs.readFileSync("assets/js/db.js", "utf8").includes("customer_name_source"), "db.js selects the column");
  console.log("PASS messenger profile name: heuristic, skip name question, nickname still asked, typed name wins, UI tag wired");
})().catch((e) => { console.error(e); process.exit(1); });
