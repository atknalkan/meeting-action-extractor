#!/usr/bin/env bash
# npm run deploy: builds, uploads the compiled code and the server's settings to the Oracle VM in target.env, and
# runs install.sh there. Uploads only what the server reads from .env: never a Stellar key (there is none).
set -euo pipefail
cd "$(dirname "$0")/../.."
source deploy/oracle/target.env
SSH_KEY="${SSH_KEY/#\~/$HOME}"
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes "$SSH_TARGET")

npm run build
BUILD=$(mktemp -d)
trap 'rm -rf "$BUILD"' EXIT
# COPYFILE_DISABLE keeps macOS ._* metadata files out of the archive.
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$BUILD/release.tgz" dist package.json package-lock.json vendor

# The server's settings: the public values launch saved, plus the model and facilitator keys.
( umask 077
  for name in STELLAR_NETWORK PAY_TO AGENT_ID PRICE_USDC GEMINI_API_KEY GROQ_API_KEY OPENROUTER_API_KEY FACILITATOR_AUTH SOROBAN_RPC_URL; do
    line=$(grep -E "^$name=" .env | tail -1 || true)
    [ -n "$line" ] && echo "$line"
  done
  echo "PUBLIC_ORIGIN=https://$HOST_NAME"
) > "$BUILD/env"
grep -q '^PAY_TO=G' "$BUILD/env" || { echo "PAY_TO is empty: run npm run launch first"; exit 1; }

"${SSH[@]}" 'rm -rf /tmp/meeting-actions && mkdir -m 700 /tmp/meeting-actions'
scp -i "$SSH_KEY" -o BatchMode=yes -q "$BUILD/release.tgz" "$BUILD/env" deploy/oracle/meeting-actions.service deploy/oracle/install.sh "$SSH_TARGET:/tmp/meeting-actions/"
"${SSH[@]}" "sudo bash /tmp/meeting-actions/install.sh '$HOST_NAME' '$PORT'"

echo "Checking https://$HOST_NAME ..."
sleep 3
curl -fsS "https://$HOST_NAME/.well-known/stellar-agent-services.json" | head -c 300; echo
