#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu server (Oracle Cloud, Hetzner, DigitalOcean…).
#   ./setup.sh
# Installs Docker, opens ports 80/443, writes .env with fresh secrets, and starts everything.
set -euo pipefail
cd "$(dirname "$0")"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# ---- 1. swap: the 1 GB fallback servers need it to build the apps ----------------------
if [ "$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)" -lt 3000 ] && ! swapon --show | grep -q .; then
  say "Adding 2 GB of swap (small server)"
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# ---- 2. Docker ------------------------------------------------------------------------
if ! command -v docker >/dev/null; then
  say "Installing Docker"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER" || true
fi

# ---- 3. Firewall: Oracle's Ubuntu images block everything but SSH by default -----------
say "Opening ports 80 and 443 on this machine"
for port in 80 443; do
  sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null ||
    sudo iptables -I INPUT 1 -p tcp --dport "$port" -j ACCEPT
done
sudo iptables -C INPUT -p udp --dport 443 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT 1 -p udp --dport 443 -j ACCEPT
if command -v netfilter-persistent >/dev/null; then
  sudo netfilter-persistent save >/dev/null
else
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y iptables-persistent >/dev/null && sudo netfilter-persistent save >/dev/null
fi
if command -v ufw >/dev/null && sudo ufw status | grep -q active; then
  sudo ufw allow 80/tcp && sudo ufw allow 443
fi

# ---- 4. .env with generated secrets ---------------------------------------------------
if [ ! -f .env ]; then
  say "Creating .env"
  cp .env.example .env
  read -rp "DuckDNS token (from duckdns.org, top of the page): " token
  sed -i "s|^DUCKDNS_TOKEN=.*|DUCKDNS_TOKEN=${token}|" .env
  for key in POSTGRES_PASSWORD TALLY_SECRET_KEY GAM3A_SECRET_KEY; do
    sed -i "s|^${key}=.*|${key}=$(openssl rand -hex 32)|" .env
  done
  read -rp "Will you import your existing data from Neon next? [Y/n] " answer
  if [[ "${answer:-y}" =~ ^[Nn] ]]; then
    sed -i 's|^ALLOW_SIGNUP=.*|ALLOW_SIGNUP=true|' .env
    echo "Sign-ups are open so you can create your accounts. Close them afterwards (see README)."
  fi
fi
set -a; . ./.env; set +a

# ---- 5. Point DuckDNS at this server now, so HTTPS certificates can be issued ----------
say "Updating DuckDNS (${DUCKDNS_DOMAINS})"
result=$(curl -fsS "https://www.duckdns.org/update?domains=${DUCKDNS_DOMAINS}&token=${DUCKDNS_TOKEN}&ip=" || true)
if [ "$result" != "OK" ]; then
  echo "DuckDNS said: ${result:-no answer}. Check DUCKDNS_TOKEN and DUCKDNS_DOMAINS in .env, then run ./setup.sh again."
  exit 1
fi
echo "OK: both names now point to $(curl -fsS https://api.ipify.org || echo 'this server')"

# ---- 6. Build and start ----------------------------------------------------------------
say "Building and starting (the first build takes a few minutes)"
sudo docker compose up -d --build

say "Done"
cat <<MSG
  Tally: https://${TALLY_DOMAIN}
  Gam3a: https://${GAM3A_DOMAIN}

HTTPS certificates are issued in the first minute; if the browser warns, wait a bit and reload.
Next: bring your data over from Neon with  ./import-from-neon.sh
MSG
