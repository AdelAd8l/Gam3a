#!/usr/bin/env bash
# Turn on "Continue with Google" (and, for Gam3a, Google Calendar sync), or change its keys.
# Get the two values from Google Cloud first: see section 6 of SERVER.md.
#
#   sudo ./google.sh gam3a
#   sudo ./google.sh tally
set -euo pipefail
cd "$(dirname "$0")"
source ./lib.sh
[[ $EUID -eq 0 ]] || { echo "Run with sudo: sudo ./google.sh <gam3a|tally>"; exit 1; }
source "$SETTINGS"
name=${1:-gam3a}
prefix=$(app_field "$name" 2) || { echo "Unknown app: $name (use gam3a or tally)"; exit 1; }
domvar=$(app_field "$name" 4)
domain=${!domvar}

echo "Google keys for $name ($domain)."
echo "Paste the values from Google Cloud → Google Auth Platform → Clients → your client."
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

set_setting "${prefix}_GOOGLE_CLIENT_ID" "$id"
set_setting "${prefix}_GOOGLE_CLIENT_SECRET" "$secret"
env=/etc/apps/$name.env
sed -i "/^${prefix}_GOOGLE_CLIENT_ID=/d; /^${prefix}_GOOGLE_CLIENT_SECRET=/d; /^${prefix}_PUBLIC_URL=/d" "$env"
{
  echo "${prefix}_GOOGLE_CLIENT_ID=$id"
  echo "${prefix}_GOOGLE_CLIENT_SECRET=$secret"
  echo "${prefix}_PUBLIC_URL=https://$domain"
} >>"$env"
systemctl restart "apps@$name"
wait_healthy "$name"
echo
echo "Done. The sign-in page now shows \"Continue with Google\"."
echo "Authorized redirect URIs in Google Cloud must include:"
echo "   https://$domain/api/auth/google/callback"
[[ $name == gam3a ]] && echo "   https://$domain/api/google/callback      (Calendar sync)"
exit 0
