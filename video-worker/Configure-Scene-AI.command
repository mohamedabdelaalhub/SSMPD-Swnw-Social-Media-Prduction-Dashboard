#!/bin/zsh
set -e

if [[ ! -f "$HOME/SSMPDVideoWorker/studio_generation.py" ]]; then
  echo "حدّث عامل الفيديو باستخدام Update.command أولًا."
  exit 1
fi

SCENE_API_SECRET="$(osascript -e 'text returned of (display dialog "مفتاح OpenAI API لتوليد مشاهد الصور والفيديو. سيُحفظ في Keychain على هذا الماك فقط." default answer "" with hidden answer buttons {"إلغاء", "حفظ"} default button "حفظ")')" || exit 0
if [[ -z "$SCENE_API_SECRET" ]]; then
  echo "لم يتم تغيير إعداد توليد المشاهد."
  exit 0
fi
security add-generic-password -U -s "SSMPD_SCENE_API_KEY" -a "$(whoami)" -w "$SCENE_API_SECRET" >/dev/null
unset SCENE_API_SECRET
echo "تم حفظ مفتاح توليد المشاهد. لم نغير مفتاح ElevenLabs أو البصمة الصوتية."
echo "لا يبدأ التوليد إلا عند إرسال مهمة فيها مشاهد AI من الداشبورد."
