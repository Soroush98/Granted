# WAF custom rule: Managed Challenge on the AI search pages when the request
# comes from a datacenter/VPN ASN (or a low-reputation IP). Challenged-and-
# passed humans get a cf_clearance cookie and proceed; bots that can't solve
# the challenge never reach the origin, so they cost zero Voyage/Claude credits.
#
# IMPORTANT: the rule targets GET page navigations only, never the server-action
# POSTs. A Managed Challenge returns an HTML interstitial, which a fetch()-based
# server action can't render — challenging the POST would break real submissions.
# A human is challenged when loading /jobs (GET); the resulting clearance cookie
# carries through the form POST to the same route.

locals {
  path_set = join(" ", [for p in var.protected_paths : "\"${p}\""])
  asn_set  = join(" ", [for a in var.datacenter_asns : tostring(a)])

  reputation_clause = var.use_threat_score ? "(cf.threat_score gt ${var.threat_score_threshold} or ip.geoip.asnum in {${local.asn_set}})" : "(ip.geoip.asnum in {${local.asn_set}})"

  challenge_expression = join(" and ", [
    "(http.request.uri.path in {${local.path_set}})",
    "(http.request.method eq \"GET\")",
    local.reputation_clause,
  ])
}

resource "cloudflare_ruleset" "waf_challenge_vpn" {
  zone_id     = var.cloudflare_zone_id
  name        = "Granted — challenge VPN/datacenter on AI search"
  description = "Managed Challenge for GET navigations to AI search pages from datacenter/VPN ASNs or low-reputation IPs."
  kind        = "zone"
  phase       = "http_request_firewall_custom"

  rules {
    ref         = "challenge_vpn_datacenter_search"
    description = "Challenge datacenter/VPN traffic on AI search pages"
    expression  = local.challenge_expression
    action      = "managed_challenge"
    enabled     = true
  }
}

output "challenge_expression" {
  description = "The compiled Cloudflare expression (handy to paste into the dashboard rule tester)."
  value       = local.challenge_expression
}
