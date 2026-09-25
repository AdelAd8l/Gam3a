#!/usr/bin/env bash
# Install the newest build of each app (or just one) from GitHub and restart it.
#
#   sudo ./update.sh           # both apps
#   sudo ./update.sh gam3a     # one app
#   sudo FORCE=1 ./update.sh   # reinstall even if already current
set -euo pipefail
cd "$(dirname "$0")"
source ./lib.sh
[[ $EUID -eq 0 ]] || { echo "Run with sudo: sudo ./update.sh"; exit 1; }

if [[ $# -gt 0 ]]; then
  names=("$@")
else
  names=()
  for row in "${APPS[@]}"; do names+=("${row%%|*}"); done
fi
for name in "${names[@]}"; do
  app_field "$name" 0 >/dev/null || { echo "Unknown app: $name"; exit 1; }
  deploy_app "$name"
done
