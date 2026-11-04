"""Attempt-scoped archive protocol (DRAFT, not wired into worker.py, stdlib only).

Drive keeps one folder per attempt; the DATABASE decides which attempt wins (video_job_commit_fenced). A zombie's files stay in its own attempt
folder and are never referenced, so the first-writer-wins Drive bridge can no longer be poisoned and a retry with different bytes no longer
conflicts. Needs an ADDITIVE Apps Script action pair (video_archive_attempt / video_archive_cleanup); the existing video_archive action is untouched."""
from __future__ import annotations

import base64
import hashlib
from pathlib import Path
from typing import Any, Callable, Protocol

from lease_fencing import LeaseGuard, LeaseLost

COMMIT_RETRIES = 3


class Bridge(Protocol):
    def stage(self, job: dict, attempt: int, kind: str, path: Path) -> dict: ...
    def cleanup(self, job: dict, attempts: list[int], keep_attempt: int | None = None) -> None: ...


def archive_attempt(job: dict, attempt: int, files: dict[str, Path], bridge: Bridge, guard: LeaseGuard,
                    staged_out: dict | None = None) -> dict[str, Any]:
    """files maps kind ('video', 'cover', 'cover_1'...) to a local path; 'video' is required."""
    if "video" not in files:
        raise ValueError("video file required")
    guard.touch()
    staged: dict[str, dict] = {}
    try:
        for kind, path in files.items():
            guard.check()
            staged[kind] = bridge.stage(job, attempt, kind, path)
        if staged_out is not None:
            staged_out.update(staged)
        video = staged["video"]
        cover = staged.get("cover") or next((v for k, v in sorted(staged.items()) if k.startswith("cover")), None)
        result = {"drive_video_url": video["fileUrl"], "drive_video_id": video["fileId"], "drive_folder_url": video["folderUrl"]}
        if cover:
            result["cover_url"] = cover["fileUrl"]
        committed = None
        for tries in range(COMMIT_RETRIES):
            try:
                committed = guard.commit(attempt, result)          # authorization happens HERE, in the database, not before the upload
                break
            except LeaseLost:
                raise
            except Exception:
                if tries == COMMIT_RETRIES - 1:
                    raise                                           # unknown outcome: do NOT clean up, the commit may have succeeded
    except LeaseLost:
        _quiet_cleanup(bridge, job, [attempt], None)                # lost: remove only our own attempt folder
        raise
    _quiet_cleanup(bridge, job, list(range(1, attempt)), attempt)   # won: earlier attempts are losers; the bridge also refuses to touch `attempt`
    return committed


def _quiet_cleanup(bridge: Bridge, job: dict, attempts: list[int], keep: int | None) -> None:
    if not attempts:
        return
    try:
        bridge.cleanup(job, attempts, keep_attempt=keep)
    except Exception:
        pass                                                         # cleanup is best effort; leftovers are harmless (never referenced by the DB)


MAX_BYTES = 35 * 1024 * 1024


class DriveBridge:
    """Talks to the DRAFT bridge actions video_archive_attempt / video_archive_cleanup (apps-script/drafts/VideoArchiveAttempt.draft.gs).
    `post(payload) -> dict` is injected (drive_archive.post in production, a fake in tests)."""
    def __init__(self, post: Callable[[dict], dict]):
        self._post = post

    @staticmethod
    def _identity(job: dict) -> dict:
        return {"jobId": str(job["id"]), "contentId": str(job["content_id"]), "brand": job.get("brand") or "unassigned", "createdAt": job["created_at"]}

    def stage(self, job: dict, attempt: int, kind: str, path: Path) -> dict:
        path = Path(path)
        if not 0 < path.stat().st_size <= MAX_BYTES:
            raise RuntimeError("Drive bridge supports files up to 35 MiB. Output retained locally for retry.")
        data = path.read_bytes()
        payload = {"action": "video_archive_attempt", **self._identity(job), "contentTitle": job.get("title") or "", "attempt": int(attempt),
                   "kind": kind, "sha256": hashlib.sha256(data).hexdigest(), "base64": base64.b64encode(data).decode("ascii")}
        result = self._post(payload)
        if not result.get("ok") or result.get("archiveVersion") != 2 or result.get("attempt") != int(attempt) or not result.get("fileId"):
            raise RuntimeError("Drive attempt archive failed. Deploy the updated Apps Script bridge and retry.")
        for field in ("fileUrl", "folderUrl"):
            if not str(result.get(field, "")).startswith("https://drive.google.com/"):
                raise RuntimeError("Drive bridge returned an invalid archive link.")
        return result

    def cleanup(self, job: dict, attempts: list[int], keep_attempt: int | None = None) -> None:
        payload = {"action": "video_archive_cleanup", **self._identity(job), "attempts": [int(a) for a in attempts]}
        if keep_attempt is not None:
            payload["keepAttempt"] = int(keep_attempt)
        result = self._post(payload)
        if not result.get("ok"):
            raise RuntimeError("Drive attempt cleanup failed.")
