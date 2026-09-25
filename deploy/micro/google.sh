#!/usr/bin/env bash
# Turn on Google Calendar sync for Gam3a (or change its keys).
# Get the two values from Google Cloud first: see "Google Calendar" in SERVER.md.
#
#   sudo ./google.sh
set -euo pipefail
cd "$(dirname "$0")"
source ./lib.sh
[[ $EUID -eq 0 ]] || { echo "Run with sudo: sudo ./google.sh"; exit 1; }
source "$SETTINGS"

echo "Paste the values from Google Cloud → APIs & Services → Credentials → your OAuth client."
while :; do
  read -rp "Client ID (ends with .apps.googleusercontent.com): " id
  id=$(echo "$id" | tr -d '[:space:]')
  [[ $id == *.apps.googleusercontent.com ]] && break
  echo "   That doesn't look like a Client ID."
done
while :; do
  read -rsp "Client secret (hidden while you paste): " secret
  echo
  secret=$(echo "$secret" | tr -d '[:space:]')
  [[ ${#secret} -ge 16 ]] && { echo "   (received ${#secret} characters)"; break; }
  echo "   That's too short for a client secret."
done

set_setting GAM3A_GOOGLE_CLIENT_ID "$id"
set_setting GAM3A_GOOGLE_CLIENT_SECRET "$secret"
env=/etc/apps/gam3a.env
sed -i '/^GAM3A_GOOGLE_CLIENT_ID=/d; /^GAM3A_GOOGLE_CLIENT_SECRET=/d; /^GAM3A_PUBLIC_URL=/d' "$env"
{
  echo "GAM3A_GOOGLE_CLIENT_ID=$id"
  echo "GAM3A_GOOGLE_CLIENT_SECRET=$secret"
  echo "GAM3A_PUBLIC_URL=https://$GAM3A_DOMAIN"
} >>"$env"
systemctl restart apps@gam3a
wait_healthy gam3a
echo
echo "Done. In Gam3a: Settings → Google Calendar → Connect Google Calendar."
echo "(The redirect URI in Google Cloud must be exactly: https://$GAM3A_DOMAIN/api/google/callback)"
