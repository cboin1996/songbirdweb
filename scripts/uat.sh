#!/usr/bin/env bash
# https in front of the local prd stack (web :3000, API :8000), so a phone on the home Wi-Fi can use
# offline art (needs a secure origin) against the same build and data. Nothing else differs.
#   scripts/uat.sh up     point the DuckDNS name at this machine's LAN IP, start Caddy
#   scripts/uat.sh down   stop Caddy
# Needs ~/bin/caddy (with the duckdns plugin), ~/.config/songbird-uat/Caddyfile (proxy to localhost:3000)
# and DUCKDNS_TOKEN in ~/.config/songbird-uat/duckdns.env. Start the prd web and API first.
set -euo pipefail
CONF="$HOME/.config/songbird-uat"
NAME=${UAT_NAME:-songbird-uat}
LAN_IP=${UAT_LAN_IP:-$(ip -4 -o addr show scope global | awk '$2 !~ /^(br-|docker)/ {sub("/.*","",$4); print $4; exit}')}

case "${1:-}" in
up)
  set -a; . "$CONF/duckdns.env"; set +a
  [ -n "${DUCKDNS_TOKEN:-}" ] || { echo "DUCKDNS_TOKEN is empty in $CONF/duckdns.env"; exit 1; }
  curl -fsS -o /dev/null http://localhost:3000/ || { echo "prd web is not answering on :3000"; exit 1; }
  r=$(curl -s "https://www.duckdns.org/update?domains=$NAME&token=$DUCKDNS_TOKEN&ip=$LAN_IP")
  [ "$r" = OK ] || { echo "duckdns update said: $r"; exit 1; }
  pkill -f "caddy run --config $CONF/Caddyfile" 2>/dev/null || true
  nohup "$HOME/bin/caddy" run --config "$CONF/Caddyfile" > /tmp/uat-caddy.log 2>&1 < /dev/null &
  echo "up: https://$NAME.duckdns.org:8443 -> $LAN_IP:3000; caddy log /tmp/uat-caddy.log"
  ;;
down)
  pkill -f "caddy run --config $CONF/Caddyfile" 2>/dev/null || true
  ;;
*) echo "usage: $0 up|down"; exit 2;;
esac
