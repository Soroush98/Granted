# Cloudflare provider, pinned to the v4 line. The v5 provider is a breaking
# rewrite (rules become list attributes instead of blocks); if you upgrade,
# the resource block in waf.tf must be reworked — see README.
terraform {
  required_version = ">= 1.5"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.40"
    }
  }
}

provider "cloudflare" {
  # Supply via TF_VAR_cloudflare_api_token or terraform.tfvars (never commit it).
  # Token needs the "Zone > Zone WAF > Edit" permission for the target zone.
  api_token = var.cloudflare_api_token
}
