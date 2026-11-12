import json, subprocess, numpy as np
import os
KIT = os.environ.get("KIT", ".")
o1, o2, o3, o4 = 0.30, 0.88, 5.99, 8.49      # narrator (female) offsets: video = vo + offset
D0 = 17.9                                    # doctor take starts here (video time)
def html(s):
    parts = s.split('*'); return "".join(f'<tspan fill="#F15A22">{p}</tspan>' if i % 2 else p for i, p in enumerate(parts))
caps_n = [  # narrator: (vo_start, vo_end, offset, chunks)
 (0.00, 1.10, o1, ["بتشرب ساقع"]), (1.34, 2.62, o1, ["زي اللي بيفكك *قنبلة؟*"]),
 (2.92, 3.95, o2, ["بيقرّبها *بحذر*..."]), (4.38, 5.59, o2, ["والسنّة *بتترعش!*"]),
 (5.91, 6.16, o3, ["طب.."]), (6.43, 7.80, o3, ["أشرب من الناحية *التانية؟*"]),
 (7.98, 9.13, o4, ["طب هو ده *طبيعي؟*"])]
caps_d = [  # doctor (Hanafi take), offset D0
 (0.00, 1.80, D0, ["حساسية الأسنان", "*شائعة جدًا*"]), (2.11, 4.34, D0, ["وممكن تحس بيها", "مع *الساقع* أو *السخن*"]),
 (5.09, 6.31, D0, ["وليها أسباب", "*مختلفة*"]), (6.59, 8.89, D0, ["زي تآكل المينا", "أو انحسار *اللثة*"]),
 (9.49, 10.60, D0, ["والكشف عند الدكتور"]), (10.94, 11.77, D0, ["*بيحدد السبب*"]),
 (12.42, 13.92, D0, ["ومتستناش", "لو الوجع *بيتكرر*"]), (14.53, 15.74, D0, ["استشر *دكتور الأسنان*"])]
chunks = []
for a, b, off, cs in caps_n + caps_d:
    tot = sum(len(c.replace('*','')) for c in cs); cum = 0
    for c in cs:
        n = len(c.replace('*','')); t0 = a + (b - a) * cum / tot; t1 = a + (b - a) * (cum + n) / tot; cum += n
        chunks.append([round(t0 + off, 3), round(t1 + off, 3), c])
T_END = round(15.74 + D0 + 1.5, 2)
caps = []
for i, (t0, t1, c) in enumerate(chunks):
    nxt = chunks[i + 1][0] if i + 1 < len(chunks) else None
    end = nxt if (nxt is not None and nxt - t1 <= 0.7) else t1 + 0.3
    if nxt is None: end = T_END - 0.3
    caps.append([t0, round(end, 3), html(c)])
speak = [[round(a + D0, 3), round(b + D0, 3)] for a, b in [(0.0,1.80),(2.11,4.34),(5.09,6.31),(6.59,8.89),(9.49,10.60),(10.94,11.77),(12.42,13.92),(14.53,15.74)]]
fin = round(14.53 + D0 - 0.15, 2)
cards = [[round(0.0+D0+0.3,2),1,"حساسية الأسنان شائعة",380],[round(5.09+D0+0.3,2),2,"ليها أسباب مختلفة",510],
         [round(9.49+D0+0.3,2),3,"الكشف بيحدد السبب",640],[round(12.42+D0+0.2,2),4,"متستناش لو بيتكرر",770]]
pops = [0.3, 3.7, 3.8, 5.26, 11.9, 13.0, 13.1, 15.5, 16.4] + [c[0] for c in cards] + [fin + 0.2]
# lip-sync envelope of the doctor take
raw = subprocess.run(["ffmpeg","-v","error","-i",KIT+"/voice_doctor.mp3","-f","f32le","-ac","1","-ar","44100","-"],capture_output=True).stdout
v = np.frombuffer(raw, dtype=np.float32).astype(np.float64); win = int(44100/24)
rms = np.array([np.sqrt(np.mean(v[i:i+win]**2)) for i in range(0, len(v)-win, win)])
env = np.clip(rms/np.percentile(rms,95),0,1)**0.8; env = np.convolve(env,[0.25,0.5,0.25],mode="same")
slices = [dict(src="narr",a=0.00,b=2.77,place=0.30), dict(src="narr",a=2.77,b=5.75,place=2.77+o2),
          dict(src="narr",a=5.75,b=7.89,place=5.75+o3), dict(src="narr",a=7.89,b=9.27,place=7.89+o4),
          dict(src="doc",a=0.0,b=16.0,place=D0)]
sched = dict(caps=caps, cards=cards, speak=speak, fin=fin, dur=T_END, pops=pops, vo_slices=slices,
             g8=(25.13, 26.98), contact_s=3.0, doc_env=dict(t0=D0, fps=24, vals=[round(float(x),3) for x in env]))
json.dump(sched, open("sched.json","w"), ensure_ascii=False)
print("fin",fin,"dur",T_END,"cards",[c[0] for c in cards]); print(len(caps),"captions")
