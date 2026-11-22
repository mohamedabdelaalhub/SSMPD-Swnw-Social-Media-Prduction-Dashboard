#!/usr/bin/env python3
"""Swnw voice-over worker (Instinct). Jobs: ~/vo-worker/queue/<id>.json
{"script": "...", "voice": "auto|female|male", "energy": "calm|moderate|energetic", "notes": "...", "video": "/abs/path.mp4"}
tick = take database jobs, send new jobs by email, then poll replies (mp3) and mux onto the video with ffmpeg.
Scripts only - never patient data.

Database jobs (2026-11-22, migration 20261122100000_vo_jobs.sql): the reel task asks through the gateway (?op=vo_submit);
with ~/vo-worker/.vo-worker-secret present (mode 600, = Edge secret VO_WORKER_SECRET) every tick leases them from the
vo-worker edge function, writes them here as queue/db-<uuid>.json and reports them back: sent (voice + Message-ID),
done (the mp3, base64) or fail. A database job with no mp3 30 minutes after it was taken is reported "timeout"
(the reel task has already fallen back to ElevenLabs by then). No secret file = folder jobs only, exactly as before."""
import base64, email, email.utils, imaplib, json, os, smtplib, subprocess, sys, time, glob, urllib.request
from email.message import EmailMessage
BASE = os.path.expanduser("~/vo-worker"); ADDR = "swnw.voiceover@gmail.com"; TO = "ryxq6r@mail.instinct.com"
API = os.environ.get("VO_API", "https://api.swnwclinics.com/functions/v1/vo-worker")
DB_TIMEOUT = 30 * 60  # owner 2026-11-22: wait 30 min before the fallback
def log(*a): print(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), *a, flush=True)
def jobs(): return sorted(glob.glob(os.path.join(BASE, "queue", "*.json")))
def save(p, j):
    tmp = p + ".tmp"; open(tmp, "w").write(json.dumps(j, ensure_ascii=False, indent=1)); os.replace(tmp, p)
def password(): return open(os.path.join(BASE, ".gmail-app-password")).read().strip()
def finish(p, j):
    j["done_at"] = time.time(); save(p, j); os.replace(p, os.path.join(BASE, "done", os.path.basename(p)))

# ---- database jobs (vo-worker edge function) ----
def secret():
    f = os.path.join(BASE, ".vo-worker-secret")
    return open(f).read().strip() if os.path.exists(f) else ""
def api(action, payload):
    """-> the function's result dict, or None on any network/HTTP error (then the step is retried next tick)."""
    try:
        req = urllib.request.Request(API, data=json.dumps({"action": action, "payload": payload}).encode(), method="POST",
                                     headers={"Content-Type": "application/json", "X-VO-Worker-Secret": secret(), "User-Agent": "swnw-vo-worker/1"})
        with urllib.request.urlopen(req, timeout=60) as r: d = json.loads(r.read())
        return d.get("result") if d.get("ok") else None
    except Exception as e:
        log("api", action, "error", type(e).__name__); return None
def pull_db():
    if not secret(): return
    res = api("lease", {"worker": "swnw-vps", "limit": 3})
    for dj in (res or {}).get("jobs") or []:
        name = "db-%s.json" % dj["id"]; p = os.path.join(BASE, "queue", name)
        if os.path.exists(p) or os.path.exists(os.path.join(BASE, "done", name)): continue
        save(p, {"db_id": dj["id"], "script": dj["script"], "voice": dj.get("voice") or "auto", "energy": dj.get("energy") or "moderate",
                 "notes": dj.get("notes") or "", "taken_at": time.time()})
        log("db job", name)
def report_db():
    """Retry reports that did not reach the database, and time out database jobs with no mp3 after 30 minutes."""
    if not secret(): return
    for p in jobs():
        j = json.load(open(p))
        if not j.get("db_id"): continue
        if j.get("audio"):  # mp3 is here, the done report failed earlier
            r = api("done", {"id": j["db_id"], "audio_base64": base64.b64encode(open(j["audio"], "rb").read()).decode()})
            if r is not None: j["db_reported"] = "done" if r.get("ok") else r.get("reason"); finish(p, j); log("db done", os.path.basename(p), j["db_reported"])
            continue
        if j.get("sent_at") and not j.get("db_sent_reported"):
            r = api("sent", {"id": j["db_id"], "voice": j["voice"], "message_id": j["message_id"]})
            if r is not None: j["db_sent_reported"] = True; save(p, j)
        if time.time() - j.get("taken_at", time.time()) > DB_TIMEOUT:
            r = api("fail", {"id": j["db_id"], "reason": "timeout", "error": "no mp3 from Instinct within 30 minutes"})
            if r is not None: j["timeout"] = True; finish(p, j); log("db timeout", os.path.basename(p))

def send_new():
    for p in jobs():
        j = json.load(open(p))
        if j.get("sent_at") or j.get("audio"): continue
        try:
            voice = j.get("voice") or "auto"; energy = j.get("energy") or "moderate"
            if voice == "auto":  # owner 2026-11-22: alternate male/female video by video
                st = os.path.join(BASE, ".last_voice"); last = open(st).read().strip() if os.path.exists(st) else "male"
                voice = "female" if last == "male" else "male"; open(st, "w").write(voice); j["voice"] = voice
            assert voice in ("female", "male") and energy in ("calm", "moderate", "energetic")
            m = EmailMessage(); m["From"] = ADDR; m["To"] = TO; m["Subject"] = f"VO | voice={voice} | energy={energy}"
            mid = email.utils.make_msgid(domain="swnw.voiceover"); m["Message-ID"] = mid
            notes = ((j.get("notes") or "").strip() + " صوت واضح ومش مكتوم، قريب من المايك، من غير صدى.").strip()
            body = j["script"].strip() + "\nNOTES: " + notes
            m.set_content(body)
            with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as s: s.login(ADDR, password()); s.send_message(m)
            j["message_id"] = mid; j["sent_at"] = time.time(); save(p, j); log("sent", os.path.basename(p), mid)
        except Exception as e:  # one bad job must not stop the others
            j["send_errors"] = j.get("send_errors", 0) + 1; j["last_error"] = type(e).__name__ + ": " + str(e)[:200]; save(p, j)
            log("send error", os.path.basename(p), j["last_error"])
            if j.get("db_id") and j["send_errors"] >= 3 and api("fail", {"id": j["db_id"], "error": "send failed: " + j["last_error"]}) is not None:
                finish(p, j)
            continue
        if j.get("db_id") and api("sent", {"id": j["db_id"], "voice": voice, "message_id": mid}) is not None:
            j["db_sent_reported"] = True; save(p, j)
def poll():
    pending = {}
    for p in jobs():
        j = json.load(open(p))
        if j.get("sent_at") and not j.get("audio"): pending[j["message_id"]] = (p, j)
    if not pending: return
    M = imaplib.IMAP4_SSL("imap.gmail.com", 993); M.login(ADDR, password()); M.select("INBOX")
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
        if j.get("db_id"):
            r = api("done", {"id": j["db_id"], "audio_base64": base64.b64encode(open(j["audio"], "rb").read()).decode()})
            if r is None: save(p, j); log("db done report failed, retry next tick", jid); continue
            j["db_reported"] = "done" if r.get("ok") else r.get("reason")
        finish(p, j); log("done", jid, j.get("video_out") or j["audio"])
    M.logout()
if __name__ == "__main__":
    for d in ("queue", "out", "done"): os.makedirs(os.path.join(BASE, d), exist_ok=True)
    pull_db(); send_new(); poll(); report_db()
