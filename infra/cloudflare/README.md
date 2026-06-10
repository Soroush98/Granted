# Cloudflare WAF — challenge VPN/datacenter traffic on AI search

Version-controlled definition of the WAF custom rule that issues a **Managed
Challenge** to datacenter/VPN traffic hitting the AI search pages
(`/search`, `/jobs`, `/supervisors`, `/research-pi`). It's defense-in-depth on
top of the app-level limits (per-IP 10/day + 3/10min) and the global daily
spend breaker in `lib/njf/usage.ts`.

## Why this exists

Per-IP rate limiting is defeated by VPN/IP rotation. This rule attacks the
problem at the edge instead: it makes datacenter/VPN-originated requests solve a
challenge **before they reach the origin**, so bots and scrapers cost zero
Voyage/Claude credits. See the conversation in the repo history for the full
threat model.

## How the challenge works

Action = **Managed Challenge** (Cloudflare's adaptive type):

- Visitor sees a brief "Checking your browser…" interstitial.
- Usually a **non-interactive** JS/proof-of-work check (invisible); sometimes a
  single checkbox. No image puzzles.
- On success Cloudflare sets a **`cf_clearance` cookie**; subsequent requests
  skip the challenge for its lifetime (~30 min, managed). Real users are
  challenged at most once.
- Headless bots that can't run the JS fail and never reach the origin.

## ⚠️ Why the rule targets GET only

The finder forms submit via **server actions** (fetch-based POST). A Managed
Challenge returns an HTML interstitial, which a `fetch()` can't render — so
challenging the POST would break real submissions. The rule challenges the
**GET page navigation**; the `cf_clearance` cookie earned there carries through
the subsequent action POST to the same route. A bot POSTing directly with no
solved challenge has no cookie and is blocked.

## Apply with Terraform (recommended)

```bash
cd infra/cloudflare
cp terraform.tfvars.example terraform.tfvars   # fill in token + zone_id
terraform init
terraform plan      # review; the `challenge_expression` output shows the compiled rule
terraform apply
```

The API token needs **Zone → Zone WAF → Edit** on the zone. `terraform.tfvars`
and state are gitignored.

## Apply without Terraform

```bash
CF_API_TOKEN=... CF_ZONE_ID=... ./apply-via-api.sh
```

(Appends the rule via the Cloudflare API. Re-running adds a duplicate — delete
the old one in the dashboard first.)

## Plan caveats / tuning

- **`cf.threat_score`** isn't on every plan. If `terraform apply` rejects the
  expression (or the field is missing in the dashboard expression builder), set
  `use_threat_score = false` — the ASN list alone works on all plans.
- **`cf.bot_management.score`** (cleaner detection) requires the Bot Management
  add-on. If you have it, you can replace the reputation clause in `waf.tf` with
  `(cf.bot_management.score lt 30)`.
- **ASN list** catches datacenter-hosted VPNs and cloud scrapers, **not**
  residential proxies. Grow `datacenter_asns` in `variables.tf` as abusive ASNs
  appear in Cloudflare request analytics.
- Start in **Log** mode if you want to observe before enforcing: temporarily set
  the rule `action = "log"` (requires a plan that supports the Log action) or
  watch Security Events after deploying with Managed Challenge.

## Upgrading to the v5 Cloudflare provider

`provider.tf` pins `~> 4.40`. The v5 provider changes `cloudflare_ruleset` so
`rules` is a list attribute, not nested blocks. If you upgrade, rewrite the
`rules { ... }` block in `waf.tf` as `rules = [{ ... }]`.
