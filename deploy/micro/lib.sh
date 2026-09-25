# Shared by install.sh and update.sh. Apps: name|GitHub repo|env prefix|port|domain variable
APPS=(
  "tally|AdelAd8l/tally|TALLY|8101|TALLY_DOMAIN"
  "gam3a|AdelAd8l/Gam3a|GAM3A|8102|GAM3A_DOMAIN"
)
ROOT=/opt/apps
export UV_PYTHON_INSTALL_DIR=$ROOT/python UV_CACHE_DIR=$ROOT/.uv-cache

app_field() { # app_field <name> <index>
  local row
  for row in "${APPS[@]}"; do
    IFS='|' read -r -a f <<<"$row"
    [[ ${f[0]} == "$1" ]] && { echo "${f[$2]}"; return; }
  done
  return 1
}

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

# Download the latest package built by GitHub Actions, install it next to the old one,
# switch over and restart. The previous two versions are kept for a quick rollback.
deploy_app() {
  local name=$1 repo dir tmp version current
  repo=$(app_field "$name" 1)
  dir=$ROOT/$name
  mkdir -p "$dir/releases"
  tmp=$(mktemp -d)
  log "Downloading $name"
  curl -fsSL "https://github.com/$repo/releases/download/latest/$name.tar.gz" -o "$tmp/pkg.tar.gz"
  tar -xzf "$tmp/pkg.tar.gz" -C "$tmp" ./VERSION
  version=$(cut -c1-12 "$tmp/VERSION")
  current=""
  [[ -L $dir/current ]] && current=$(basename "$(readlink "$dir/current")")
  if [[ $version == "$current" && ${FORCE:-0} != 1 ]]; then
    echo "$name is already up to date ($version)"
    rm -rf "$tmp"
    return
  fi
  rm -rf "$dir/releases/$version"
  mkdir -p "$dir/releases/$version"
  tar -xzf "$tmp/pkg.tar.gz" -C "$dir/releases/$version"
  rm -rf "$tmp"
  log "Installing $name $version"
  uv venv --quiet --python 3.12 "$dir/releases/$version/.venv"
  uv pip install --quiet --python "$dir/releases/$version/.venv/bin/python" -r "$dir/releases/$version/requirements.txt"
  chown -R apps:apps "$dir"
  ln -sfn "$dir/releases/$version" "$dir/current"
  systemctl restart "apps@$name"
  # keep the newest three
  ls -1dt "$dir"/releases/*/ | tail -n +4 | xargs -r rm -rf
  wait_healthy "$name"
}

wait_healthy() {
  local port i
  port=$(app_field "$1" 3)
  for i in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then
      echo "$1 is running on port $port"
      return
    fi
    sleep 2
  done
  echo "!! $1 did not start. Look at: journalctl -u apps@$1 -n 50" >&2
  return 1
}

SETTINGS=/etc/apps/install.env
DATA=/var/lib/apps

# Replace (or add) KEY='value' in install.env.
set_setting() {
  local key=$1 value=$2
  touch "$SETTINGS"
  sed -i "/^$key=/d" "$SETTINGS"
  printf "%s='%s'\n" "$key" "$value" >>"$SETTINGS"
  chmod 600 "$SETTINGS"
}

# Point one app's service at a database URL (in its env file) and restart it.
use_database() {
  local name=$1 url=$2 prefix env
  prefix=$(app_field "$name" 2)
  env=/etc/apps/$name.env
  sed -i "/^${prefix}_DATABASE_URL=/d" "$env"
  echo "${prefix}_DATABASE_URL=$url" >>"$env"
  set_setting "${prefix}_DATABASE_URL" "$url"
  systemctl restart "apps@$name"
  wait_healthy "$name"
}

# Run copy_db.py with an app's own Python, as the apps user.
copy_database() {
  local name=$1
  shift
  install -m 644 "$(dirname "${BASH_SOURCE[0]}")/copy_db.py" "$ROOT/copy_db.py"
  (cd "$ROOT/$name/current" && sudo -u apps .venv/bin/python "$ROOT/copy_db.py" "$@")
}
