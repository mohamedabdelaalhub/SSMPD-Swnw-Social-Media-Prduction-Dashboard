import sys, math
import base as B, person as PS
names = [("abu","أبو نظارة","normal"),("man_tie","الأستاذ (قميص وكرافتة)","happy"),("man_beard","الأخ (بدقن)","normal"),
         ("doctor_m","الدكتور","happy"),("doctor_f","الدكتورة","happy"),("mama_hair","ماما (شعر)","normal"),
         ("mama_hijab","ماما (محجبة)","happy"),("boy","الولد","happy"),("girl","البنت","normal"),
         ("grandpa","جدو (جلابية وعصاية)","normal"),("grandma","تيتة (عباية وحجاب أبيض)","happy")]
cols=6; cw=400; ch=760; rows=(len(names)+cols-1)//cols
W,H=cols*cw, rows*ch+120
s=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}"><rect width="{W}" height="{H}" fill="#ffffff"/>',
   B.T(W/2,70,"طاقم شخصيات Swnw الموسّع — نسخة 1",50,B.BLUE,800)]
tints=["#E4EEFB","#FDECE3","#E3F4FB","#F0F6FC"]
for i,(k,n,e) in enumerate(names):
    cx=(i%cols)*cw+cw/2; top=(i//cols)*ch+110
    s.append(f'<rect x="{cx-186}" y="{top}" width="372" height="{ch-30}" rx="36" fill="{tints[i%4]}"/>')
    s.append(B.El(cx,top+ch-120,110,16,"#0F309618"))
    s.append(person_svg:=PS.person({"x":cx,"y":top+ch-120,"s":0.74,"look":k,"kind":e,"aL":(-66,-318),"aR":(66,-318)}))
    s.append(B.T(cx,top+ch-62,n,28,B.BLUE,800))
s.append('</svg>'); open('/tmp/cast_sheet.svg','w').write("\n".join(s)); print("ok",W,H)
