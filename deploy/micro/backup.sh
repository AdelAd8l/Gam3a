#!/usr/bin/env bash
# Back up the apps' database files (only apps whose data lives on this server).
# Safe while the apps run: SQLite's own backup copies a consistent snapshot.
set -euo pipefail
source /etc/apps/install.env
DIR=${BACKUP_DIR:-/var/backups/apps}
KEEP_DAYS=${BACKUP_KEEP_DAYS:-30}
mkdir -p "$DIR"
chmod 700 "$DIR"
stamp=$(date +%Y-%m-%d)
for name in tally gam3a; do
  prefix=${name^^}
  url_var=${prefix}_DATABASE_URL
  url=${!url_var:-}
  [[ $url == sqlite:///* ]] || continue
  file=${url#sqlite:///}
  out="$DIR/$name-$stamp.db"
  tmp="$(dirname "$file")/.backup-$stamp.db"
  # As the apps user: opening the live file as root could leave SQLite's side files
  # (-wal, -shm) owned by root, and the app could no longer open its own database.
  sudo -u apps python3 - "$file" "$tmp" <<'PY'
import sqlite3, sys
src = sqlite3.connect(sys.argv[1])
dst = sqlite3.connect(sys.argv[2])
src.backup(dst)
dst.close(); src.close()
PY
  mv "$tmp" "$out"
  gzip -f "$out"
  echo "$(date '+%F %T') $name -> $out.gz ($(du -h "$out.gz" | cut -f1))"
done
find "$DIR" -name '*.db.gz' -mtime +"$KEEP_DAYS" -delete
