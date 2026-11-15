#!/bin/sh
# One worker pass. Called by swnw-file-name-check.timer. No network except our API + Google Drive;
# files live only in a RAM tmpfs inside the container and vanish when it exits.
set -eu
ENV_FILE="${ENV_FILE:-$HOME/.config/swnw/file-name-check.env}"        # SUPABASE_URL=http://127.0.0.1:18200 (local PostgREST, stays on the box), SUPABASE_SERVICE_ROLE_KEY; chmod 600
KEY_FILE="${KEY_FILE:-$HOME/.config/swnw/drive-service-account.json}"   # read-only mount
exec docker run --rm --network host --read-only --cap-drop ALL --security-opt no-new-privileges \
  --memory 1g --cpus 2 --pids-limit 128 \
  --tmpfs /work:rw,size=256m,mode=1777 \
  --env-file "$ENV_FILE" -e GOOGLE_SERVICE_ACCOUNT_KEY_FILE=/run/key.json -e WORK_DIR=/work \
  -v "$KEY_FILE":/run/key.json:ro \
  swnw-file-name-check:latest
