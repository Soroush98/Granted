# Origin lock: ensure requests reach the app only via Cloudflare.
#
# The WAF rule in waf.tf only governs traffic that passes through Cloudflare; a
# request sent straight to the origin would skip it. This rule stamps a shared
# secret on every request Cloudflare forwards to the origin, and the app
# (middleware.ts) only serves the AI paths when that `x-origin-verify` header is
# present — so requests that didn't arrive via Cloudflare are refused.
# `operation = "set"` overwrites any client-supplied value, so the header can't
# be smuggled through.
#
# OPT-IN: with origin_verify_secret unset (""), no rule is created. Roll out in
# this order so you never lock yourself out:
#   1. terraform apply (creates this rule) — confirm requests through your custom
#      domain now carry x-origin-verify (the app still ignores it until step 2).
#   2. Set ORIGIN_VERIFY_SECRET (same value) in the Vercel project env & redeploy.
# To verify the lock afterwards: a request to the *.vercel.app URL on a cost path
# should return 403; the same path via your Cloudflare domain should work.

resource "cloudflare_ruleset" "origin_verify" {
  count = var.origin_verify_secret != "" ? 1 : 0

  zone_id     = var.cloudflare_zone_id
  name        = "Granted — stamp origin-verify header"
  description = "Shared secret on proxied requests so the origin can reject direct (non-Cloudflare) traffic."
  kind        = "zone"
  phase       = "http_request_late_transform"

  rules {
    ref         = "stamp_origin_verify"
    description = "Set x-origin-verify on all requests forwarded to origin"
    expression  = "true"
    action      = "rewrite"
    action_parameters {
      headers {
        name      = "x-origin-verify"
        operation = "set"
        value     = var.origin_verify_secret
      }
    }
    enabled = true
  }
}
