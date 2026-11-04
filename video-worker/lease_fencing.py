"""Worker-side lease fencing helpers (DRAFT, not wired into worker.py, stdlib only).

Pairs with supabase/drafts/20261104_video_job_fencing.sql. All network access goes through an injected `rpc(name, payload)` callable so the
logic is testable with fakes (no Supabase, no Drive, no credentials)."""
from __future__ import annotations

import re
import shutil
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable

STALE_MARK = "stale claim"
_SAFE = re.compile(r"^[A-Za-z0-9._-]+$")


class LeaseLost(Exception):
    """The job was reclaimed, finished, cancelled or the token is wrong: stop all work and write nothing."""


def attempt_object_path(job_id: str, attempt: int, filename: str) -> str:
    """Per-attempt storage/Drive object name: an older or zombie attempt can never overwrite a newer attempt's output."""
    if not _SAFE.match(str(job_id)) or not _SAFE.match(filename):
        raise ValueError("unsafe object path component")
    if int(attempt) < 1:
        raise ValueError("attempt must be >= 1")
    return f"{job_id}/attempt-{int(attempt):02d}/{filename}"


class LeaseGuard:
    def __init__(self, rpc: Callable[[str, dict], Any], job_id: str, claim_token: str, interval: float = 30.0):
        self._rpc, self.job_id, self._token, self._interval = rpc, job_id, claim_token, interval
        self._lost = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def _call(self, name: str, payload: dict) -> Any:
        if self._lost.is_set():
            raise LeaseLost(self.job_id)
        try:
            return self._rpc(name, payload)
        except Exception as e:                      # transient network errors are NOT a lost lease; only the server's stale answer is
            if STALE_MARK in str(e):
                self._lost.set()
                raise LeaseLost(self.job_id) from e
            raise

    def update(self, patch: dict) -> Any:
        return self._call("video_job_update_fenced", {"p_job_id": self.job_id, "p_claim_token": self._token, "p_patch": patch})

    def commit(self, attempt: int, result: dict) -> Any:
        """Server-authorized archive commit (video_job_commit_fenced): exactly one attempt can ever win; safe to retry."""
        return self._call("video_job_commit_fenced", {"p_job_id": self.job_id, "p_claim_token": self._token, "p_attempt": int(attempt), "p_result": result})

    def touch(self) -> None:
        self.update({})                            # empty patch: extends the lease (updated_at) or reveals that it is gone

    def check(self) -> None:
        if self._lost.is_set():
            raise LeaseLost(self.job_id)

    def _pulse(self) -> None:
        while not self._stop.wait(self._interval):
            try:
                self.touch()
            except LeaseLost:
                return
            except Exception:
                pass                                # keep trying; the next touch decides

    def __enter__(self) -> "LeaseGuard":
        self._thread = threading.Thread(target=self._pulse, daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *exc: Any) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)


@contextmanager
def guarded_attempt(job_dir: Path, guard: LeaseGuard):
    """Run one attempt. On lease loss the local job_dir is removed and LeaseLost propagates (no failed/ready write is attempted)."""
    try:
        yield guard
    except LeaseLost:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise


def stage_output(put: Callable[[str, bytes], str], guard: LeaseGuard, job_id: str, attempt: int, local: Path, filename: str) -> str:
    """Upload one output under the attempt-specific path; re-check the lease before and after so a zombie never reports success."""
    guard.check()
    url = put(attempt_object_path(job_id, attempt, filename), local.read_bytes())
    guard.check()
    return url
