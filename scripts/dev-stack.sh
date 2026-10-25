#!/usr/bin/env bash
# Start (or restart) the mock sheet + Worker for local development. Logs in /tmp.
set -e
cd "$(dirname "$0")/.."
stop() { [ -f "/tmp/pt-$1.pid" ] && kill "$(cat /tmp/pt-$1.pid)" 2>/dev/null || true; rm -f "/tmp/pt-$1.pid"; }
stop mock; stop worker
for p in 8787 8788; do fuser -k "$p/tcp" >/dev/null 2>&1 || true; done
[ "${1:-}" = "stop" ] && exit 0
if [ "${1:-}" = "fresh" ]; then rm -rf .wrangler/state/v3/d1; fi
npx wrangler d1 migrations apply pt-tracker --local >/dev/null
setsid node mock/sheet-server.mjs > /tmp/pt-mock.log 2>&1 < /dev/null & echo $! > /tmp/pt-mock.pid
setsid npx wrangler dev --port 8787 --ip 127.0.0.1 --test-scheduled > /tmp/pt-worker.log 2>&1 < /dev/null & echo $! > /tmp/pt-worker.pid
for i in $(seq 1 60); do curl -sf -o /dev/null --max-time 2 http://127.0.0.1:8787/api/rev && break; sleep 1; done
echo "worker http://127.0.0.1:8787  mock sheet http://127.0.0.1:8788"
