#!/usr/bin/env bash
# Go back to the previous version of an app:  sudo ./rollback.sh gam3a
set -euo pipefail
cd "$(dirname "$0")"
source ./lib.sh
name=${1:?usage: sudo ./rollback.sh <tally|gam3a>}
dir=$ROOT/$name
current=$(readlink -f "$dir/current")
previous=$(ls -1dt "$dir"/releases/*/ | sed 's#/$##' | grep -vx "$current" | head -1)
[[ -n $previous ]] || { echo "No earlier version of $name is kept."; exit 1; }
ln -sfn "$previous" "$dir/current"
systemctl restart "apps@$name"
wait_healthy "$name"
echo "$name is back on $(basename "$previous")"
