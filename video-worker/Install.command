#!/bin/zsh
set -e

SCRIPT_DIR="${0:A:h}"
SERVICE="SSMPD Video Worker"
PROJECT_URL="https://uuijfbpgvtdxgaosqpxo.supabase.co"

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
echo
python3 "$SCRIPT_DIR/worker.py" --check
echo
echo "لو كل السطور فوق OK، شغّل Run Once.command لاختبار أول Video Job."
