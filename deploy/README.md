# Running Tally and Gam3a on your own server

One small Linux server runs both apps **24/7** (no sleeping), with:

- HTTPS for `tally-me.duckdns.org` and `gam3a.duckdns.org` (Let's Encrypt, automatic)
- one Postgres database per app, on the server itself
- daily backups at 03:00 UTC in `deploy/backups/`, keeping 14 days
- DuckDNS kept pointing at the server, in case its IP ever changes
- one-command updates from GitHub

```
 phone ──HTTPS──▶ Caddy ──▶ tally ──┐
                    └─────▶ gam3a ──┴──▶ Postgres ──▶ daily backups
```

---

## 1. Create the free Oracle Cloud server (~15 min)

1. **Sign up** at <https://www.oracle.com/cloud/free/>.
   - **Home region:** pick one close to you, such as **UAE East (Dubai)**, **Saudi Arabia West (Jeddah)** or **Germany Central (Frankfurt)**. It **can't be changed later**, and the free servers only exist in your home region.
   - **Card:** a card is needed to verify your identity. Always Free resources aren't charged.
2. **Create the server:** go to **☰ → Compute → Instances → Create instance**.
   - **Image:** *Change image* → **Canonical Ubuntu 24.04**.
   - **Shape:** *Change shape* → **Ampere** → **VM.Standard.A1.Flex** with **2 OCPUs** and **12 GB** memory. This is Always Free; the limit is 4 OCPUs and 24 GB in total.
     - *"Out of capacity"?* Try another *Availability domain* or try again later. If it keeps failing, pick **VM.Standard.E2.1.Micro** (AMD, also free). The setup adds swap memory so it still works.
   - **Networking:** keep *Create new virtual cloud network* and **Assign a public IPv4 address**.
   - **SSH keys:** click **Save private key** and keep the file safe. You need it to log in.
   - Click **Create** and wait until the instance is **Running**, then copy its **Public IP address**.
3. **Open the web ports in Oracle's firewall:**
   - On the instance page, click the **Subnet** link, then the **Default Security List**, then **Add Ingress Rules**.
   - Add two rules, both with **Source CIDR** `0.0.0.0/0`, **IP Protocol** TCP, and **Destination port** `80` for one and `443` for the other.

## 2. DuckDNS

Sign in at <https://www.duckdns.org>. You already have `tally-me` and `gam3a`. Copy the **token** shown at the top of the page; the setup script asks for it and points both names at your server.

## 3. Install everything (~10 min, mostly waiting)

**Log in to the server from your computer:**

```bash
# Windows: use PowerShell. macOS/Linux: Terminal.
ssh -i path/to/ssh-key.key ubuntu@YOUR_PUBLIC_IP
```

> If the key is "too open" on macOS/Linux: `chmod 600 path/to/ssh-key.key`.

**Then, on the server:**

```bash
git clone https://github.com/AdelAd8l/Gam3a.git
cd Gam3a/deploy
./setup.sh
```

It asks for your DuckDNS token and a yes/no about importing from Neon, then builds and starts everything. When it's done, open **https://gam3a.duckdns.org**. The first HTTPS certificate takes up to a minute.

## 4. Bring your data over from Neon

```bash
./import-from-neon.sh
```

Paste each app's Neon connection string when asked. Find it in Neon → your project → **Connect**, picking the right database. Your accounts, terms, courses, grades, transactions and budgets all come along, so sign in with your usual email and password.

Then:

- On your phone, remove the old home-screen icons, open the new addresses and **Add to Home Screen** again.
- Once everything looks right, **delete the Render services**. You can keep Neon as an extra copy, or delete it too.

---

## Everyday commands (run inside `Gam3a/deploy`)

| What | Command |
|---|---|
| Get my latest changes from GitHub | `./update.sh` |
| See what's running | `sudo docker compose ps` |
| Watch the logs | `sudo docker compose logs -f gam3a` (or `tally`, `caddy`) |
| Restart everything | `sudo docker compose restart` |
| Restore a backup | `./restore.sh gam3a backups/gam3a-2026-10-01.sql.gz` |
| Open sign-ups for someone | set `ALLOW_SIGNUP=true` in `.env`, then `sudo docker compose up -d` |

**Off-server backup copy:** back up `deploy/backups/` somewhere else now and then, for example from your computer:

```bash
scp -i path/to/ssh-key.key -r ubuntu@YOUR_PUBLIC_IP:Gam3a/deploy/backups ./gam3a-backups
```

## If something's wrong

- **The browser can't connect:**
  - Check the two ingress rules (step 1.3).
  - Check `sudo docker compose ps` shows everything *running*.
- **"Your connection is not private":**
  - Wait a minute, then reload.
  - Otherwise run `sudo docker compose logs caddy`. It usually means ports 80/443 aren't reachable yet, or DuckDNS isn't pointing at this server. `./setup.sh` fixes the latter, and it's safe to run again.
- **Import failed:**
  - Copy the whole Neon string, including `?sslmode=require`.
  - Pick the right database for each app.
