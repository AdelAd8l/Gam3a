#!/usr/bin/env bash
# Put an app's data back to a nightly backup.
#
#   sudo ./restore-backup.sh gam3a               # lists the backups
#   sudo ./restore-backup.sh gam3a 2026-10-02    # restores that day
#
# The current file is kept next to it (…db.before-restore-<time>), so this can be undone.
set -euo pipefail
cd "$(dirname "$0")"
source ./lib.sh
[[ $EUID -eq 0 ]] || { echo "Run with sudo."; exit 1; }
source "$SETTINGS"
name=${1:?usage: sudo ./restore-backup.sh <tally|gam3a> [YYYY-MM-DD]}
prefix=$(app_field "$name" 2) || { echo "Unknown app: $name"; exit 1; }
url_var=${prefix}_DATABASE_URL
url=${!url_var}
[[ $url == sqlite:///* ]] || { echo "$name's data is on Neon, not on this server; restore it from the Neon console."; exit 1; }
file=${url#sqlite:///}
dir=${BACKUP_DIR:-/var/backups/apps}
if [[ -z ${2:-} ]]; then
  echo "Backups of $name:"
  ls -1 "$dir"/"$name"-*.db.gz 2>/dev/null | sed "s#.*/$name-##; s#\.db\.gz##" || echo "  (none yet)"
  exit 0
fi
backup="$dir/$name-$2.db.gz"
[[ -f $backup ]] || { echo "No backup for $2. Run without a date to list them."; exit 1; }
systemctl stop "apps@$name"
mv "$file" "$file.before-restore-$(date +%Y%m%d-%H%M%S)"
rm -f "$file-wal" "$file-shm"
gunzip -c "$backup" >"$file"
chown apps:apps "$file"
systemctl start "apps@$name"
wait_healthy "$name"
echo "$name is back to $2."
