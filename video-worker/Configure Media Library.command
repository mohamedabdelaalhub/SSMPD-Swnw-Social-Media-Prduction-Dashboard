#!/bin/zsh
set -e

SERVICE="SSMPD Video Worker"

echo "========================================"
echo " SSMPD — Configure Media Library"
echo "========================================"
echo
echo "اختار فولدر الصور والفيديوهات اللي عامل الفيديو يقدر يستخدمها."
echo

MEDIA_ROOT=$(osascript -e 'set f to choose folder with prompt "اختار فولدر الصور والفيديوهات لـ SSMPD Video Worker"' -e 'POSIX path of f')

if [[ -z "$MEDIA_ROOT" ]]; then
  echo "❌ لم يتم اختيار فولدر."
  exit 1
fi

security add-generic-password -U -s "$SERVICE" -a "media_root" -w "$MEDIA_ROOT" >/dev/null

echo
echo "✅ تم حفظ Media Library:"
echo "$MEDIA_ROOT"
echo
open "$MEDIA_ROOT"
