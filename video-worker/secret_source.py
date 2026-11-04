"""Secret sources that work on any OS: an environment variable, or a file named by NAME_FILE (root/service-user readable, e.g. a Docker/systemd secret).
The value is never logged. macOS Keychain stays as the last fallback in the callers (macOS only)."""
from __future__ import annotations

import os
from pathlib import Path


def env_or_file(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if value:
        return value
    path = os.environ.get(name + "_FILE", "").strip()
    if not path:
        return ""
    try:
        return Path(path).read_text(encoding="utf-8").strip()
    except OSError:
        return ""
