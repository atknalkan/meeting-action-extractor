#!/usr/bin/env bash
# Runs on the VM as root (deploy.sh uploads it). Installs the release in /tmp/meeting-actions, keeps the job database,
# and adds one Caddy site without touching the existing Caddyfile. Usage: install.sh <host name> <port>
set -euo pipefail
HOST_NAME="$1"; PORT="$2"
APP=/opt/meeting-actions; DATA=/var/lib/meeting-actions; STAGE=/tmp/meeting-actions

id meeting-actions >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin meeting-actions
install -d -o meeting-actions -g meeting-actions -m 700 "$DATA"
install -d -m 755 "$APP" /etc/meeting-actions

# The env file holds API keys: readable by root and the service only.
install -o root -g meeting-actions -m 640 "$STAGE/env" /etc/meeting-actions/env
echo "PORT=$PORT" >> /etc/meeting-actions/env

RELEASE="$APP/releases/$(date +%Y%m%d%H%M%S)"
mkdir -p "$RELEASE"
tar -xzf "$STAGE/release.tgz" -C "$RELEASE"
find "$RELEASE" -name "._*" -delete
# Readable by the service user whatever the umask was where it was built.
chmod -R u=rwX,go=rX "$RELEASE"
(cd "$RELEASE" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)
chown -R root:root "$RELEASE"
PREVIOUS=""
if [ -L "$APP/current" ] && [ -d "$(readlink -f "$APP/current")" ] && [ "$(readlink -f "$APP/current")" != "$RELEASE" ]; then PREVIOUS=$(readlink -f "$APP/current"); fi
ln -sfn "$RELEASE" "$APP/current"

install -m 644 "$STAGE/meeting-actions.service" /etc/systemd/system/meeting-actions.service
systemctl daemon-reload
systemctl enable meeting-actions >/dev/null
systemctl restart meeting-actions

ok=0
for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/.well-known/stellar-agent-services.json" >/dev/null; then ok=1; break; fi
  sleep 1
done
if [ "$ok" != 1 ]; then
  journalctl -u meeting-actions -n 40 --no-pager || true
  if [ -n "$PREVIOUS" ]; then ln -sfn "$PREVIOUS" "$APP/current"; systemctl restart meeting-actions; echo "rolled back to $PREVIOUS"
  else systemctl stop meeting-actions; echo "no previous release: service stopped"; fi
  exit 1
fi

# Caddy: our own site file, imported by a drop-in so the existing Caddyfile stays unchanged.
cat > /etc/caddy/meeting-actions.caddy <<CADDY
$HOST_NAME {
	encode gzip
	reverse_proxy 127.0.0.1:$PORT
}
CADDY
cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.before-meeting-actions
if ! grep -q 'meeting-actions.caddy' /etc/caddy/Caddyfile; then
  printf '\nimport /etc/caddy/meeting-actions.caddy\n' >> /etc/caddy/Caddyfile
fi
if ! caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1; then
  cp /etc/caddy/Caddyfile.before-meeting-actions /etc/caddy/Caddyfile
  echo "Caddy config did not validate: restored the previous Caddyfile" >&2
  exit 1
fi
systemctl reload caddy

# Keep the three newest releases.
ls -1dt "$APP"/releases/* | tail -n +4 | xargs -r rm -rf
rm -rf "$STAGE"
echo "installed $RELEASE"
