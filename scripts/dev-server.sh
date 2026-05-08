#!/usr/bin/env bash
# One-command local dev server for rpow.
#
# - Auto-detects Postgres (Homebrew local DB "rpow", or Docker on :55432).
# - Generates an ephemeral session secret + Ed25519 keypair each run (in-memory).
# - Sets test-friendly defaults: DIFFICULTY_BITS=8, RPOW_TEST_INBOX=true (magic link
#   prints to console instead of being emailed).
# - Builds @rpow/shared once if dist is missing.
#
# Usage:
#   bash scripts/dev-server.sh

set -euo pipefail
cd "$(dirname "$0")/.."

# --- Postgres detection ---------------------------------------------------
if command -v psql >/dev/null 2>&1 && psql -d rpow -c 'SELECT 1' >/dev/null 2>&1; then
  export DATABASE_URL="postgres://${USER}@localhost/rpow"
  echo "+ postgres   : Homebrew local (db=rpow)"
elif command -v pg_isready >/dev/null 2>&1 && pg_isready -h localhost -p 55432 >/dev/null 2>&1; then
  export DATABASE_URL="postgres://postgres:p@localhost:55432/postgres"
  echo "+ postgres   : Docker on localhost:55432"
elif nc -z localhost 55432 2>/dev/null; then
  export DATABASE_URL="postgres://postgres:p@localhost:55432/postgres"
  echo "+ postgres   : detected on :55432 (likely Docker)"
else
  cat >&2 <<'EOF'
error: no Postgres reachable. choose one:

  Option A — Homebrew (recommended on macOS):
    brew install postgresql@16
    brew services start postgresql@16
    createdb rpow

  Option B — Docker (start Docker Desktop first):
    docker run --rm -d --name rpow-pg -e POSTGRES_PASSWORD=p -p 55432:5432 postgres:16

then rerun: bash scripts/dev-server.sh
EOF
  exit 1
fi

# --- Build shared once if missing ----------------------------------------
if [ ! -f packages/shared/dist/index.js ]; then
  echo "+ building   : @rpow/shared (one-time)"
  npm run build --workspace @rpow/shared >/dev/null
fi

# --- Ephemeral secrets (regenerated each run) ----------------------------
export SESSION_SECRET="$(openssl rand -hex 32)"

KEYS=$(node -e "
const c = require('node:crypto');
const { publicKey, privateKey } = c.generateKeyPairSync('ed25519');
const priv = privateKey.export({format:'der',type:'pkcs8'}).subarray(-32).toString('hex');
const pub  = publicKey .export({format:'der',type:'spki'  }).subarray(-32).toString('hex');
console.log(priv); console.log(pub);
")
export RPOW_SIGNING_PRIVATE_KEY_HEX="$(echo "$KEYS" | sed -n 1p)"
export RPOW_SIGNING_PUBLIC_KEY_HEX="$(echo "$KEYS" | sed -n 2p)"

# --- Test-friendly defaults ----------------------------------------------
export RESEND_API_KEY="re_test_dev"
export EMAIL_FROM="rpow2 <no-reply@rpow2.com>"
export MAGIC_LINK_BASE_URL="http://localhost:8080"
export WEB_ORIGIN="http://localhost:5173"
export DIFFICULTY_BITS="${DIFFICULTY_BITS:-8}"
export DIFFICULTY_FLOOR="${DIFFICULTY_FLOOR:-4}"
export RPOW_TEST_INBOX="true"
export PORT="${PORT:-8080}"

echo "+ port       : $PORT"
echo "+ difficulty : $DIFFICULTY_BITS bits (floor $DIFFICULTY_FLOOR) — fast for dev"
echo "+ inbox      : test mode (magic links print here, no real email)"
echo "+ secrets    : ephemeral (regenerated every run)"
echo
echo "  CLI usage from another terminal:"
echo "    export RPOW_API=http://localhost:$PORT"
echo "    ./node_modules/.bin/rpow ledger"
echo "    ./node_modules/.bin/rpow login you@x.com"
echo
echo "  starting Fastify..."
echo

exec npm --workspace @rpow/server run dev
