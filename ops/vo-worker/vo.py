#!/usr/bin/env python3
"""Swnw voice-over worker (Instinct). Jobs: ~/vo-worker/queue/<id>.json
{"script": "...", "voice": "female|male", "energy": "calm|moderate|energetic", "notes": "...", "video": "/abs/path.mp4"}
tick = send new jobs by email, then poll replies (mp3) and mux onto the video with ffmpeg. Scripts only - never patient data."""
import email, email.utils, imaplib, json, os, smtplib, subprocess, sys, time, glob
from email.message import EmailMessage
BASE = os.path.expanduser("~/vo-worker"); ADDR = "swnw.voiceover@gmail.com"; TO = "ryxq6r@mail.instinct.com"
PW = open(os.path.join(BASE, ".gmail-app-password")).read().strip()
def log(*a): print(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), *a, flush=True)
def jobs(): return sorted(glob.glob(os.path.join(BASE, "queue", "*.json")))
def save(p, j):
    tmp = p + ".tmp"; open(tmp, "w").write(json.dumps(j, ensure_ascii=False, indent=1)); os.replace(tmp, p)
def send_new():
    for p in jobs():
        j = json.load(open(p))
        if j.get("sent_at"): continue
        voice = j.get("voice") or "auto"; energy = j.get("energy", "moderate")
        if voice == "auto":  # owner 2026-11-22: alternate male/female video by video
            st = os.path.join(BASE, ".last_voice"); last = open(st).read().strip() if os.path.exists(st) else "male"
            voice = "female" if last == "male" else "male"; open(st, "w").write(voice); j["voice"] = voice
        assert voice in ("female", "male") and energy in ("calm", "moderate", "energetic")
        m = EmailMessage(); m["From"] = ADDR; m["To"] = TO; m["Subject"] = f"VO | voice={voice} | energy={energy}"
        mid = email.utils.make_msgid(domain="swnw.voiceover"); m["Message-ID"] = mid
        notes = ((j.get("notes") or "").strip() + " صوت واضح ومش مكتوم، قريب من المايك، من غير صدى.").strip()
        body = j["script"].strip() + "\nNOTES: " + notes
        m.set_content(body)
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as s: s.login(ADDR, PW); s.send_message(m)
        j["message_id"] = mid; j["sent_at"] = time.time(); save(p, j); log("sent", os.path.basename(p), mid)
def poll():
    pending = {}
    for p in jobs():
        j = json.load(open(p))
        if j.get("sent_at") and not j.get("audio"): pending[j["message_id"]] = (p, j)
    if not pending: return
    M = imaplib.IMAP4_SSL("imap.gmail.com", 993); M.login(ADDR, PW); M.select("INBOX")
    typ, data = M.search(None, '(FROM "instinct.com" SINCE "%s")' % time.strftime("%d-%b-%Y", time.gmtime(time.time() - 3 * 86400)))
    for num in data[0].split():
        typ, msg = M.fetch(num, "(RFC822)"); m = email.message_from_bytes(msg[0][1])
        refs = (m.get("In-Reply-To", "") + " " + m.get("References", "")).split()
        hit = next((k for k in pending if k in refs), None)
        if not hit: continue
        p, j = pending.pop(hit); jid = os.path.splitext(os.path.basename(p))[0]
        for part in m.walk():
            fn = part.get_filename() or ""
            if part.get_content_type() in ("audio/mpeg", "audio/mp3") or fn.lower().endswith(".mp3"):
                out = os.path.join(BASE, "out", jid + ".mp3"); open(out, "wb").write(part.get_payload(decode=True)); j["audio"] = out; break
        if not j.get("audio"): log("reply without mp3", jid); continue
        if j.get("video"):
            vid = os.path.join(BASE, "out", jid + ".mp4")
            r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", j["video"], "-i", j["audio"], "-map", "0:v:0", "-map", "1:a:0",
                                "-c:v", "copy", "-af", "highpass=f=80,equalizer=f=3000:t=q:w=1:g=3,loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-shortest", vid], capture_output=True, text=True)
            j["video_out"] = vid if r.returncode == 0 else None; j["ffmpeg_error"] = r.stderr[-400:] if r.returncode else None
        j["done_at"] = time.time(); save(p, j); os.replace(p, os.path.join(BASE, "done", os.path.basename(p))); log("done", jid, j.get("video_out") or j["audio"])
    M.logout()
if __name__ == "__main__":
    send_new(); poll()
