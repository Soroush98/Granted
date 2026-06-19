# Cloudflare WAF — challenge VPN/datacenter traffic on AI search

Version-controlled definition of the WAF custom rule that issues a **Managed
Challenge** to datacenter/VPN traffic hitting the AI search pages
(`/search`, `/jobs`, `/supervisors`, `/research-pi`). It's defense-in-depth on
top of the app-level rate limits and the global daily spend cap in
`lib/njf/usage.ts`, so automated traffic is filtered at the edge before it can
reach the (paid) embed + rerank path.

## How the challenge works

Action = **Managed Challenge** (Cloudflare's adaptive type):

- Visitor sees a brief "Checking your browser…" interstitial.
- Usually a **non-interactive** JS/proof-of-work check (invisible); sometimes a
  single checkbox. No image puzzles.
- On success Cloudflare sets a **`cf_clearance` cookie**; subsequent requests
  skip the challenge for its lifetime (~30 min, managed). Real users are
  challenged at most once.
- Automated clients that can't run the JS fail and never reach the origin.

## Why the rule targets GET only

The finder forms submit via **server actions** (fetch-based POST). A Managed
Challenge returns an HTML interstitial, which a `fetch()` can't render — so
challenging the POST would break real submissions. The rule challenges the
**GET page navigation**; the `cf_clearance` cookie earned there carries through
the subsequent action POST to the same route.

## Apply with Terraform (recommended)

```bash
cd infra/cloudflare
cp terraform.tfvars.example terraform.tfvars   # fill in token + zone_id
terraform init
terraform plan      # review; the `challenge_expression` output shows the compiled rule
terraform apply
```

The API token needs **Zone → Zone WAF → Edit** (and **Zone → Transform Rules →
Edit** if you enable the origin lock below). `terraform.tfvars` and state are
gitignored.

## Apply without Terraform

```bash
CF_API_TOKEN=... CF_ZONE_ID=... ./apply-via-api.sh
```

(Appends the challenge rule via the Cloudflare API. Re-running adds a duplicate —
delete the old one in the dashboard first.)

## Origin lock (optional)

So that the edge rules can't be skipped, `origin-lock.tf` has Cloudflare stamp a
secret `x-origin-verify` header on every proxied request; the app
(`apps/web/middleware.ts`) only serves the AI paths when that header is present.
Requests that don't arrive via Cloudflare are refused. It's **opt-in**: with
`origin_verify_secret` unset, no rule is created and the app doesn't enforce.

Roll out in this order so a misconfig can't lock you out:

1. Generate a secret: `openssl rand -hex 32`.
2. Set it as `origin_verify_secret` in `terraform.tfvars` and `terraform apply`.
   (The token now also needs **Zone → Transform Rules → Edit**.) Cloudflare adds
   the header; the app still ignores it.
3. Confirm the header arrives on requests through your Cloudflare domain.
4. Set `ORIGIN_VERIFY_SECRET` to the **same value** in the Vercel project env and
   redeploy. Enforcement is now active.

Requirements: the custom domain must be **proxied** (orange cloud); the scraper's
`/api/revalidate` call must target the Cloudflare domain so it carries the
header. The Stripe webhook is exempt (excluded from middleware; authenticated by
signature).

## Plan caveats / tuning

- **`cf.threat_score`** isn't on every plan. If `terraform apply` rejects the
  expression (or the field is missing in the dashboard expression builder), set
  `use_threat_score = false` — the ASN list alone works on all plans.
- **`cf.bot_management.score`** (cleaner detection) requires the Bot Management
  add-on. If you have it, you can replace the reputation clause in `waf.tf` with
  `(cf.bot_management.score lt 30)`.
- **ASN list** catches datacenter-hosted VPNs and cloud scrapers, **not**
  residential proxies. Grow `datacenter_asns` in `variables.tf` as needed from
  Cloudflare request analytics.
- Start in **Log** mode if you want to observe before enforcing: temporarily set
  the rule `action = "log"` (requires a plan that supports the Log action) or
  watch Security Events after deploying with Managed Challenge.

## Upgrading to the v5 Cloudflare provider

`provider.tf` pins `~> 4.40`. The v5 provider changes `cloudflare_ruleset` so
`rules` is a list attribute, not nested blocks. If you upgrade, rewrite the
`rules { ... }` block in `waf.tf` as `rules = [{ ... }]`.
