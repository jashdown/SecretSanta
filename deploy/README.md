# Running on an Ubuntu server

This sets the app up as a systemd service, so it starts when the server boots
and restarts if it crashes. Apache passes requests to it, with Cloudflare in
front:

```
browser ──https──▶ Cloudflare ──https──▶ Apache :443 ──http──▶ app on 127.0.0.1:3000
```

The site is `santa.justinashdown.com`. To use a different name, change it in
`react-router.config.ts` (`allowedActionOrigins`) and in the Apache site file,
then rebuild.

## 1. Install Node

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version
```

Any version from 22.13 up works. The service expects Node at `/usr/bin/node`,
which is where this puts it.

## 2. Get the code and build it

```bash
sudo mkdir -p /opt/patton-secret-santa
sudo chown $USER: /opt/patton-secret-santa
git clone https://github.com/jashdown/SecretSanta.git /opt/patton-secret-santa
cd /opt/patton-secret-santa
npm ci
npm run build
```

## 3. Create the service user and settings

The app runs as its own user, which can't write anywhere except its database
folder (`/var/lib/patton-secret-santa`, created by systemd).

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin santa
sudo install -m 600 /opt/patton-secret-santa/.env.example /etc/patton-secret-santa.env
sudo nano /etc/patton-secret-santa.env
```

Fill in `ADMIN_PASSWORD`, `SESSION_SECRET` (make one with
`openssl rand -hex 32`) and the SMTP settings (see the main README for Gmail).
Keep settings in this file, not in a `.env` in the app folder.

## 4. Start the service

```bash
sudo cp /opt/patton-secret-santa/deploy/patton-secret-santa.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now patton-secret-santa
systemctl status patton-secret-santa
curl -I http://127.0.0.1:3000
```

`enable` is what brings it back after a reboot. The last command should show
`200 OK`. To follow the logs (including preview emails, if SMTP isn't set up
yet):

```bash
journalctl -u patton-secret-santa -f
```

If something else already uses port 3000, add `PORT=3001` to
`/etc/patton-secret-santa.env` and change the port in the Apache site file.

## 5. Cloudflare

1. **DNS:** add a record named `santa`, proxied (orange cloud). Use a CNAME to
   `justinashdown.com` if that already points at this server, otherwise an A
   record with the server's IP.
2. **Origin certificate:** the server already has a Cloudflare Origin
   Certificate in `/etc/ssl/certs` (`cloudflare-justinashdown-com.pem` and
   `cloudflare-justinashdown-com-key.pem`), and the Apache site file uses it.
   Check that it covers `*.justinashdown.com`:

   ```bash
   sudo openssl x509 -noout -ext subjectAltName -in /etc/ssl/certs/cloudflare-justinashdown-com.pem
   ```

   If it doesn't, or it expires, create a new one under SSL/TLS → Origin
   Server for `*.justinashdown.com` and `justinashdown.com`, and save it over
   those two files.
3. **SSL mode:** should be Full (strict). It applies to the whole domain, so if
   other sites still rely on Flexible, leave it and add a Configuration Rule
   for `santa.justinashdown.com` that sets SSL to Full (strict).

No cache rules are needed. Cloudflare only caches the static files, which have
versioned names.

## 6. Apache

```bash
sudo a2enmod ssl proxy proxy_http
sudo cp /opt/patton-secret-santa/deploy/santa.justinashdown.com.conf /etc/apache2/sites-available/
sudo a2ensite santa.justinashdown.com
sudo apache2ctl configtest && sudo systemctl restart apache2
```

The site file uses the certificate from step 5, so save that first. If
`configtest` reports an error, fix it before restarting, or Apache won't start
and your other sites go down too.

Open https://santa.justinashdown.com and sign in.

## Updating

```bash
cd /opt/patton-secret-santa
git pull
npm ci
npm run build
sudo systemctl restart patton-secret-santa
```

Database changes apply on start. Don't restart while emails are going out.

## Backups

The database is `/var/lib/patton-secret-santa/secret-santa.db`. This makes a
safe copy while the app is running; then copy it off the server:

```bash
sudo apt-get install -y sqlite3
sudo -u santa sqlite3 /var/lib/patton-secret-santa/secret-santa.db \
  ".backup /var/lib/patton-secret-santa/backup.db"
```

## If something's wrong

- **Apache says `SSLCertificateFile: file ... does not exist or is empty`:**
  the certificate from step 5 isn't saved at the path in the site file. Save
  it there, or point the site file at a certificate you already have.
- **"Bad Request" when signing in or saving:** the address in the browser
  doesn't match `allowedActionOrigins` in `react-router.config.ts`. Fix it,
  rebuild and restart.
- **Signing in just shows the sign-in page again:** the login cookie only works
  over https. Use the https address.
- **502 or 503 from Apache:** the app isn't running. Check
  `journalctl -u patton-secret-santa -n 50`.
- **Cloudflare error 521:** Cloudflare can't reach Apache on port 443 (firewall,
  or the site isn't enabled). **526:** the certificate isn't valid for Full
  (strict); check the paths in the Apache site file.
