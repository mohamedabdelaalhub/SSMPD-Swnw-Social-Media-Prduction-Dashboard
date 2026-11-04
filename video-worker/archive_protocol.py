"""Attempt-scoped archive protocol (DRAFT, not wired into worker.py, stdlib only).

Drive keeps one folder per attempt; the DATABASE decides which attempt wins (video_job_commit_fenced). A zombie's files stay in its own attempt
folder and are never referenced, so the first-writer-wins Drive bridge can no longer be poisoned and a retry with different bytes no longer
conflicts. Needs an ADDITIVE Apps Script action pair (video_archive_attempt / video_archive_cleanup); the existing video_archive action is untouched."""
from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol

from lease_fencing import LeaseGuard, LeaseLost

COMMIT_RETRIES = 3


class Bridge(Protocol):
    def stage(self, job: dict, attempt: int, kind: str, path: Path) -> dict: ...
    def cleanup(self, job: dict, attempts: list[int]) -> None: ...


def archive_attempt(job: dict, attempt: int, files: dict[str, Path], bridge: Bridge, guard: LeaseGuard) -> dict[str, Any]:
    """files maps kind ('video', 'cover', 'cover_1'...) to a local path; 'video' is required."""
    if "video" not in files:
        raise ValueError("video file required")
    guard.touch()
    staged: dict[str, dict] = {}
    try:
        for kind, path in files.items():
            guard.check()
            staged[kind] = bridge.stage(job, attempt, kind, path)
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
        _quiet_cleanup(bridge, job, [attempt])                      # lost: remove only our own attempt folder
        raise
    _quiet_cleanup(bridge, job, list(range(1, attempt)))            # won: earlier attempts are losers
    return committed


def _quiet_cleanup(bridge: Bridge, job: dict, attempts: list[int]) -> None:
    if not attempts:
        return
    try:
        bridge.cleanup(job, attempts)
    except Exception:
        pass                                                         # cleanup is best effort; leftovers are harmless (never referenced by the DB)
