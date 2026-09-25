#!/usr/bin/env bash
# Copies your existing data from Neon into this server's database.
#   ./import-from-neon.sh
# Paste each app's Neon connection string when asked (or press Enter to skip that app).
# The app's current data on this server is replaced by what's in Neon.
set -euo pipefail
cd "$(dirname "$0")"

import() {
  local app=$1 url
  read -rp "Neon connection string for ${app} (Enter to skip): " url
  [ -z "$url" ] && { echo "Skipped ${app}."; return; }
  echo "Importing ${app}…"
  sudo docker compose stop "$app" >/dev/null
  # pg_dump runs inside the db container (Postgres 17 client, reads Neon over TLS).
  if sudo docker compose exec -T db sh -c \
      'pg_dump "$1" --no-owner --no-acl --clean --if-exists | psql -q -v ON_ERROR_STOP=1 -U app -d "$2" >/dev/null' \
      sh "$url" "$app"; then
    echo "${app}: imported."
  else
    echo "${app}: import failed. Nothing was deleted from Neon. Check the connection string and try again."
  fi
  sudo docker compose start "$app" >/dev/null
}

import tally
import gam3a

# The imported data includes your accounts, so new sign-ups can stay closed.
sed -i 's|^ALLOW_SIGNUP=.*|ALLOW_SIGNUP=false|' .env
sudo docker compose up -d tally gam3a >/dev/null
echo "Done. Sign in with your usual email and password."
