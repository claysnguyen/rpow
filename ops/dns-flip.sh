#!/usr/bin/env bash
# Flip api.rpow2.com A (and AAAA if VPS_IPV6 is set) to point at VPS.
# Required env: CLOUDFLARE_API_TOKEN, VPS_IP, VPS_IPV6 (or "NONE")
set -euo pipefail

ZONE_ID="685720286628e21c9b43f260ac6b63bf"
A_REC_ID="34daa777f0dbbdbd1e3c97d6c12e9837"
AAAA_REC_ID="1cfb2458cc028a8f95bea16a439bff6c"

: "${CLOUDFLARE_API_TOKEN:?missing}"
: "${VPS_IP:?missing}"
: "${VPS_IPV6:?missing  (use the literal string NONE if VPS has no IPv6)}"

api () { curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" "$@"; }

echo "Flipping A record to $VPS_IP..."
api -X PATCH --data "{\"content\": \"$VPS_IP\"}" \
    "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$A_REC_ID" \
  | jq -e '.success' > /dev/null
echo "  A flipped."

if [ "$VPS_IPV6" = "NONE" ]; then
    echo "Deleting AAAA record (VPS has no IPv6)..."
    api -X DELETE \
        "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$AAAA_REC_ID" \
      | jq -e '.success' > /dev/null
    echo "  AAAA deleted."
else
    echo "Flipping AAAA record to $VPS_IPV6..."
    api -X PATCH --data "{\"content\": \"$VPS_IPV6\"}" \
        "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$AAAA_REC_ID" \
      | jq -e '.success' > /dev/null
    echo "  AAAA flipped."
fi

echo
echo "Live records:"
api "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?name=api.rpow2.com" \
  | jq -r '.result[] | "  \(.type) \(.name) -> \(.content) (proxied=\(.proxied), ttl=\(.ttl))"'
