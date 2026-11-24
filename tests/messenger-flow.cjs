const assert = require("node:assert/strict");
(async () => {
  const f = await import("../supabase/functions/meta-comments/flow.mjs");
  // phone parsing
  assert.equal(f.extractPhone("رقمي ٠١٠١٢٣٤٥٦٧٨"), "+201012345678");
  assert.equal(f.extractPhone("+20 101 234 5678"), "+201012345678");
  assert.equal(f.extractPhone("123"), null);
  assert.equal(f.extractService("عايز أحجز جلسة علاج طبيعي"), "physiotherapy");
  assert.equal(f.extractService("بكام ليزر الوش"), "cosmetic_laser");
  // happy path: phone first (the lead exists as soon as it arrives), then name, then time; the service is never asked
  let r = f.advance(null, "عايز أحجز علاج طبيعي", { category: "general", firstContact: true });
  assert(r.reply.includes("المساعد الآلي") && r.reply.includes("رقم موبايل") && r.state.service === "physiotherapy" && !r.leadNow);
  r = f.advance(r.state, "01012345678", { category: "general" });
  assert.equal(r.state.phone, "+201012345678"); assert.equal(r.leadNow, true, "lead is created the moment the phone arrives"); assert(r.reply.includes("اسم حضرتك"));
  const withLead = { ...r.state, lead_id: "L1" };
  r = f.advance(withLead, "منى أحمد", { category: "general" }); assert.equal(r.state.name, "منى أحمد"); assert.equal(r.leadNow, false); assert(r.reply.includes("اليوم أو الوقت"));
  r = f.advance(r.state, "بكرة بعد العصر", { category: "general" }); assert(r.ready && r.reply.includes("علاج طبيعي") && r.state.stage === "ready" && r.leadNow === false);
  assert(f.advance(r.state, "شكرا", { category: "thanks" }).silent, "silent after handoff to reception");
  // the physiotherapy default (Sono Messenger ad): no service question at all, and a named service still wins
  r = f.advance(null, "أهلاً", { category: "general", firstContact: true, defaultService: "physiotherapy" });
  assert.equal(r.state.service, "physiotherapy"); assert(!/أنهي خدمة/.test(r.reply) && r.reply.includes("رقم موبايل"));
  r = f.advance(r.state, "بكام الليزر؟", { category: "general", defaultService: "physiotherapy" });
  assert.equal(r.state.service, "cosmetic_laser", "text beats the default");
  // name and phone in one message: both are taken, the lead is created, the next question is the time
  r = f.advance({ stage: "collecting", service: "physiotherapy", expect: "phone" }, "منى 01012345678", { category: "general" });
  assert.equal(r.state.name, "منى"); assert.equal(r.state.phone, "+201012345678"); assert.equal(r.leadNow, true); assert(r.reply.includes("اليوم أو الوقت"));
  // phone given at the very end is still enough to create the lead (e.g. name/time were skipped)
  r = f.advance({ stage: "collecting", service: "dental", expect: "phone", name: "س", preferred_time: "بكرة" }, "01099998888", { category: "general" });
  assert(r.ready && r.leadNow === true);
  // info question mid-flow does not count as unclear and keeps the next question
  r = f.advance({ stage: "collecting", service: "cosmetic_laser", phone: "+201012345678", lead_id: "L1", expect: "name" }, "بكام الجلسة؟", { category: "general" });
  assert(r.infoReply && r.reply.includes("اسم حضرتك") && r.state.unclear === 0);
  // unclear twice -> clarify, then human
  r = f.advance({ stage: "collecting", service: "dental", phone: "+201012345678", lead_id: "L1", expect: "name" }, "ممم 123", { category: "general" });
  assert(r.reply.includes("محتاج توضيح أكتر علشان أفهم حضرتك") && !r.handoff);
  r = f.advance(r.state, "ثلاثة اربعة 55", { category: "general" });
  assert.equal(r.handoff, "unclear"); assert(r.reply.includes("زميل"));
  // medical question -> human agent message, nothing else
  r = f.advance(null, "عندي وجع في ضهري من اسبوع ايه العلاج", { category: "medical_sensitive", firstContact: true });
  assert.equal(r.handoff, "medical"); assert(!r.reply.includes("وكيل بشري") && !/علاج\b.*(خد|تناول)/.test(r.reply));
  // hand-off wording: owner-approved variants, stable per conversation, after-hours wording outside 08:00-24:00 Cairo
  const noon = new Date("2026-11-22T10:00:00Z"), night = new Date("2026-11-22T02:00:00Z"); // 12:00 and 04:00 Cairo (UTC+2)
  assert(f.clinicOpen(noon) && !f.clinicOpen(night));
  const nine = new Date("2026-11-22T07:00:00Z"), ten = new Date("2026-11-22T08:00:00Z"), lateNight = new Date("2026-11-22T21:59:00Z"); // 09:00, 10:00, 23:59 Cairo
  assert(!f.clinicOpen(nine) && f.clinicOpen(ten) && f.clinicOpen(lateNight), "opening hours are 10:00-24:00 Cairo");
  assert(f.HANDOFF_AFTER_HOURS.includes("الساعة 10"));
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(f.handoffReply({ seed: "conv-" + i, now: noon }));
  assert.deepEqual([...seen].sort(), [...f.HANDOFF_VARIANTS].sort(), "all three variants get used");
  assert.equal(f.handoffReply({ seed: "a", now: noon }), f.handoffReply({ seed: "a", now: noon }), "same conversation, same wording");
  assert.equal(f.handoffReply({ seed: "a", now: night }), f.HANDOFF_AFTER_HOURS);
  assert.equal(f.advance(null, "عندي وجع", { category: "medical_sensitive", seed: "z", now: night }).reply, f.HANDOFF_AFTER_HOURS);
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
