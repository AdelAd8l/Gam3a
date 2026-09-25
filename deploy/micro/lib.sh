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
  current=$(readlink "$dir/current" 2>/dev/null | xargs -r basename)
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
