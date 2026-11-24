// Comments with no author name (Meta hides most commenters) show «زائر فيسبوك» / «زائر انستجرام», never an empty or bare «مستخدم».
const assert = require("node:assert/strict");
const fs = require("node:fs");
const src = fs.readFileSync("assets/js/render-comments.js", "utf8");
assert(src.includes("function commenterName"), "helper exists");
assert(!/author_name \|\| "مستخدم"/.test(src), "no bare «مستخدم» fallback left");
const m = src.match(/function commenterName\(c\) \{[\s\S]*?\n  \}/);
const commenterName = new Function("return " + m[0].replace("function commenterName", "function"))();
assert.equal(commenterName({ author_name: "منى", platform: "facebook" }), "منى");
assert.equal(commenterName({ author_name: null, platform: "facebook" }), "زائر فيسبوك");
assert.equal(commenterName({ author_name: "", platform: "instagram" }), "زائر انستجرام");
console.log("PASS comment guest name: real name wins, facebook/instagram placeholders, no bare «مستخدم»");
