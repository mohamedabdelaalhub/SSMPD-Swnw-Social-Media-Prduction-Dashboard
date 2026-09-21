#!/bin/zsh
set -e

WORKER_DIR="$HOME/SSMPDVideoWorker"
AGENT_LABEL="com.ssmpd.video-worker"
AGENT_FILE="$HOME/Library/LaunchAgents/${AGENT_LABEL}.plist"
LOG_DIR="$WORKER_DIR/logs"
BASE="https:"
REPO="mohamedabdelaalhub/SSMPD-Swnw-Social-Media-Prduction-Dashboard"
SOURCE="${BASE}//raw.githubusercontent.com/$REPO/main/video-worker"
BACKUP="$WORKER_DIR/backup-dashboard-$(date +%Y%m%d-%H%M%S)"

if [[ ! -d "$WORKER_DIR" ]]; then
  echo "❌ فولدر العامل غير موجود: $WORKER_DIR"
  exit 1
fi

mkdir -p "$BACKUP" "$LOG_DIR" "$HOME/Library/LaunchAgents"
STAGING="$(mktemp -d "$WORKER_DIR/update-XXXXXX")"
trap 'rm -rf "$STAGING"' EXIT
for file in worker.py cover_candidates.py eleven_tts.py drive_archive.py brand_identity.py image_storyboard.py; do
  [[ -f "$WORKER_DIR/$file" ]] && cp "$WORKER_DIR/$file" "$BACKUP/"
  curl -fsSL "$SOURCE/$file" -o "$STAGING/$file"
done

python3 -m py_compile "$STAGING/worker.py" "$STAGING/cover_candidates.py" "$STAGING/eleven_tts.py" "$STAGING/drive_archive.py" "$STAGING/brand_identity.py" "$STAGING/image_storyboard.py"
launchctl bootout "gui/$(id -u)" "$AGENT_FILE" >/dev/null 2>&1 || true
for file in worker.py cover_candidates.py eleven_tts.py drive_archive.py brand_identity.py image_storyboard.py; do
  mv "$STAGING/$file" "$WORKER_DIR/$file"
done

PYTHON_BIN="$(command -v python3)"
cat > "$AGENT_FILE" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$AGENT_LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$PYTHON_BIN</string><string>$WORKER_DIR/worker.py</string></array>
  <key>WorkingDirectory</key><string>$WORKER_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG_DIR/worker.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/worker-error.log</string>
</dict></plist>
EOF

launchctl bootout "gui/$(id -u)" "$AGENT_FILE" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$AGENT_FILE"
launchctl kickstart -k "gui/$(id -u)/$AGENT_LABEL"

echo "✅ تم تحديث العامل وتشغيله تلقائيًا في الخلفية."
echo "Backup: $BACKUP"
echo "استخدم الداشبورد فقط لإنتاج الفيديوهات."
