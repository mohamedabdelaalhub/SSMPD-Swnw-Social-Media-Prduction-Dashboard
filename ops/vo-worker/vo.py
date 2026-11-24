#!/usr/bin/env python3
"""Swnw voice-over worker (Instinct). Jobs: ~/vo-worker/queue/<id>.json
{"script": "...", "voice": "auto|female|male", "energy": "calm|moderate|energetic", "notes": "...", "video": "/abs/path.mp4"}
tick = take database jobs, send new jobs by email, then poll replies (mp3) and mux onto the video with ffmpeg.
Scripts only - never patient data.

Database jobs (2026-11-22, migration 20261122100000_vo_jobs.sql): the reel task asks through the gateway (?op=vo_submit);
with ~/vo-worker/.vo-worker-secret present (mode 600, = Edge secret VO_WORKER_SECRET) every tick leases them from the
vo-worker edge function, writes them here as queue/db-<uuid>.json and reports them back: sent (voice + Message-ID),
done (the mp3, base64) or fail. A database job with no mp3 30 minutes after it was taken is reported "timeout"
(the reel task has already fallen back to ElevenLabs by then). No secret file = folder jobs only, exactly as before.
Suggested shots (owner 2026-11-22): Instinct also sends links to footage that fits the script. Every link in a reply on the
job's thread (text or HTML, before, with or after the mp3, up to 2 hours after done) is kept in the job file ("clips") and,
for database jobs, sent to the database. They are optional ideas for the reel task.
Instinct question notices (owner 2026-11-24, «مساعد إنستنكت»): with the same secret, every tick leases new lines from the
instinct-notify edge function and sends Instinct ONE e-mail per new staff question: one line — staff name, role, Cairo time.
No question text, no patient data (the outbox has none). Draft lines (Instinct's own drafts) are acked without an e-mail."""
import base64, re, email, email.utils, imaplib, json, os, smtplib, subprocess, sys, time, glob, urllib.request, datetime
from email.message import EmailMessage
BASE = os.path.expanduser("~/vo-worker"); ADDR = "swnw.voiceover@gmail.com"; TO = "ryxq6r@mail.instinct.com"
API = os.environ.get("VO_API", "https://api.swnwclinics.com/functions/v1/vo-worker")
NOTIFY_API = os.environ.get("INSTINCT_NOTIFY_API", "https://api.swnwclinics.com/functions/v1/instinct-notify")
DB_TIMEOUT = 30 * 60  # owner 2026-11-22: wait 30 min before the fallback
def log(*a): print(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), *a, flush=True)
def jobs(): return sorted(glob.glob(os.path.join(BASE, "queue", "*.json")))
def save(p, j):
    tmp = p + ".tmp"; open(tmp, "w").write(json.dumps(j, ensure_ascii=False, indent=1)); os.replace(tmp, p)
def password(): return open(os.path.join(BASE, ".gmail-app-password")).read().strip()
def finish(p, j):
    j["done_at"] = time.time(); save(p, j); os.replace(p, os.path.join(BASE, "done", os.path.basename(p)))

# ---- database jobs (vo-worker edge function) ----
LINK = re.compile(r"https://[^\s\"'<>()\[\]]+")
def links(m):
    """https links in a reply (plain text and HTML), without Instinct's own / unsubscribe / tracking links."""
    out = []
    for part in m.walk():
        if part.get_content_type() not in ("text/plain", "text/html"): continue
        try: txt = part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "replace")
        except Exception: continue
        for u in LINK.findall(txt.replace("&amp;", "&")):
            u = u.rstrip(".,;:!؟،")
            low = u.lower()
            if "instinct.com" in low or "unsubscribe" in low or "google.com/url" in low or len(u) > 500 or u in out: continue
            out.append(u)
    return out[:20]
def add_clips(j, found):
    """-> the links not seen before (also stored in j["clips"])."""
    new = [u for u in found if u not in j.setdefault("clips", [])]
    j["clips"] = (j["clips"] + new)[:20]; return new

def secret():
    f = os.path.join(BASE, ".vo-worker-secret")
    return open(f).read().strip() if os.path.exists(f) else ""
def api(action, payload, url=None):
    """-> the function's result dict, or None on any network/HTTP error (then the step is retried next tick)."""
    try:
        req = urllib.request.Request(url or API, data=json.dumps({"action": action, "payload": payload}).encode(), method="POST",
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
            r = api("done", {"id": j["db_id"], "audio_base64": base64.b64encode(open(j["audio"], "rb").read()).decode(), "clips": j.get("clips") or []})
            if r is not None: j["db_reported"] = "done" if r.get("ok") else r.get("reason"); finish(p, j); log("db done", os.path.basename(p), j["db_reported"])
            continue
        if j.get("sent_at") and not j.get("db_sent_reported"):
            r = api("sent", {"id": j["db_id"], "voice": j["voice"], "message_id": j["message_id"]})
            if r is not None: j["db_sent_reported"] = True; save(p, j)
        if time.time() - j.get("taken_at", time.time()) > DB_TIMEOUT:
            r = api("fail", {"id": j["db_id"], "reason": "timeout", "error": "no mp3 from Instinct within 30 minutes"})
            if r is not None: j["timeout"] = True; finish(p, j); log("db timeout", os.path.basename(p))

# ---- «مساعد إنستنكت»: one-line e-mail per new staff question ----
def cairo_time(iso):
    """'2026-11-24T21:05:00+00:00' -> '2026-11-24 23:05' in Africa/Cairo (Latin digits)."""
    try:
        t = datetime.datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
        try:
            from zoneinfo import ZoneInfo
            return t.astimezone(ZoneInfo("Africa/Cairo")).strftime("%Y-%m-%d %H:%M")
        except Exception:
            return t.astimezone(datetime.timezone(datetime.timedelta(hours=2))).strftime("%Y-%m-%d %H:%M")
    except Exception:
        return time.strftime("%Y-%m-%d %H:%M", time.gmtime()) + " UTC"
def notice_line(item):
    """The whole e-mail body: name — role — time. Nothing else (Instinct asked for no message text; the outbox has no patient data)."""
    clean = lambda v: re.sub(r"\s+", " ", str(v or "")).strip()[:80]
    return "%s — %s — %s" % (clean(item.get("employee_name")) or "موظف", clean(item.get("role_label")) or "موظف", cairo_time(item.get("created_at")))
def instinct_notify(send=None):
    """Lease new outbox lines, e-mail each new question, ack sent / failed (a failed line comes back next tick, 5 tries max)."""
    if not secret(): return
    res = api("lease", {"limit": 10}, NOTIFY_API)
    items = (res or {}).get("items") or []
    if not items: return
    token = res.get("lease_token"); ok_ids, bad = [], []
    for it in items:
        if it.get("kind") != "new_question": ok_ids.append(it["id"]); continue   # drafts: Instinct wrote them itself
        try:
            m = EmailMessage(); m["From"] = ADDR; m["To"] = TO; m["Subject"] = "Swnw | سؤال جديد في مساعد إنستنكت"
            m["Message-ID"] = email.utils.make_msgid(domain="swnw.voiceover")
            m.set_content(notice_line(it))
            if send: send(m)
            else:
                with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=30) as s: s.login(ADDR, password()); s.send_message(m)
            ok_ids.append(it["id"]); log("instinct notice sent", it["id"])
        except Exception as e:
            bad.append((it["id"], type(e).__name__ + ": " + str(e)[:200])); log("instinct notice error", it["id"], type(e).__name__)
    if ok_ids: api("ack", {"lease_token": token, "ids": ok_ids, "ok": True}, NOTIFY_API)
    for i, err in bad: api("ack", {"lease_token": token, "ids": [i], "ok": False, "error": err}, NOTIFY_API)

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
    tail = {}  # database jobs done in the last 2 hours: links that come after the mp3 are still collected
    for p in glob.glob(os.path.join(BASE, "done", "db-*.json")):
        j = json.load(open(p))
        if j.get("message_id") and time.time() - j.get("done_at", 0) < 7200: tail[j["message_id"]] = (p, j)
    if not pending and not tail: return
    M = imaplib.IMAP4_SSL("imap.gmail.com", 993); M.login(ADDR, password()); M.select("INBOX")
    typ, data = M.search(None, '(FROM "instinct.com" SINCE "%s")' % time.strftime("%d-%b-%Y", time.gmtime(time.time() - 3 * 86400)))
    for num in data[0].split():
        typ, msg = M.fetch(num, "(RFC822)"); m = email.message_from_bytes(msg[0][1])
        refs = (m.get("In-Reply-To", "") + " " + m.get("References", "")).split()
        hit = next((k for k in pending if k in refs), None)
        if not hit:
            late = next((k for k in tail if k in refs), None)
            if late:
                p, j = tail.pop(late); new = add_clips(j, links(m))
                if new and api("clips", {"id": j["db_id"], "clips": new}) is not None: save(p, j); log("clips", os.path.basename(p), len(new))
            continue
        p, j = pending[hit]; jid = os.path.splitext(os.path.basename(p))[0]  # stays pending until a reply carries the mp3
        new = add_clips(j, links(m))
        if new:
            save(p, j); log("clips", jid, len(new))
            if j.get("db_id") and not any(pt.get_content_type() in ("audio/mpeg", "audio/mp3") or (pt.get_filename() or "").lower().endswith(".mp3") for pt in m.walk()):
                api("clips", {"id": j["db_id"], "clips": new})  # links-only reply: show them now, the mp3 comes later
        for part in m.walk():
            fn = part.get_filename() or ""
            if part.get_content_type() in ("audio/mpeg", "audio/mp3") or fn.lower().endswith(".mp3"):
                out = os.path.join(BASE, "out", jid + ".mp3"); open(out, "wb").write(part.get_payload(decode=True)); j["audio"] = out; break
        if not j.get("audio"): continue  # e.g. the suggested-shots message: keep looking for the mp3
        pending.pop(hit)
        if j.get("video"):
            vid = os.path.join(BASE, "out", jid + ".mp4")
            r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", j["video"], "-i", j["audio"], "-map", "0:v:0", "-map", "1:a:0",
                                "-c:v", "copy", "-af", "highpass=f=80,equalizer=f=3000:t=q:w=1:g=3,loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-shortest", vid], capture_output=True, text=True)
            j["video_out"] = vid if r.returncode == 0 else None; j["ffmpeg_error"] = r.stderr[-400:] if r.returncode else None
        if j.get("db_id"):
            r = api("done", {"id": j["db_id"], "audio_base64": base64.b64encode(open(j["audio"], "rb").read()).decode(), "clips": j.get("clips") or []})
            if r is None: save(p, j); log("db done report failed, retry next tick", jid); continue
            j["db_reported"] = "done" if r.get("ok") else r.get("reason")
        finish(p, j); log("done", jid, j.get("video_out") or j["audio"])
    M.logout()
if __name__ == "__main__":
    for d in ("queue", "out", "done"): os.makedirs(os.path.join(BASE, d), exist_ok=True)
    instinct_notify(); pull_db(); send_new(); poll(); report_db()
