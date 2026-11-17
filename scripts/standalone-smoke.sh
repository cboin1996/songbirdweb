#!/usr/bin/env bash
# Boots the image that ships (`node server.js` from the standalone output) and checks the
# pages that need no API, plus what the app does when the API is down. The e2e suites run
# `next start`, which is not the same server.
# Usage: scripts/standalone-smoke.sh [image]   (default: builds songbirdweb:smoke)
set -euo pipefail

IMAGE="${1:-}"
NAME=songbirdweb-smoke
PORT="${SMOKE_PORT:-3050}"

if [ -z "$IMAGE" ]; then
    IMAGE=songbirdweb:smoke
    docker build -t "$IMAGE" .
fi

docker rm -f "$NAME" >/dev/null 2>&1 || true
trap 'docker logs "$NAME" 2>&1 | tail -20; docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
# API_BASE_URL points at nothing: the API being down is part of what is checked.
docker run -d --name "$NAME" -p "$PORT:3000" -e API_BASE_URL=http://127.0.0.1:9 "$IMAGE" >/dev/null

for _ in $(seq 1 30); do
    curl -s -o /dev/null "http://localhost:$PORT/" && break
    sleep 1
done

fail=0
check() { # name, expected status regex, curl args...
    local name="$1" want="$2"; shift 2
    local got
    got=$(curl -s -o /dev/null -w '%{http_code}' "$@" || true)
    if [[ "$got" =~ $want ]]; then echo "ok   $name ($got)"; else echo "FAIL $name: got $got, want $want"; fail=1; fi
}

check "sign-in page renders" '^200$' "http://localhost:$PORT/"
check "signed-out library goes to sign-in" '^30[27]$' "http://localhost:$PORT/library"
check "offline page renders" '^200$' "http://localhost:$PORT/offline"
check "a static chunk is served" '^200$' "http://localhost:$PORT/$(curl -s "http://localhost:$PORT/" | grep -o '_next/static/[^"]*\.js' | head -1)"
check "service worker file is served" '^200$' "http://localhost:$PORT/sw.js"
# API down: an expired session with a refresh token makes the proxy ask the API, which is
# gone, then pass the download on to the rewrite, which answers a 500 (the web
# treats that as "server unreachable", see data.ts proxyFailed). The server must stay up.
EXPIRED="eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjF9.sig"
got=$(curl -s -o /dev/null -w '%{http_code}' --cookie "access_token=$EXPIRED; refresh_token=gone" "http://localhost:$PORT/v1/download/none" || true)
if [[ "$got" =~ ^5[0-9][0-9]$ ]]; then echo "ok   download with the API down answers $got"; else echo "FAIL download with the API down: got '$got', want a 5xx"; fail=1; fi
check "server still up after that" '^200$' "http://localhost:$PORT/"

exit $fail
