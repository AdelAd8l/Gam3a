# Tally and Gam3a on a 1 GB server (next to another site)

This setup is for a small server that **already runs nginx**, like an Oracle
`VM.Standard.E2.1.Micro` (1 CPU, 1 GB RAM) that hosts Smart Bio. It adds the two apps
without touching the existing site:

```
 phone ──HTTPS──▶ nginx ─┬─▶ smart-bio (unchanged)
                         ├─▶ 127.0.0.1:8101  Tally ──┐
                         └─▶ 127.0.0.1:8102  Gam3a ──┴──▶ Neon (Postgres, free)
```

- **No Docker and no local database.** Each app is one small Python process (~120 MB),
  capped by systemd so it can never starve Smart Bio. The data lives on Neon.
- **Nothing is built on the server.** GitHub Actions builds each app on every push to
  `main` and publishes `tally.tar.gz` / `gam3a.tar.gz` on the repo's *latest* release; the
  server just downloads it.
- **HTTPS** from Let's Encrypt via certbot, renewed automatically.
- **2 GB swap** is added if the server has none.
- **DuckDNS** is kept pointing at the server.

## Before you start

1. **Two Neon databases.** Tally already has one: use the same connection string.
   For Gam3a, open the Neon console → your project → **Databases → New database** →
   name it `gam3a`, then **Connect** → copy the connection string for that database.
2. **Both names on DuckDNS** (<https://www.duckdns.org>): add `tally-me` and `gam3a`, and set
   each one's IP to the server's public IP, the same IP your other site (e.g. `smar-bio`)
   already shows there. Your DuckDNS token is optional: with it, the installer sets the IPs
   for you and keeps them updated; without it, it just checks they're right.
3. **The builds exist.** Open each repo's **Actions** tab: the latest run on `main`
   should be green, and **Releases → latest** should list `tally.tar.gz` / `gam3a.tar.gz`.
   The repositories need to be public for the server to download them.

## Install (about 5 minutes)

SSH into the server, then:

```bash
git clone https://github.com/AdelAd8l/Gam3a.git ~/gam3a
cd ~/gam3a/deploy/micro
sudo ./install.sh
```

It asks for the domains (press Enter to accept the defaults), your email, the DuckDNS
token (press Enter to skip) and the two connection strings. Paste those straight into the terminal; they're
stored in `/etc/apps/`, readable only by root. When it finishes, open
<https://tally-me.duckdns.org> and <https://gam3a.duckdns.org>.

Then, in Render, **suspend or delete the old Tally service**. Both use the same Neon
database, so nothing needs copying.

## Move the data onto this server (faster)

Neon is a database in another data centre, so every query makes a round trip, and on the free
plan it also sleeps after 5 minutes idle. Keeping the data in a file on this server (SQLite)
makes each query take well under a millisecond, uses no extra memory, and never sleeps.

```bash
cd ~/gam3a && git pull
sudo ./deploy/micro/move-db.sh to-server
```

For each app it stops the app for a few seconds, copies every table from Neon into
`/var/lib/apps/<app>/<app>.db` (checking the row counts match), switches the app over and
starts it again. Sign-ins, notifications and waiting offline changes all keep working. It also
turns on **nightly backups** (03:17, kept 30 days in `/var/backups/apps`).

- Changed your mind? `sudo ./deploy/micro/move-db.sh to-neon` copies everything back.
- Restore a backup: `sudo ./deploy/micro/restore-backup.sh gam3a` lists them;
  `sudo ./deploy/micro/restore-backup.sh gam3a 2026-10-02` restores that day.
- Back up now: `sudo /opt/apps/backup.sh`.
- Keep backups on the 150 GB disk: add `BACKUP_DIR='/mnt/data/backups'` (its mount point) to
  `/etc/apps/install.env`.
- For a copy off the server: `sudo cp /var/backups/apps/*.db.gz ~ && sudo chown ubuntu ~/*.db.gz`,
  then download them to your computer with `scp ubuntu@129.151.141.143:'~/*.db.gz' .`

## Everyday commands

| What | Command |
| --- | --- |
| Install the newest version of both apps | `sudo ~/gam3a/deploy/micro/update.sh` |
| …only one | `sudo ~/gam3a/deploy/micro/update.sh gam3a` |
| Undo the last update | `sudo ~/gam3a/deploy/micro/rollback.sh gam3a` |
| Is it running? | `systemctl status apps@tally apps@gam3a` |
| Logs | `journalctl -u apps@gam3a -n 100` |
| Restart | `sudo systemctl restart apps@gam3a` |
| Memory | `free -h` |

To update the kit itself first: `cd ~/gam3a && git pull`.

## Notes

- **Open or close sign-ups** from each app's **Admin** page (switch at the top). It takes effect
  at once and is stored in the database.
- **Notifications (Gam3a)** need HTTPS, which this setup provides. The push keys are created
  in the database on first start, so they survive reinstalls.
- **Backups:** Neon keeps a 1-day restore window on the free plan. For your own copies, run
  `pg_dump "<connection string>" | gzip > backup.sql.gz` from any machine now and then.
- **Ports:** the apps only listen on `127.0.0.1`; nginx is the only thing facing the internet.
  Ports 80 and 443 are already open for Smart Bio, so there's nothing to change in Oracle.
- **Bigger server?** `deploy/` (one level up) has a Docker setup with its own Postgres and
  daily backups, for machines with 2 GB+ of RAM.
