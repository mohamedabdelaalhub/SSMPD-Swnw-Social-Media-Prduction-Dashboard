# Patient-file name check (local OCR)

Warns staff when the name printed on an uploaded patient file differs from the patient's record.
Everything runs on the clinic server. Files are read from Google Drive into a RAM-only tmpfs inside
a locked-down container, and deleted as soon as they have been checked. Neither the document text
nor the file is stored or sent to any outside service. The only thing kept is the verdict in
`patient_file_name_checks`. For a mismatch, that includes the short name printed on the document,
so staff can see what is wrong. This is a warning only: uploads are never blocked.

- `match.py`: the matcher (stdlib). Tests: `python3 -m unittest tests/test_patient_file_name_check.py`.
- `worker.py`: one pass over `patient_file_name_check_queue` → Drive download → `pdftotext` /
  `pdftoppm` + `tesseract -l ara+eng` → `patient_file_name_check_record`.
- `deploy/`: Dockerfile (Debian + tesseract ara/eng + poppler, about 100 MB, no sudo needed on
  the host), `run-once.sh` (read-only container, no capabilities, 1 GB RAM / 2 CPU cap, tmpfs work
  dir), and a systemd user timer (every 10 min, nice 15).

## Server setup (main chat, after the owner's «انشر»)
1. Apply `supabase/migrations/20261115170000_patient_file_name_checks.sql`.
2. Build the image: `cd server/patient_file_name_check && docker build -f deploy/Dockerfile -t swnw-file-name-check:latest .`
3. Create `~/.config/swnw/file-name-check.env` (chmod 600) with `SUPABASE_URL=http://127.0.0.1:18200` (local PostgREST; the container uses host networking) and `SUPABASE_SERVICE_ROLE_KEY`.
   Place the archive Drive service-account JSON at `~/.config/swnw/drive-service-account.json` (chmod 600).
4. Copy `deploy/run-once.sh` to `~/claude-work/file-name-check/`. Install the user units.
   Run one pass by hand and check that the journal shows only file ids and verdicts.
   Then run `systemctl --user enable --now swnw-file-name-check.timer`.
