#!/bin/sh
set -e

echo "[Churnveda] Starting production server on port ${PORT:-3000}..."

# Run database migrations if bundled migration script exists
if [ -f "dist/migrate.cjs" ]; then
  echo "[Churnveda] Running database migrations..."
  node dist/migrate.cjs || true
fi

# Execute production Node server
exec node dist/server.cjs
