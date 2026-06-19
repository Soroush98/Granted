variable "cloudflare_api_token" {
  description = "Cloudflare API token with Zone > Zone WAF > Edit on the zone."
  type        = string
  sensitive   = true
}

variable "cloudflare_zone_id" {
  description = "Zone ID for the site (Cloudflare dashboard → Overview → API section)."
  type        = string
}

variable "origin_verify_secret" {
  description = "Shared secret Cloudflare stamps as the `x-origin-verify` request header so the app can reject direct-to-origin (WAF-bypassing) traffic. Must match ORIGIN_VERIFY_SECRET in the web app env. Generate with `openssl rand -hex 32`. Leave \"\" to disable the origin-lock rule (opt-in)."
  type        = string
  default     = ""
  sensitive   = true
}

variable "protected_paths" {
  description = "Exact URL paths of the AI search surfaces to guard. These are GET page navigations; the cf_clearance cookie earned here carries through the subsequent server-action POST."
  type        = list(string)
  default     = ["/search", "/jobs", "/supervisors", "/research-pi"]
}

variable "threat_score_threshold" {
  description = "cf.threat_score above which to challenge (0 = trusted, 100 = worst). 10 is a sensible starting point. Ignored when use_threat_score = false."
  type        = number
  default     = 10
}

variable "use_threat_score" {
  description = "Include the cf.threat_score clause. Set false on plans where that field isn't available (the dashboard expression builder won't list it) — the ASN list still works on every plan."
  type        = bool
  default     = true
}

# Datacenter / hosting / VPN-backbone ASNs. This is the reliable free signal:
# it catches cloud-hosted scrapers and datacenter-based VPN exit nodes. It does
# NOT catch residential proxies (nothing free does — that needs Bot Management
# or a paid IP-intelligence vendor). Grow this list as you spot abusive
# networks in your logs (the ASN shows up in Cloudflare's request analytics).
variable "datacenter_asns" {
  description = "ASNs to challenge (datacenter / hosting / common VPN backbones)."
  type        = list(number)
  default = [
    16509, 14618,  # AWS
    15169, 396982, # Google Cloud
    8075,          # Microsoft Azure
    14061,         # DigitalOcean
    16276,         # OVH
    24940,         # Hetzner
    20473,         # Vultr / Choopa
    9009,          # M247 (common VPN backbone)
    60068,         # Datacamp / CDN77 (NordVPN et al.)
    51852,         # Private Layer (VPN hosting)
    212238,        # Datacamp Limited
    206092,        # IPXO / proxy hosting
  ]
}
