#!/bin/zsh
set -e

SCRIPT_DIR="${0:A:h}"
SERVICE="SSMPD Video Worker"
PROJECT_URL="https://uuijfbpgvtdxgaosqpxo.supabase.co"
WORKER_DIR="$HOME/SSMPDVideoWorker"
AGENT_LABEL="com.ssmpd.video-worker"
AGENT_FILE="$HOME/Library/LaunchAgents/${AGENT_LABEL}.plist"
LOG_DIR="$WORKER_DIR/logs"

install_background_worker() {
  local python_bin
  python_bin="$(command -v python3)"
  mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"

  cat > "$AGENT_FILE" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$AGENT_LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$python_bin</string><string>$WORKER_DIR/worker.py</string></array>
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
}

echo "========================================"
echo " SSMPD Mac Video Worker — Setup"
echo "========================================"
echo

if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ python3 مش موجود."
  exit 1
fi

FFMPEG="/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg"
if [[ ! -x "$FFMPEG" ]]; then
  echo "❌ ffmpeg-full مش موجود في المسار المتوقع:"
  echo "$FFMPEG"
  exit 1
fi

security add-generic-password -U -s "$SERVICE" -a "supabase_url" -w "$PROJECT_URL" >/dev/null

echo "الصق Supabase Secret API key هنا (يبدأ عادةً بـ sb_secret_)."
echo "المفتاح لن يظهر على الشاشة وسيُحفظ فقط في macOS Keychain."
read -s SERVICE_KEY
echo

if [[ -z "$SERVICE_KEY" ]]; then
  echo "❌ لم يتم إدخال المفتاح."
  exit 1
fi

security add-generic-password -U -s "$SERVICE" -a "service_role_key" -w "$SERVICE_KEY" >/dev/null
unset SERVICE_KEY

chmod +x "$SCRIPT_DIR/worker.py" "$SCRIPT_DIR/Run Once.command" "$SCRIPT_DIR/Check.command"

echo
echo "✅ تم حفظ الإعدادات في macOS Keychain."
python3 "$SCRIPT_DIR/worker.py" --check
install_background_worker
echo "✅ العامل يعمل تلقائيًا في الخلفية."
echo "من الآن استخدم الداشبورد لإنشاء أو إعادة إنتاج الفيديوهات."
