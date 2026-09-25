#!/usr/bin/env bash
# Pulls the latest Tally and Gam3a from GitHub and restarts them. Data is kept.
#   ./update.sh
set -euo pipefail
cd "$(dirname "$0")"
git pull --ff-only || true   # update this deploy kit itself
sudo docker compose build --pull tally gam3a
sudo docker compose up -d
sudo docker image prune -f >/dev/null
echo "Updated."
