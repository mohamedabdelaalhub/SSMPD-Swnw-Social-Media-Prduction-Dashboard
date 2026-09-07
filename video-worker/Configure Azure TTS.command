#!/bin/zsh
set -e

SERVICE="SSMPD Video Worker"

echo "========================================"
echo " SSMPD — Configure Azure Egyptian TTS"
echo "========================================"
echo
echo "هنستخدم صوت مصري Neural بدل صوت macOS."
echo "الافتراضي: ar-EG-SalmaNeural"
echo

read "?اكتب Azure Speech region: " REGION
if [[ -z "$REGION" ]]; then
  echo "❌ Region مطلوب."
  exit 1
fi

echo "الصق Azure Speech Key هنا."
echo "المفتاح لن يظهر على الشاشة وسيُحفظ فقط في macOS Keychain."
read -s AZURE_KEY
echo
if [[ -z "$AZURE_KEY" ]]; then
  echo "❌ Azure Speech Key مطلوب."
  exit 1
fi

echo
echo "اختيار الصوت:"
echo "1) Salma — أنثى مصرية (افتراضي)"
echo "2) Shakir — ذكر مصري"
read "?اختار 1 أو 2: " VOICE_CHOICE

if [[ "$VOICE_CHOICE" == "2" ]]; then
  VOICE="ar-EG-ShakirNeural"
else
  VOICE="ar-EG-SalmaNeural"
fi

security add-generic-password -U -s "$SERVICE" -a "azure_speech_region" -w "$REGION" >/dev/null
security add-generic-password -U -s "$SERVICE" -a "azure_speech_key" -w "$AZURE_KEY" >/dev/null
security add-generic-password -U -s "$SERVICE" -a "azure_speech_voice" -w "$VOICE" >/dev/null
unset AZURE_KEY

echo
echo "✅ Azure TTS محفوظ في Keychain."
echo "Voice: $VOICE"
echo
echo "شغّل Check.command للتأكد."
