# Tally & Gam3a on the Oracle server: how it works and how to update

The server is Oracle `VM.Standard.E2.1.Micro` (1 CPU, 1 GB RAM), public IP `129.151.141.143`.
It runs Smart Bio as well; nothing here touches it.

| App | Address | Service | Local port | Data file |
| --- | --- | --- | --- | --- |
| Tally | https://tally-me.duckdns.org | `apps@tally` | 8101 | `/var/lib/apps/tally/tally.db` |
| Gam3a | https://gam3a.duckdns.org | `apps@gam3a` | 8102 | `/var/lib/apps/gam3a/gam3a.db` |

---

## 1. Updating (the everyday part)

When new code is pushed to GitHub:

1. **Wait for the green ✓** on the latest run:
   <https://github.com/AdelAd8l/Gam3a/actions> and <https://github.com/AdelAd8l/tally/actions>.
   The green run is what builds the package the server downloads. A red ✗ means don't update yet.
2. **On the server:**

   ```bash
   cd ~/gam3a && git pull                 # newest scripts (and this guide)
   sudo ./deploy/micro/update.sh          # both apps
   ```

   Each app prints either `… is already up to date (abc123…)` or
   `Installing … ` then `… is running on port 81xx`. That's it.

   ```bash
   sudo ./deploy/micro/update.sh tally    # just one app
   sudo FORCE=1 ./deploy/micro/update.sh  # reinstall even if it's already current
   ```

3. **Check** the two sites open and you can sign in.

**If an update misbehaves**, go back to the version before it (takes seconds):

```bash
sudo ~/gam3a/deploy/micro/rollback.sh gam3a     # or tally
```

**Your data during updates:** the app is down for about 2 seconds while it restarts. Phones
keep working offline and send their changes once it's back. Database changes needed by a new
version are applied automatically when it starts, and they only ever *add* things, so rolling
back is safe. For extra peace of mind before a big update, take a backup first:
`sudo /opt/apps/backup.sh`.

---

## 2. How it's put together

```
 phone / browser
      │  https://gam3a.duckdns.org
      ▼
 DuckDNS ── says the name means 129.151.141.143
      │
      ▼
 Oracle firewall (ports 80, 443 open, same as for Smart Bio)
      │
      ▼
 nginx  (HTTPS certificates from Let's Encrypt; one site per domain)
      ├── smart-bio.duckdns.org, smartbiolearning.duckdns.org ─▶ Smart Bio (unchanged)
      ├── tally-me.duckdns.org  ─▶ 127.0.0.1:8101 ─▶ apps@tally ─▶ /var/lib/apps/tally/tally.db
      └── gam3a.duckdns.org     ─▶ 127.0.0.1:8102 ─▶ apps@gam3a ─▶ /var/lib/apps/gam3a/gam3a.db
```

- **nginx** is the only thing reachable from the internet. It handles HTTPS and passes requests
  to the apps, which only listen on `127.0.0.1` (the server itself).
- **Each app is one Python process** (FastAPI + uvicorn) run by systemd as the unprivileged user
  `apps`. The same process serves the website files and the API, and once a minute it checks
  whether any notification is due (lectures, deadlines, budget alerts, daily reminder…).
- **Each app keeps its data in one SQLite file** on this server. SQLite runs inside the app, so
  there's no separate database server using memory; queries take well under a millisecond.
- **Nothing is built on this server.** GitHub Actions tests each push to `main`, builds the website,
  and publishes a ready-to-run package (`gam3a.tar.gz` / `tally.tar.gz`) on the repo's
  **Releases → latest**. `update.sh` downloads it, installs it next to the old version, and
  switches over.
- **Memory:** each app is capped at 300 MB by systemd (usually ~120 MB), so they can never
  crowd out Smart Bio. A 2 GB swap file gives extra headroom.

---

## 3. Where everything is

### The kit (scripts and this guide)

| Path | What |
| --- | --- |
| `~/gam3a/` | A copy of the Gam3a repo, cloned from GitHub. Only its `deploy/micro/` folder is used here. `git pull` keeps it current. |
| `~/gam3a/deploy/micro/install.sh` | First-time setup (safe to run again: it keeps secrets and saved answers). |
| `~/gam3a/deploy/micro/update.sh` | Install the newest build of one or both apps. |
| `~/gam3a/deploy/micro/rollback.sh` | Go back to the previous version of an app. |
| `~/gam3a/deploy/micro/move-db.sh` | Move data between this server and Neon (`to-server` / `to-neon`). |
| `~/gam3a/deploy/micro/restore-backup.sh` | Put an app's data back to a nightly backup. |
| `~/gam3a/deploy/micro/backup.sh`, `copy_db.py`, `lib.sh`, `apps@.service`, `nginx-site.conf` | Pieces the scripts above use. |

### Settings and secrets (readable by root only)

| Path | What |
| --- | --- |
| `/etc/apps/install.env` | Your answers to the installer: domains, email, database addresses (`TALLY_DATABASE_URL`, `GAM3A_DATABASE_URL`), and the old Neon addresses (`TALLY_NEON_URL`, `GAM3A_NEON_URL`) kept for `move-db.sh to-neon`. Optional `BACKUP_DIR` / `BACKUP_KEEP_DAYS`. |
| `/etc/apps/tally.env`, `/etc/apps/gam3a.env` | What each service starts with: `PORT`, `…_DATABASE_URL`, `…_SECRET_KEY` (signs sign-in sessions; changing it signs everyone out), `…_COOKIE_SECURE=true`, `…_STATIC_DIR`, `…_ALLOW_SIGNUP` (only the starting value, the Admin page switch overrides it), and for Gam3a `GAM3A_VAPID_SUBJECT`. `install.sh` rewrites these from `install.env`. |

### The apps

| Path | What |
| --- | --- |
| `/opt/apps/tally/current` → `/opt/apps/tally/releases/<version>/` | The running version of Tally (a link to one of the release folders). Same layout for `gam3a`. |
| `…/releases/<version>/app/` | The Python code (API, notifications, admin). |
| `…/releases/<version>/static/` | The built website (what phones download and keep for offline use). |
| `…/releases/<version>/.venv/` | That version's Python packages. |
| `…/releases/<version>/VERSION` | The Git commit it was built from. |
| `/opt/apps/<app>/releases/` | The newest three versions are kept, for `rollback.sh`. |
| `/opt/apps/python/` | Python 3.12, installed by `uv` (independent of Ubuntu's own Python). |
| `/usr/local/bin/uv` | The tool that installs Python and packages. |
| `/opt/apps/backup.sh`, `/opt/apps/copy_db.py` | Installed copies used by cron and `move-db.sh`. |

### Data

| Path | What |
| --- | --- |
| `/var/lib/apps/tally/tally.db` | All of Tally: accounts, users, transactions, budgets, notification devices, the push keys, the sign-up setting. |
| `/var/lib/apps/gam3a/gam3a.db` | All of Gam3a: users, terms, courses, classes, deadlines, grades, notification devices, push keys, sign-up setting. |
| `….db-wal`, `….db-shm` | SQLite's working files next to each database. Normal; never delete them while the app runs. |
| `….db.old-…`, `….db.before-restore-…` | Earlier files kept aside by `move-db.sh` / `restore-backup.sh`. Safe to delete once you're sure. |

### Backups

| Path | What |
| --- | --- |
| `/var/backups/apps/<app>-YYYY-MM-DD.db.gz` | One compressed copy per app per day, kept 30 days. |
| `/etc/cron.d/apps-backup` | Runs `/opt/apps/backup.sh` every night at 03:17 (server time, UTC). |
| `/var/log/apps-backup.log` | What the last backup did. |

### System pieces

| Path | What |
| --- | --- |
| `/etc/systemd/system/apps@.service` | The service definition shared by both apps (`apps@tally`, `apps@gam3a`): runs as user `apps`, restarts on failure, 300 MB cap. |
| `/etc/nginx/sites-available/tally-me.duckdns.org`, `…/gam3a.duckdns.org` (linked in `sites-enabled/`) | nginx sites for the two apps; certbot added the HTTPS lines. Smart Bio's site files are separate and untouched. |
| `/etc/letsencrypt/live/<domain>/` | HTTPS certificates. They renew automatically about 30 days before expiry (`certbot.timer`, twice a day), for Smart Bio's sites too. Check with `sudo certbot renew --dry-run`. |
| `/swapfile` (in `/etc/fstab`), `/etc/sysctl.d/90-apps-swap.conf` | 2 GB swap, used only when memory is short. |
| `/etc/cron.d/apps-duckdns` | Only if a DuckDNS token was given (it wasn't): keeps the names pointed at the server. Without it, the IPs are set by hand on duckdns.org. |

### Outside the server

| Where | What |
| --- | --- |
| GitHub `AdelAd8l/Gam3a`, `AdelAd8l/tally` | Code; **Actions** tests and builds; **Releases → latest** holds the packages. |
| duckdns.org | `tally-me`, `gam3a`, `smart-bio`, `smartbiolearning` → `129.151.141.143`. |
| Neon | The old database copies from before the move (no longer updated). Used only if you run `move-db.sh to-neon`. |

---

## 4. Handy commands

```bash
# Are they running? (active (running) = good)
systemctl status apps@tally apps@gam3a

# Logs (errors, notification problems). -f follows live; Ctrl+C to stop.
journalctl -u apps@gam3a -n 100
journalctl -u apps@tally -f

# Restart one
sudo systemctl restart apps@gam3a

# Quick health check from the server itself
curl -s localhost:8101/api/health; echo; curl -s localhost:8102/api/health; echo

# Memory and disk
free -h
df -h /
du -sh /var/lib/apps/* /var/backups/apps

# nginx: test the config, then reload after any change
sudo nginx -t && sudo systemctl reload nginx

# HTTPS certificates and when they expire
sudo certbot certificates

# Backups: take one now / list / restore a day (the current file is kept aside)
sudo /opt/apps/backup.sh
sudo ~/gam3a/deploy/micro/restore-backup.sh gam3a
sudo ~/gam3a/deploy/micro/restore-backup.sh gam3a 2026-10-02

# Copy the backups to your computer (run the first line on the server, the second on your computer)
sudo cp /var/backups/apps/*.db.gz ~ && sudo chown ubuntu ~/*.db.gz
scp 'ubuntu@129.151.141.143:*.db.gz' .

# Look inside a database (read-only is safest)
sudo apt install -y sqlite3
sudo -u apps sqlite3 -readonly /var/lib/apps/tally/tally.db 'select id, email, is_admin from users;'
```

**In the apps themselves** (Admin tab, admins only): see every account, edit it, set a temporary
password, delete an account with all its data, and open or close sign-ups.

---

## 5. When something's wrong

| Symptom | Look at | Usual fix |
| --- | --- | --- |
| Site shows "502 Bad Gateway" | `systemctl status apps@<app>` and `journalctl -u apps@<app> -n 50` | The app isn't running. The log says why; `sudo systemctl restart apps@<app>`. If it started after an update, `rollback.sh`. |
| A domain shows Smart Bio | `ls /etc/nginx/sites-enabled/` | The app's nginx site is missing: run `sudo ./deploy/micro/install.sh` again. |
| Browser warns about the certificate | `sudo certbot certificates` | `sudo certbot renew`, then `sudo systemctl reload nginx`. |
| Site doesn't load at all | duckdns.org | The name must point at `129.151.141.143`. |
| Everything slow / server stuck | `free -h`, `top` | Check nothing else is eating memory; `sudo systemctl restart apps@tally apps@gam3a`. |
| Notifications stopped | `journalctl -u apps@gam3a \| grep -i push` | Use **Send a test** in Settings; turn notifications off and on again on the phone. |
| Forgot the admin password | — | Another admin can set a temporary one from the Admin page. If you're the only admin, ask for help: it's reset from the server with a one-line command. |

When asking for help, paste the output of `systemctl status apps@<app>` and the last lines of
`journalctl -u apps@<app> -n 50`. They contain no passwords or secrets.

---

## 6. Google: "Continue with Google" (both apps) and Calendar sync (Gam3a)

- **Continue with Google** on the sign-in page of both apps: signs in with a Google account, or
  creates the account the first time (only while sign-ups are open). It asks Google only for the
  name and email address. Accounts made this way have no password; one can be added in Settings.
- **Google Calendar sync** (Gam3a, Settings → Google Calendar): one calendar per course in the
  course's colour, with its classes, deadlines and (optionally) study sessions, kept up to date
  within a minute. Google reminders on those events: 10 minutes before each class and 1 day before
  each deadline by default (changeable in Settings, or off).

Each app needs its own "OAuth client" from Google, made **once**. Gam3a's also covers the Calendar.

### A. Gam3a's Google client (on your computer, ~10 minutes)

1. Open <https://console.cloud.google.com>, create a project named **Gam3a**.
2. **APIs & Services → Library** → **Google Calendar API** → **Enable**.
3. **Google Auth Platform** ("OAuth consent screen" in older menus) → **Get started**:
   app name **Gam3a**, your email, audience **External** → **Create**.
4. **Data access → Add or remove scopes**: `openid`, `.../auth/userinfo.email`,
   `.../auth/userinfo.profile` and `.../auth/calendar` → **Update** → **Save**.
5. **Audience → Publish app** ("In production"). In *Testing*, Google signs everyone out every 7 days.
6. **Clients → Create client** → **Web application**. **Authorized redirect URIs**, both:
   - `https://gam3a.duckdns.org/api/auth/google/callback` (sign-in)
   - `https://gam3a.duckdns.org/api/google/callback` (Calendar)
7. Copy the **Client ID** and **Client secret**.

If you already made this client for the Calendar: open it (**Clients** → your client), add the
first redirect URI above, **Save**, and you're done (no new keys needed).

### B. Tally's Google client (~5 minutes)

Same as A but simpler: a new project named **Tally**, no Calendar API, scopes `openid`,
`.../auth/userinfo.email`, `.../auth/userinfo.profile` only, **Publish app**, and one redirect URI:
`https://tally-me.duckdns.org/api/auth/google/callback`. (A separate project means Google's screen
says "Tally", not "Gam3a".)

### C. On the server

```bash
cd ~/gam3a && git pull
sudo ./deploy/micro/update.sh
sudo ./deploy/micro/google.sh gam3a    # paste Gam3a's Client ID, then its secret
sudo ./deploy/micro/google.sh tally    # paste Tally's
```

(If you already ran `google.sh` for Gam3a's Calendar, only the Tally line is new.)
The keys are stored in `/etc/apps/install.env` and `/etc/apps/<app>.env` (root only).

### Good to know

- Sign-in asks only for name and email, so there's no "unverified app" warning for it. Connecting
  **Google Calendar** does show **"Google hasn't verified this app"**: tap **Advanced → Go to
  gam3a.duckdns.org**. Expected for a personal app (up to 100 people).
- Continue with Google signs in to an existing account with the same email (the Google account is
  linked to it), including the admin account. Google only accepts verified emails.
- Closing sign-ups on the Admin page also stops new accounts through Google; existing ones still sign in.
- **Calendar:** Gam3a only touches the calendars it makes. Change a course's name or colour in
  Gam3a, not in Google. Only current and upcoming terms are synced. A Gam3a calendar deleted in
  Google is made again. If access is removed in the Google account, Settings says so until you
  connect again. **Disconnect** can also delete the Gam3a calendars. On Samsung phones they appear
  in Samsung Calendar too (menu → Manage calendars → your Google account).
- Gam3a's own notifications and the Google Calendar reminders are separate: turn either off in
  Settings if you only want one alert.
