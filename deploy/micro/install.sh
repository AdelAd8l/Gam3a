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

ask() { # ask VAR "question" [default] [secret]
  local var=$1 q=$2 def=${3:-} answer
  [[ -n ${!var:-} ]] && return
  if [[ -n ${4:-} ]]; then read -rsp "$q: " answer; echo; else read -rp "$q${def:+ [$def]}: " answer; fi
  printf -v "$var" '%s' "${answer:-$def}"
}

log "A few questions (answers are saved in $SETTINGS, readable by root only)"
ask TALLY_DOMAIN "Domain for Tally" "tally-me.duckdns.org"
ask GAM3A_DOMAIN "Domain for Gam3a" "gam3a.duckdns.org"
ask EMAIL "Your email (for the HTTPS certificates)"
ask DUCKDNS_TOKEN "DuckDNS token (duckdns.org, top of the page)" "" secret
ask TALLY_DATABASE_URL "Neon connection string for Tally (postgresql://...)" "" secret
ask GAM3A_DATABASE_URL "Neon connection string for Gam3a (a separate database)" "" secret
umask 077
cat >"$SETTINGS" <<CONF
TALLY_DOMAIN='$TALLY_DOMAIN'
GAM3A_DOMAIN='$GAM3A_DOMAIN'
EMAIL='$EMAIL'
DUCKDNS_TOKEN='$DUCKDNS_TOKEN'
TALLY_DATABASE_URL='$TALLY_DATABASE_URL'
GAM3A_DATABASE_URL='$GAM3A_DATABASE_URL'
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
IP=$(curl -fsS https://api.ipify.org)
SUBS=$(printf '%s\n' "$TALLY_DOMAIN" "$GAM3A_DOMAIN" | sed 's/\.duckdns\.org$//' | paste -sd,)
log "Pointing $SUBS.duckdns.org at $IP"
curl -fsS "https://www.duckdns.org/update?domains=$SUBS&token=$DUCKDNS_TOKEN&ip=$IP" | grep -q OK \
  || { echo "DuckDNS refused the update. Check the token and that both names exist in your DuckDNS account."; exit 1; }
cat >/etc/cron.d/apps-duckdns <<CRON
*/10 * * * * root curl -fsS "https://www.duckdns.org/update?domains=$SUBS&token=$DUCKDNS_TOKEN&ip=" >/dev/null 2>&1
CRON
chmod 600 /etc/cron.d/apps-duckdns

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
  [[ $name == gam3a ]] && echo "GAM3A_VAPID_SUBJECT=mailto:$EMAIL" >>"$env"
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
