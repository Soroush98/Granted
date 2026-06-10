#!/usr/bin/env bash
# Non-Terraform alternative: add the Managed Challenge rule to the zone's
# http_request_firewall_custom ruleset via the Cloudflare API. Idempotent-ish —
# it appends one rule; re-running adds a duplicate, so delete the old one in the
# dashboard first if you re-run. Terraform (see waf.tf) is the cleaner path.
#
# Usage:
#   CF_API_TOKEN=... CF_ZONE_ID=... ./apply-via-api.sh
#
# Token needs: Zone > Zone WAF > Edit.
set -euo pipefail

: "${CF_API_TOKEN:?set CF_API_TOKEN}"
: "${CF_ZONE_ID:?set CF_ZONE_ID}"

API="https://api.cloudflare.com/client/v4"
AUTH=(-H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json")

# Paths to protect and datacenter/VPN ASNs (keep in sync with variables.tf).
PATHS='"/search" "/jobs" "/supervisors" "/research-pi"'
ASNS='16509 14618 15169 396982 8075 14061 16276 24940 20473 9009 60068 51852 212238 206092'

EXPR="(http.request.uri.path in {${PATHS}}) and (http.request.method eq \"GET\") and (cf.threat_score gt 10 or ip.geoip.asnum in {${ASNS}})"

echo "→ Resolving the http_request_firewall_custom entrypoint ruleset…"
RULESET_ID=$(curl -s "${AUTH[@]}" \
  "${API}/zones/${CF_ZONE_ID}/rulesets/phases/http_request_firewall_custom/entrypoint" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["id"])')

echo "→ Adding the Managed Challenge rule…"
curl -s "${AUTH[@]}" -X POST \
  "${API}/zones/${CF_ZONE_ID}/rulesets/${RULESET_ID}/rules" \
  --data @- <<JSON | python3 -c 'import sys,json; r=json.load(sys.stdin); print("OK" if r.get("success") else json.dumps(r["errors"], indent=2))'
{
  "action": "managed_challenge",
  "description": "Challenge datacenter/VPN traffic on AI search pages",
  "enabled": true,
  "expression": "${EXPR}"
}
JSON

echo "Done. Verify in dashboard → Security → WAF → Custom rules."
