#!/usr/bin/env bash
# Restores one app's database from a daily backup.
#   ./restore.sh gam3a backups/gam3a-2026-10-01.sql.gz
set -euo pipefail
cd "$(dirname "$0")"
app=${1:?usage: ./restore.sh tally|gam3a backups/<file>.sql.gz}
file=${2:?usage: ./restore.sh tally|gam3a backups/<file>.sql.gz}
[[ "$app" == tally || "$app" == gam3a ]] || { echo "App must be tally or gam3a"; exit 1; }
read -rp "Replace ALL current ${app} data with ${file}? [y/N] " ok
[[ "$ok" =~ ^[Yy] ]] || exit 0
sudo docker compose stop "$app"
sudo docker compose exec -T db psql -q -U app -d postgres \
  -c "DROP DATABASE IF EXISTS \"$app\" WITH (FORCE);" -c "CREATE DATABASE \"$app\" OWNER app;"
gunzip -c "$file" | sudo docker compose exec -T db psql -q -v ON_ERROR_STOP=1 -U app -d "$app" >/dev/null
sudo docker compose start "$app"
echo "Restored ${app} from ${file}."
