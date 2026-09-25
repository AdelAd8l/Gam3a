#!/usr/bin/env bash
# Move the apps' data between Neon and this server.
#
#   sudo ./move-db.sh to-server          # both apps: Neon -> a database file on this server
#   sudo ./move-db.sh to-server gam3a    # just one
#   sudo ./move-db.sh to-neon            # back to Neon (replaces what Neon has)
#
# Each app is stopped for the few seconds the copy takes, so nothing changes mid-copy.
# Phones keep working offline meanwhile and send their changes once it's back.
set -euo pipefail
cd "$(dirname "$0")"
source ./lib.sh
[[ $EUID -eq 0 ]] || { echo "Run with sudo: sudo ./move-db.sh $*"; exit 1; }
source "$SETTINGS"

direction=${1:-}
[[ $direction == to-server || $direction == to-neon ]] || { sed -n '2,9p' "$0"; exit 1; }
shift
names=("$@")
[[ ${#names[@]} -gt 0 ]] || names=(tally gam3a)

for name in "${names[@]}"; do
  prefix=$(app_field "$name" 2) || { echo "Unknown app: $name"; exit 1; }
  url_var=${prefix}_DATABASE_URL
  neon_var=${prefix}_NEON_URL
  current=${!url_var}
  file=$DATA/$name/$name.db
  local_url="sqlite:///$file"

  if [[ $direction == to-server ]]; then
    if [[ $current == sqlite* ]]; then
      echo "$name already uses the database on this server ($file)."
      continue
    fi
    log "Copying $name from Neon to $file"
    install -d -o apps -g apps -m 750 "$DATA" "$DATA/$name"
    if [[ -e $file ]]; then  # left over from an earlier move: keep it aside, don't mix
      mv "$file" "$file.old-$(date +%Y%m%d-%H%M%S)"
      rm -f "$file-wal" "$file-shm"
    fi
    systemctl stop "apps@$name"
    if ! copy_database "$name" --src "$current" --dst "$local_url"; then
      echo "!! The copy failed; $name stays on Neon." >&2
      systemctl start "apps@$name"
      exit 1
    fi
    set_setting "$neon_var" "$current"  # remembered for to-neon
    use_database "$name" "$local_url"
    echo "$name now uses $file. Neon still holds the old copy (it is no longer updated)."
  else
    neon=${!neon_var:-}
    [[ $current == sqlite* ]] || { echo "$name already uses Neon."; continue; }
    [[ -n $neon ]] || { echo "No Neon connection string saved for $name."; exit 1; }
    log "Copying $name from $file back to Neon (Neon's old data is replaced)"
    systemctl stop "apps@$name"
    if ! copy_database "$name" --src "$current" --dst "$neon" --replace; then
      echo "!! The copy failed; $name stays on this server." >&2
      systemctl start "apps@$name"
      exit 1
    fi
    use_database "$name" "$neon"
    echo "$name now uses Neon. The file $file is kept as it was."
  fi
done

# Nightly backups of the database files (see backup.sh).
install -m 755 backup.sh "$ROOT/backup.sh"
cat >/etc/cron.d/apps-backup <<CRON
17 3 * * * root $ROOT/backup.sh >/var/log/apps-backup.log 2>&1
CRON
log "Backups: every night at 03:17, kept for 30 days in ${BACKUP_DIR:-/var/backups/apps}"
"$ROOT/backup.sh"
