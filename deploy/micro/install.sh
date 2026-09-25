#!/usr/bin/env bash
# Put Tally and Gam3a on a small Ubuntu server that already runs nginx (e.g. next to Smart Bio).
# Safe to run again: it keeps existing secrets and only adds what is missing.
#
#   sudo ./install.sh
set -euo pipefail
cd "$(dirname "$0")"
source ./lib.sh
[[ $EUID -eq 0 ]] || { echo "Run with sudo: sudo ./install.sh"; exit 1; }

mkdir -p /etc/apps
chmod 700 /etc/apps
SETTINGS=/etc/apps/install.env
[[ -f $SETTINGS ]] && source "$SETTINGS"

# ask VAR "question" [default] [secret] [pattern] [hint]
# Keeps a saved answer if it still looks valid; otherwise asks until the answer does.
ask() {
  local var=$1 q=$2 def=${3:-} secret=${4:-} pattern=${5:-} hint=${6:-} answer
  while :; do
    answer=${!var:-}
    if [[ -z $answer ]]; then
      if [[ -n $secret ]]; then
        read -rsp "$q: " answer
        echo
        # Neon's "Connect" box can copy it as: psql 'postgresql://...'
        answer=${answer#psql }
        answer=${answer#\'}
        answer=${answer%\'}
        answer=${answer#\"}
        answer=${answer%\"}
        [[ -n $answer ]] && echo "   (received ${#answer} characters)"
      else
        read -rp "$q${def:+ [$def]}: " answer
      fi
      answer=${answer:-$def}
    fi
    if [[ -z $pattern || $answer =~ $pattern ]]; then
      printf -v "$var" '%s' "$answer"
      return
    fi
    echo "   That doesn't look right. $hint"
    printf -v "$var" '%s' ""
  done
}

DOMAIN_RE='^[a-z0-9-]+(\.[a-z0-9-]+)+$'
# A Neon connection string, or (after move-db.sh) a database file on this server.
DB_RE='^(postgres(ql)?://[^[:space:]]+@[^[:space:]]+|sqlite:////[^[:space:]]+)$'
DB_HINT="Paste the whole connection string from Neon (it starts with postgresql:// and has an @ in it)."

log "A few questions (answers are saved in $SETTINGS, readable by root only)"
ask TALLY_DOMAIN "Domain for Tally" "tally-me.duckdns.org" "" "$DOMAIN_RE" "Type a domain like tally-me.duckdns.org, or press Enter."
ask GAM3A_DOMAIN "Domain for Gam3a" "gam3a.duckdns.org" "" "$DOMAIN_RE" "Type a domain like gam3a.duckdns.org, or press Enter."
ask EMAIL "Your email (for the HTTPS certificates)" "" "" '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' "Type an email address."
ask DUCKDNS_TOKEN "DuckDNS token (optional: press Enter to skip if you set the IP on duckdns.org yourself)" "" secret \
  '^$|^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' "A DuckDNS token looks like 1a2b3c4d-.... Press Enter to skip it."
echo "Paste the Neon connection strings below. Nothing shows while you paste (that's normal); then press Enter."
ask TALLY_DATABASE_URL "Neon connection string for Tally" "" secret "$DB_RE" "$DB_HINT"
ask GAM3A_DATABASE_URL "Neon connection string for Gam3a (a separate database)" "" secret "$DB_RE" "$DB_HINT"
if [[ $TALLY_DATABASE_URL == "$GAM3A_DATABASE_URL" && $TALLY_DATABASE_URL != sqlite* ]]; then
  echo "   Tally and Gam3a need different databases (in Neon: Databases -> New database -> gam3a)."
  GAM3A_DATABASE_URL=""
  ask GAM3A_DATABASE_URL "Neon connection string for Gam3a" "" secret "$DB_RE" "$DB_HINT"
fi
umask 077
extra=$(grep -sE '^(TALLY_NEON_URL|GAM3A_NEON_URL|BACKUP_DIR|BACKUP_KEEP_DAYS|GAM3A_GOOGLE_CLIENT_ID|GAM3A_GOOGLE_CLIENT_SECRET)=' "$SETTINGS" || true)
cat >"$SETTINGS" <<CONF
TALLY_DOMAIN='$TALLY_DOMAIN'
GAM3A_DOMAIN='$GAM3A_DOMAIN'
EMAIL='$EMAIL'
DUCKDNS_TOKEN='$DUCKDNS_TOKEN'
TALLY_DATABASE_URL='$TALLY_DATABASE_URL'
GAM3A_DATABASE_URL='$GAM3A_DATABASE_URL'
$extra
CONF
umask 022

# ---- memory -------------------------------------------------------------------------
if [[ $(swapon --noheadings | wc -l) -eq 0 ]]; then
  log "Adding 2 GB of swap (the server only has 1 GB of RAM)"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
  echo 'vm.swappiness=10' >/etc/sysctl.d/90-apps-swap.conf
  sysctl -q -p /etc/sysctl.d/90-apps-swap.conf
fi

# ---- packages -----------------------------------------------------------------------
log "Installing tools"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates certbot python3-certbot-nginx >/dev/null
if ! command -v uv >/dev/null; then
  curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 sh >/dev/null
fi
id apps >/dev/null 2>&1 || useradd --system --home "$ROOT" --shell /usr/sbin/nologin apps
mkdir -p "$ROOT"
uv python install --quiet 3.12

# ---- DNS: point both names at this server ------------------------------------------
IP=$(curl -fsS -4 https://api.ipify.org)
if [[ -n $DUCKDNS_TOKEN ]]; then
  SUBS=$(printf '%s\n' "$TALLY_DOMAIN" "$GAM3A_DOMAIN" | sed 's/\.duckdns\.org$//' | paste -sd,)
  log "Pointing $SUBS.duckdns.org at $IP"
  curl -fsS "https://www.duckdns.org/update?domains=$SUBS&token=$DUCKDNS_TOKEN&ip=$IP" | grep -q OK \
    || { echo "DuckDNS refused the update. Check the token and that both names exist in your DuckDNS account."; exit 1; }
  cat >/etc/cron.d/apps-duckdns <<CRON
*/10 * * * * root curl -fsS "https://www.duckdns.org/update?domains=$SUBS&token=$DUCKDNS_TOKEN&ip=" >/dev/null 2>&1
CRON
  chmod 600 /etc/cron.d/apps-duckdns
else
  # No token: the names must already point here (set on duckdns.org). Check before going on,
  # because the HTTPS certificates can only be issued once they do.
  log "Checking that both names point at this server ($IP)"
  wrong=()
  for domain in "$TALLY_DOMAIN" "$GAM3A_DOMAIN"; do
    [[ $(getent ahostsv4 "$domain" | awk 'NR==1{print $1}') == "$IP" ]] || wrong+=("$domain")
  done
  if [[ ${#wrong[@]} -gt 0 ]]; then
    echo
    echo "These names don't point at this server yet: ${wrong[*]}"
    echo "On duckdns.org, set their 'current ip' to:  $IP"
    echo "then wait a minute and run  sudo ./install.sh  again (your answers are remembered)."
    exit 1
  fi
fi

# ---- apps ---------------------------------------------------------------------------
install -m 644 apps@.service /etc/systemd/system/apps@.service
systemctl daemon-reload

for row in "${APPS[@]}"; do
  IFS='|' read -r name repo prefix port domvar <<<"$row"
  env=/etc/apps/$name.env
  dburl_var=${prefix}_DATABASE_URL
  secret=$(grep -s "^${prefix}_SECRET_KEY=" "$env" | cut -d= -f2- || true)
  secret=${secret:-$(openssl rand -hex 32)}
  log "Configuring $name (${!domvar})"
  umask 077
  cat >"$env" <<CONF
PORT=$port
${prefix}_DATABASE_URL=${!dburl_var}
${prefix}_SECRET_KEY=$secret
${prefix}_COOKIE_SECURE=true
${prefix}_STATIC_DIR=$ROOT/$name/current/static
${prefix}_ALLOW_SIGNUP=${ALLOW_SIGNUP:-true}
CONF
  if [[ $name == gam3a ]]; then
    echo "GAM3A_VAPID_SUBJECT=mailto:$EMAIL" >>"$env"
    echo "GAM3A_PUBLIC_URL=https://$GAM3A_DOMAIN" >>"$env"
    # Google Calendar sync, if set up with google.sh
    [[ -n ${GAM3A_GOOGLE_CLIENT_ID:-} ]] && echo "GAM3A_GOOGLE_CLIENT_ID=$GAM3A_GOOGLE_CLIENT_ID" >>"$env"
    [[ -n ${GAM3A_GOOGLE_CLIENT_SECRET:-} ]] && echo "GAM3A_GOOGLE_CLIENT_SECRET=$GAM3A_GOOGLE_CLIENT_SECRET" >>"$env"
  fi
  umask 022
  chown root:apps "$env"
  chmod 640 "$env"
  systemctl enable --quiet "apps@$name"
  FORCE=1 deploy_app "$name"

  site=/etc/nginx/sites-available/${!domvar}
  if [[ ! -f $site ]]; then
    sed "s/__DOMAIN__/${!domvar}/g; s/__PORT__/$port/g" nginx-site.conf >"$site"
    ln -sf "$site" /etc/nginx/sites-enabled/
  fi
done

log "Checking the nginx configuration (Smart Bio's sites are left as they are)"
nginx -t
systemctl reload nginx

# ---- HTTPS --------------------------------------------------------------------------
for domain in "$TALLY_DOMAIN" "$GAM3A_DOMAIN"; do
  log "Waiting for $domain to point here"
  for _ in $(seq 1 30); do
    [[ $(getent ahostsv4 "$domain" | awk 'NR==1{print $1}') == "$IP" ]] && break
    sleep 5
  done
  certbot --nginx --non-interactive --agree-tos --redirect -m "$EMAIL" -d "$domain" --keep-until-expiring
done

log "Done"
echo "Tally:  https://$TALLY_DOMAIN"
echo "Gam3a:  https://$GAM3A_DOMAIN"
echo "Update later with: sudo $(pwd)/update.sh"
free -h | head -2
