"""Video archive through the dashboard's existing Apps Script bridge."""
import base64
import hashlib
import json
import os
import re
import urllib.request
from pathlib import Path


def bridge_url():
    url = os.environ.get("SSMPD_DRIVE_BRIDGE_URL", "").strip()
    if not url:
        root = Path(__file__).resolve().parent
        for config in (root / "config.js", root.parent / "config.js"):
            if config.exists():
                match = re.search(r'webAppUrl\s*:\s*[\"\']([^\"\']+)', config.read_text())
                url = match[1] if match else ""
                if url:
                    break
    if not re.fullmatch(r"https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec", url):
        raise RuntimeError("Configure the existing Drive bridge URL or install config.js beside video-worker.")
    return url


def upload(job, path, kind):
    path = Path(path)
    # Keep the JSON request below 50 MB after base64 expansion.
    if not 0 < path.stat().st_size <= 35 * 1024 * 1024:
        raise RuntimeError("Drive bridge supports files up to 35 MiB. Output retained locally for retry.")
    data = path.read_bytes()
    payload = {
        "action": "video_archive", "jobId": str(job["id"]),
        "contentId": str(job["content_id"]), "brand": job.get("brand") or "unassigned",
        "createdAt": job["created_at"], "contentTitle": job.get("title") or "",
        "kind": kind, "sha256": hashlib.sha256(data).hexdigest(),
        "base64": base64.b64encode(data).decode("ascii"),
    }
    req = urllib.request.Request(bridge_url(), data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "text/plain;charset=utf-8"}, method="POST")
    with urllib.request.urlopen(req, timeout=180) as response:
        result = json.load(response)
    if not result.get("ok") or result.get("archiveVersion") != 1 or not result.get("fileId"):
        raise RuntimeError("Drive archive failed. Deploy the updated existing Apps Script bridge and retry.")
    for field in ("fileUrl", "folderUrl"):
        if not str(result.get(field, "")).startswith("https://drive.google.com/"):
            raise RuntimeError("Drive bridge returned an invalid archive link.")
    return result
