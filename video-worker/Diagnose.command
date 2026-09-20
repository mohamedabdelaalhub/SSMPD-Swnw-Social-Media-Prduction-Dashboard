#!/bin/bash
# Read-only diagnostics. Never claims a job or prints credentials.
python3 - <<'PY'
import json, pathlib, subprocess, urllib.request, urllib.error, os
print('فحص عامل الفيديو — بدون تشغيل مهام أو توليد مدفوع')
root = pathlib.Path.home() / 'SSMPDVideoWorker'
print('ملف العامل موجود', (root / 'worker.py').is_file())
state = subprocess.run(['launchctl', 'print', f'gui/{os.getuid()}/com.ssmpd.video-worker'], capture_output=True, text=True)
print('خدمة التشغيل مسجلة', state.returncode == 0)
for line in state.stdout.splitlines():
    if line.strip().startswith(('state =', 'last exit code =', 'pid =')):
        print(line.strip())
def secret(account):
    result = subprocess.run(['security', 'find-generic-password', '-s', 'SSMPD Video Worker', '-a', account, '-w'], capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else ''
url, key = secret('supabase_url').rstrip('/'), secret('service_role_key')
expected = 'https://uuijfbpgvtdxgaosqpxo.supabase.co'
print('المشروع مطابق للداشبورد', url == expected)
print('مفتاح العامل محفوظ', bool(key))
def read(path):
    headers = {'apikey': key}
    if not key.startswith('sb_secret_'):
        headers['Authorization'] = 'Bearer ' + key
    req = urllib.request.Request(url + '/rest/v1/' + path, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return json.load(response)
    except urllib.error.HTTPError as err:
        print('تعذر قراءة البيانات — HTTP', err.code)
    except Exception:
        print('تعذر الاتصال بالخادم')
    return []
if url == expected and key:
    workers = read('video_worker_heartbeats?select=status,last_seen_at,current_job_id&order=last_seen_at.desc&limit=3')
    print('آخر اتصال بالعامل')
    print(json.dumps(workers, ensure_ascii=False, indent=2))
    jobs = read('video_jobs?select=id,status,created_at,updated_at,attempt_count&order=created_at.desc&limit=5')
    print('آخر خمس مهام')
    print(json.dumps(jobs, ensure_ascii=False, indent=2))
print('انتهى الفحص. ابعت صورة النتيجة لتحديد سبب الانتظار.')
PY
read -r -p 'اضغط Enter لإغلاق النافذة' answer
