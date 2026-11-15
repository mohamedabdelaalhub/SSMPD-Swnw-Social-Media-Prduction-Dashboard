"""Local OCR worker for the patient-file name-mismatch warning. Runs ON THE CLINIC SERVER only.

One run (`python3 -m patient_file_name_check.worker --once`) takes up to BATCH new patient files
from the patient_file_name_check_queue RPC, downloads each from Google Drive with the archive
service account into a RAM-only work dir, extracts text locally (pdftotext, else pdftoppm +
tesseract ara+eng), compares the name with the patient record (match.py) and stores only the
verdict via patient_file_name_check_record. The file and its text are deleted at once and never
logged or sent anywhere else. Logs carry file ids and verdicts only.

Environment (read from the process env; secrets come from a root-only env file / mounted file):
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY        PostgREST RPC access
  GOOGLE_SERVICE_ACCOUNT_KEY_FILE                 path to the service-account JSON (read-only mount)
  WORK_DIR (default /work, a tmpfs)  BATCH (10)  MAX_BYTES (15 MB)  PDF_PAGES (2)
"""
import base64, json, os, shutil, subprocess, sys, tempfile, time, urllib.parse, urllib.request

try:
    from .match import check
except ImportError:  # executed as a script
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from patient_file_name_check.match import check

ENGINE = "local-tesseract"


def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def run_cmd(args, timeout=120, input_bytes=None):
    r = subprocess.run(args, input=input_bytes, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=timeout)
    if r.returncode != 0:
        raise RuntimeError(args[0] + " failed")
    return r.stdout


def drive_token(key_file, run=run_cmd):
    key = json.load(open(key_file, encoding="utf-8"))
    now = int(time.time())
    head = _b64url(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
    claim = _b64url(json.dumps({"iss": key["client_email"], "scope": "https://www.googleapis.com/auth/drive.readonly",
                                "aud": "https://oauth2.googleapis.com/token", "iat": now, "exp": now + 3600}).encode())
    signing_input = (head + "." + claim).encode()
    with tempfile.NamedTemporaryFile("w", delete=True, dir=os.environ.get("WORK_DIR", "/work")) as pem:
        os.chmod(pem.name, 0o600)
        pem.write(key["private_key"]); pem.flush()
        sig = run(["openssl", "dgst", "-sha256", "-sign", pem.name], input_bytes=signing_input)
    body = urllib.parse.urlencode({"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                                   "assertion": signing_input.decode() + "." + _b64url(sig)}).encode()
    with urllib.request.urlopen(urllib.request.Request("https://oauth2.googleapis.com/token", data=body), timeout=30) as r:
        return json.load(r)["access_token"]


def drive_download(token, file_id, dest, max_bytes):
    url = "https://www.googleapis.com/drive/v3/files/" + urllib.parse.quote(file_id) + "?alt=media&supportsAllDrives=true"
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + token})
    with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as out:
        total = 0
        while True:
            chunk = r.read(65536)
            if not chunk:
                break
            total += len(chunk)
            if total > max_bytes:
                raise ValueError("too large")
            out.write(chunk)


def extract_text(path, mime, workdir, run=run_cmd, pdf_pages=2):
    if mime == "application/pdf":
        text = run(["pdftotext", "-l", str(pdf_pages), "-enc", "UTF-8", path, "-"]).decode("utf-8", "replace")
        if len(text.strip()) >= 40:
            return text
        prefix = os.path.join(workdir, "page")
        run(["pdftoppm", "-r", "200", "-l", str(pdf_pages), "-png", path, prefix])
        pages = sorted(f for f in os.listdir(workdir) if f.startswith("page") and f.endswith(".png"))
        return "\n".join(run(["tesseract", os.path.join(workdir, p), "-", "-l", "ara+eng", "--psm", "3"]).decode("utf-8", "replace")
                         for p in pages)
    return run(["tesseract", path, "-", "-l", "ara+eng", "--psm", "3"]).decode("utf-8", "replace")


class Rpc:
    def __init__(self, url, key):
        self.url, self.key = url.rstrip("/"), key

    def __call__(self, fn, args):
        req = urllib.request.Request(self.url + "/rest/v1/rpc/" + fn, data=json.dumps(args).encode(), method="POST",
                                     headers={"apikey": self.key, "Authorization": "Bearer " + self.key,
                                              "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return json.loads(raw) if raw else None


def process_one(row, rpc, token_fn, download, extract, base_workdir, log=print):
    """Handle one queue row. Never raises; always records a verdict so the file leaves the queue."""
    fid = row["file_id"]
    if row.get("is_encrypted"):
        rpc("patient_file_name_check_record", {"p_file_id": fid, "p_verdict": "unreadable", "p_score": None,
                                               "p_detected_name": None, "p_engine": "skipped-encrypted"})
        log(json.dumps({"file": fid, "verdict": "unreadable", "reason": "encrypted"})); return "unreadable"
    work = tempfile.mkdtemp(prefix="nc-", dir=base_workdir)
    try:
        src = os.path.join(work, "src")
        download(token_fn(), row["drive_file_id"], src)
        result = check(row.get("patient_name") or "", extract(src, row.get("mime_type") or "", work))
        verdict = result["verdict"]
        rpc("patient_file_name_check_record", {"p_file_id": fid, "p_verdict": verdict, "p_score": result["score"],
                                               "p_detected_name": result["detected_name"] if verdict == "mismatch" else None,
                                               "p_engine": ENGINE})
    except Exception as e:  # noqa: BLE001 — record and move on; never log content
        verdict = "error"
        try:
            rpc("patient_file_name_check_record", {"p_file_id": fid, "p_verdict": "error", "p_score": None,
                                                   "p_detected_name": None, "p_engine": ENGINE + ":" + type(e).__name__})
        except Exception:  # noqa: BLE001
            pass
    finally:
        shutil.rmtree(work, ignore_errors=True)
    log(json.dumps({"file": fid, "verdict": verdict}))
    return verdict


def main(argv=None):
    env = os.environ
    rpc = Rpc(env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"])
    workdir = env.get("WORK_DIR", "/work")
    max_bytes = int(env.get("MAX_BYTES", str(15 * 1024 * 1024)))
    pages = int(env.get("PDF_PAGES", "2"))
    token_cache = {}

    def token():
        if "t" not in token_cache or time.time() - token_cache["at"] > 3000:
            token_cache.update(t=drive_token(env["GOOGLE_SERVICE_ACCOUNT_KEY_FILE"]), at=time.time())
        return token_cache["t"]

    rows = rpc("patient_file_name_check_queue", {"p_limit": int(env.get("BATCH", "10")), "p_days": 30}) or []
    for row in rows:
        process_one(row, rpc, token, lambda t, f, d: drive_download(t, f, d, max_bytes),
                    lambda p, m, w: extract_text(p, m, w, pdf_pages=pages), workdir)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
