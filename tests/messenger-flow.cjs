const assert = require("node:assert/strict");
(async () => {
  const f = await import("../supabase/functions/meta-comments/flow.mjs");
  // phone parsing
  assert.equal(f.extractPhone("رقمي ٠١٠١٢٣٤٥٦٧٨"), "+201012345678");
  assert.equal(f.extractPhone("+20 101 234 5678"), "+201012345678");
  assert.equal(f.extractPhone("123"), null);
  assert.equal(f.extractService("عايز أحجز جلسة علاج طبيعي"), "physiotherapy");
  assert.equal(f.extractService("بكام ليزر الوش"), "cosmetic_laser");
  // happy path, service inferred from the first message
  let r = f.advance(null, "عايز أحجز علاج طبيعي", { category: "general", firstContact: true });
  assert(r.reply.includes("المساعد الآلي") && r.reply.includes("اسم حضرتك") && r.state.service === "physiotherapy");
  r = f.advance(r.state, "منى أحمد", { category: "general" }); assert.equal(r.state.name, "منى أحمد"); assert(r.reply.includes("رقم موبايل"));
  r = f.advance(r.state, "01012345678", { category: "general" }); assert.equal(r.state.phone, "+201012345678"); assert(r.reply.includes("اليوم أو الوقت"));
  r = f.advance(r.state, "بكرة بعد العصر", { category: "general" }); assert(r.ready && r.reply.includes("علاج طبيعي") && r.state.stage === "ready");
  assert(f.advance(r.state, "شكرا", { category: "thanks" }).silent, "silent after handoff to reception");
  // info question mid-flow does not count as unclear and keeps the next question
  r = f.advance({ stage: "collecting", service: "cosmetic_laser", expect: "name" }, "بكام الجلسة؟", { category: "general" });
  assert(r.infoReply && r.reply.includes("اسم حضرتك") && r.state.unclear === 0);
  // unclear twice -> clarify, then human
  r = f.advance({ stage: "collecting", service: "dental", expect: "name" }, "ممم 123", { category: "general" });
  assert(r.reply.includes("محتاج توضيح أكتر علشان أفهم حضرتك") && !r.handoff);
  r = f.advance(r.state, "ثلاثة اربعة 55", { category: "general" });
  assert.equal(r.handoff, "unclear"); assert(r.reply.includes("زميل"));
  // medical question -> human agent message, nothing else
  r = f.advance(null, "عندي وجع في ضهري من اسبوع ايه العلاج", { category: "medical_sensitive", firstContact: true });
  assert.equal(r.handoff, "medical"); assert(r.reply.includes("وكيل بشري") && !/علاج\b.*(خد|تناول)/.test(r.reply));
  // emergency / complaint -> handoff with alert, caller supplies the approved template
  r = f.advance(null, "في ضيق نفس شديد", { category: "emergency" }); assert(r.handoff === "emergency" && r.alert && r.reply === null);
  r = f.advance(null, "الخدمة وحشة", { category: "complaint" }); assert(r.handoff === "complaint" && r.alert);
  // explicit request for a person
  r = f.advance({ stage: "collecting", expect: "phone", service: "dental", name: "س" }, "عايز أكلم موظف", { category: "general" }); assert.equal(r.handoff, "human");
  // name guard: a sentence is not a name
  assert.equal(f.extractName("عايز احجز كشف اسنان بكرة الصبح لو ممكن"), null);
  assert.equal(f.extractName("اسمي محمد علي"), "محمد علي");
  console.log("PASS messenger flow: extraction, happy path, info question, unclear x2, medical/emergency/complaint/human handoffs, silence after handoff");
})().catch((e) => { console.error(e); process.exit(1); });
