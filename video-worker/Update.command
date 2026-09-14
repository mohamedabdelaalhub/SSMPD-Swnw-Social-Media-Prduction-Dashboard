#!/bin/zsh
set -e

WORKER_DIR="$HOME/SSMPDVideoWorker"
AGENT_LABEL="com.ssmpd.video-worker"
AGENT_FILE="$HOME/Library/LaunchAgents/${AGENT_LABEL}.plist"
BASE="https:"
REPO="mohamedabdelaalhub/SSMPD-Swnw-Social-Media-Prduction-Dashboard"
SOURCE="${BASE}//raw.githubusercontent.com/$REPO/main/video-worker"
BACKUP="$WORKER_DIR/backup-dashboard-$(date +%Y%m%d-%H%M%S)"

if [[ ! -d "$WORKER_DIR" ]]; then
  echo "❌ فولدر العامل غير موجود: $WORKER_DIR"
  exit 1
fi

mkdir -p "$BACKUP"
for file in worker.py cover_candidates.py eleven_tts.py drive_archive.py brand_identity.py; do
  [[ -f "$WORKER_DIR/$file" ]] && cp "$WORKER_DIR/$file" "$BACKUP/"
  curl -fsSL "$SOURCE/$file" -o "$WORKER_DIR/$file"
done

python3 -m py_compile "$WORKER_DIR/worker.py" "$WORKER_DIR/cover_candidates.py" "$WORKER_DIR/eleven_tts.py" "$WORKER_DIR/drive_archive.py" "$WORKER_DIR/brand_identity.py"

if [[ -f "$AGENT_FILE" ]]; then
  launchctl bootout "gui/$(id -u)" "$AGENT_FILE" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$AGENT_FILE"
  launchctl kickstart -k "gui/$(id -u)/$AGENT_LABEL"
fi

echo "✅ تم تحديث العامل."
echo "Backup: $BACKUP"
echo "العامل يعمل في الخلفية؛ استخدم الداشبورد فقط لإنتاج الفيديوهات."
