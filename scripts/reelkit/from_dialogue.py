#!/usr/bin/env python3
"""Dialogue -> storyboard. Claude writes only the dialogue; this picks cast, looks, sets, gestures, camera and transitions (varied by seed)
and checks the rules (approved voices only, kids never speak, short lines).
  python3 from_dialogue.py dialogue.json story.json
dialogue.json: {"title": "...", "topic": "...", "style": "auto|kit|cartoon", "seed": 7, "music": "calm|upbeat|serious", "file": "x.mp4",
                "lines": [{"who": "الأم", "text": "..."}, {"who": "الدكتور", "text": "..."}, {"who": "الولد", "text": "مرتاح كده!"}]}
Speakers: الأم، الأب، الدكتور، الدكتورة، الجد، الراوي (voiced) — الطفل/الولد/البنت react silently (their text becomes a bubble). There is no approved grandmother voice."""
import sys, json, random, re

ROLES = {  # speaker -> {style: [(look, voice)]}
    "الأم":     {"kit": [("kit_woman", "woman_1"), ("kit_hijab", "woman_1")], "cartoon": [("mama_hair", "woman_1"), ("mama_hijab", "woman_1")]},
    "الأب":     {"kit": [("kit_man", "male_2"), ("kit_beard", "male_2")], "cartoon": [("abu", "male_2"), ("man_beard", "male_2"), ("man_tie", "male_2")]},
    "الدكتور":  {"kit": [("dr_poses", "doctor_male"), ("kit_dr_m_scrubs", "doctor_male")], "cartoon": [("doctor_m", "doctor_male")]},
    "الدكتورة": {"kit": [("kit_dr_f_black", "woman_1"), ("kit_dr_f_auburn", "woman_1")], "cartoon": [("doctor_f", "woman_1")]},
    "الجد":     {"kit": [("kit_grandpa", "elder_man")], "cartoon": [("grandpa", "elder_man")]},
}
KIDS = {"الطفل": ("kit_boy", "boy"), "الولد": ("kit_boy", "boy"), "البنت": ("kit_girl", "girl"), "الطفلة": ("kit_girl", "girl")}
SETS_BY_WORD = [("صيدلية|دوا|مضاد|جرعة", "pharmacy"), ("عيادة|دكتور|كشف|تحليل", "clinic"), ("نوم|سرير|نايم|ليل", "bedroom"), ("أكل|مطبخ|شرب|سخن|ساقع", "kitchen"),
                ("مدرسة|امتحان|مذاكرة", "school"), ("شارع|طريق|عربية", "street"), ("جنينة|حديقة|لعب", "garden")]
ALL_SETS = ["living", "clinic", "kitchen", "bedroom", "pharmacy", "garden", "school", "street"]
GEST_Q, GEST_EX, GEST_DR = ["shrug", "think"], ["point", "cheer", "nod"], ["present", "point", "nod"]
TRANS, STOP = ["cut", "slide", "fade", "flash"], set("في من على عن إلى ده دي دا هو هي ما لا لو يا إيه ايه كده كل أي".split())

def key_word(text):
    ws = [w.strip("،,.؟?!:") for w in text.split()]
    ws = [w for w in ws if len(w) >= 4 and w not in STOP]
    return [max(ws, key=len)] if ws else []

def compile_dialogue(d):
    rnd = random.Random(d.get("seed", 1)); style = d.get("style", "auto")
    if style == "auto": style = rnd.choice(["kit", "cartoon"])
    warns, cast, order = [], {}, []
    for ln in d["lines"]:
        who = ln["who"]
        if who in KIDS: continue
        if who == "الجدة": raise SystemExit("لا يوجد صوت معتمد للجدة — استخدم الجد أو الأم")
        if who not in ROLES: raise SystemExit(f"متكلم غير معروف: {who}")
        if who not in cast:
            look, voice = rnd.choice(ROLES[who][style]); used = {v["look"] for v in cast.values()}
            for _ in range(5):
                if look not in used: break
                look, voice = rnd.choice(ROLES[who][style])
            cast[who] = {"look": look, "voice": voice}; order.append(who)
    voices = [v["voice"] for v in cast.values()]
    if len(voices) != len(set(voices)): warns.append("نفس الصوت لشخصيتين — الأفضل شخصيتين بصوتين مختلفين (أم+دكتور مثلًا)")
    kid_ids = {}
    for ln in d["lines"]:
        if ln["who"] in KIDS and ln["who"] not in kid_ids:
            look = KIDS[ln["who"]][0] if style == "kit" else KIDS[ln["who"]][1]; kid_ids[ln["who"]] = look
    ids = {w: f"p{i}" for i, w in enumerate(order)}; ids.update({w: f"k{i}" for i, w in enumerate(kid_ids)})
    story_cast = {ids[w]: dict(v) for w, v in cast.items()}; story_cast.update({ids[w]: {"look": l} for w, l in kid_ids.items()})
    # scenes: spread the voiced lines evenly over 2-4 scenes (1 only for very short dialogues)
    V = sum(x["who"] not in KIDS for x in d["lines"]); k = 1 if V <= 2 else max(2, min(4, round(V / 2.3)))
    targets = [V // k + (1 if i < V % k else 0) for i in range(k)]
    chunks, cur, n, ti = [], [], 0, 0
    for ln in d["lines"]:
        cur.append(ln); n += ln["who"] not in KIDS
        if ti < k - 1 and n >= targets[ti]: chunks.append(cur); cur, n, ti = [], 0, ti + 1
    if cur: chunks.append(cur)
    S = 1.45 if style == "kit" else 1.2; used_sets = []; scenes = []; chars = 0
    for si, ch in enumerate(chunks):
        text = " ".join(x["text"] for x in ch); st = None
        for pat, name in SETS_BY_WORD:
            if re.search(pat, text) and name not in used_sets[-1:]: st = name; break
        st = st or rnd.choice([x for x in ALL_SETS if x not in used_sets[-1:]]); used_sets.append(st)
        who_here = []
        for x in ch:
            if x["who"] not in who_here: who_here.append(x["who"])
        xs = {1: [0.5], 2: [0.3, 0.7], 3: [0.2, 0.5, 0.8], 4: [0.15, 0.38, 0.62, 0.85]}[min(len(who_here), 4)]
        if len(who_here) > 4: warns.append("أكتر من 4 شخصيات في مشهد واحد")
        rnd.shuffle(xs); actors = {ids[w]: {"x": xs[i], "s": S} for i, w in enumerate(who_here[:4])}
        beats = []
        for x in ch:
            t = x["text"].strip(); chars += len(t)
            if len(t.split()) > 14: warns.append(f"جملة طويلة ({len(t.split())} كلمة): {t[:30]}…")
            if x["who"] in KIDS:
                beats.append({"act": {"who": ids[x["who"]], "do": rnd.choice(["happy", "surprised", "scared", "ouch"]), "dur": 1.6}, "bubble": {"who": ids[x["who"]], "text": t.rstrip("."), "kind": "say"}}); continue
            g = rnd.choice(GEST_Q) if "؟" in t or "?" in t else rnd.choice(GEST_EX) if "!" in t else rnd.choice(GEST_DR if x["who"] in ("الدكتور", "الدكتورة") else ["nod", "present", "shrug"])
            beats.append({"say": {"who": ids[x["who"]], "text": t, "hl": key_word(t), "gesture": g}})
        z = rnd.choice([(1.0, 1.1), (1.12, 1.0), (1.0, 1.0), (1.05, 1.15)])
        scenes.append({"set": st, "cam": {"z0": z[0], "z1": z[1], "x0": rnd.choice([0, -20, 20]), "x1": rnd.choice([0, 25, -25])}, "trans": "cut" if si == 0 else rnd.choice(TRANS), "actors": actors, "beats": beats})
    if not 150 <= chars <= 520: warns.append(f"عدد الحروف المنطوقة {chars} — المستهدف 250–450 (ريل 20–40 ثانية)")
    if not any(x["who"] in ("الدكتور", "الدكتورة") for x in d["lines"]) and not re.search("استشر|الدكتور|دكتور", " ".join(x["text"] for x in d["lines"])): warns.append("مفيش «استشر الدكتور» في الحوار")
    story = {"meta": {"brand": True, "title": d.get("title", ""), "music": d.get("music", "calm"), "seed": d.get("seed", 1), "file": d.get("file", "reel.mp4"), "style": style}, "cast": story_cast, "scenes": scenes}
    return story, warns

if __name__ == "__main__":
    d = json.load(open(sys.argv[1])); story, warns = compile_dialogue(d)
    json.dump(story, open(sys.argv[2], "w"), ensure_ascii=False, indent=1)
    print(f"story: {sys.argv[2]}  style={story['meta']['style']}  scenes={len(story['scenes'])}")
    for w in warns: print("WARNING:", w)
