#!/usr/bin/env bash
# Smoke + negative API suite (QA-STRATEGY.md cases SM-*). Runs against a local
# production build:  pnpm --filter web build && pnpm --filter web start
#
# Usage: qa/smoke.sh [base_url]   (default http://localhost:3000)
#
# Read-only against Supabase except SM-05, which revalidates a cache tag
# (harmless). Never touches the AI path — the promo-spam and finder cases below
# are rejected before any Voyage/Anthropic spend by design, and that IS the
# assertion.
set -u
BASE="${1:-http://localhost:3000}"
PASS=0; FAIL=0

check() { # id description expected actual [evidence]
  local id="$1" desc="$2" expected="$3" actual="$4" evidence="${5:-}"
  if [[ "$actual" == "$expected" ]]; then
    echo "PASS  $id  $desc"
    PASS=$((PASS+1))
  else
    echo "FAIL  $id  $desc — expected [$expected] got [$actual] $evidence"
    FAIL=$((FAIL+1))
  fi
}

status_of() { curl -s -o /dev/null -w '%{http_code}' --max-time 30 "$@"; }

# ---------------------------------------------------------------- happy paths
check SM-01 "GET / renders"            200 "$(status_of "$BASE/")"
check SM-02 "GET /search (browse mode) renders" 200 "$(status_of "$BASE/search")"
check SM-03 "GET /stats renders"       200 "$(status_of "$BASE/stats")"
check SM-03b "GET /about renders"      200 "$(status_of "$BASE/about")"
check SM-03c "GET /search page 2 sorted by amount renders" 200 \
  "$(status_of "$BASE/search?page=1&sort=amount_desc")"

# ------------------------------------------------------------- negative paths
# SM-04: revalidate without / with wrong bearer → 401, no internals leaked.
no_auth=$(curl -s -w '\n%{http_code}' --max-time 10 -X POST "$BASE/api/revalidate" \
  -H 'content-type: application/json' -d '{"tags":["search"]}')
check SM-04a "revalidate w/o auth → 401" 401 "$(tail -1 <<<"$no_auth")"
check SM-04b "revalidate w/o auth: opaque error body" '{"error":"unauthorized"}' \
  "$(head -1 <<<"$no_auth")"
check SM-04c "revalidate wrong bearer → 401" 401 \
  "$(status_of -X POST "$BASE/api/revalidate" -H 'authorization: Bearer wrong-secret' \
     -H 'content-type: application/json' -d '{"tags":["search"]}')"

# SM-05: correct bearer + malformed JSON must not 500 (tolerant parse).
if [[ -n "${REVALIDATE_SECRET:-}" ]]; then
  check SM-05 "revalidate valid auth + malformed JSON → 200" 200 \
    "$(status_of -X POST "$BASE/api/revalidate" \
       -H "authorization: Bearer $REVALIDATE_SECRET" \
       -H 'content-type: application/json' -d '{not json')"
else
  echo "SKIP  SM-05  (export REVALIDATE_SECRET to enable)"
fi

# SM-06: finder rejects short input and missing Turnstile BEFORE any AI spend.
# The endpoint streams NDJSON with HTTP 200; the error is in the body.
short=$(curl -s --max-time 15 -X POST "$BASE/finders/search" -F kind=jobs -F background=hi)
grep -q '"t":"error"' <<<"$short"
check SM-06a "finder: short input → error event, no spend" 0 $?
long=$(curl -s --max-time 15 -X POST "$BASE/finders/search" -F kind=jobs \
  -F background="ten years of experience in computational fluid dynamics and turbine design")
grep -q '"t":"error"' <<<"$long"
check SM-06b "finder: missing Turnstile → error event, no spend" 0 $?
bad_kind=$(curl -s --max-time 15 -X POST "$BASE/finders/search" -F kind=nope -F background=whatever)
grep -q '"t":"error"' <<<"$bad_kind"
check SM-06c "finder: unknown kind → error event" 0 $?

# SM-07: nonsense company id → graceful, not 500.
code=$(status_of "$BASE/companies/00000000-0000-0000-0000-000000000000")
[[ "$code" == "200" || "$code" == "404" ]]
check SM-07 "unknown company id → 200/404 (never 5xx)" 0 $? "(got $code)"

# SM-08: promo spam in the search box is bounced with the block message.
spam_page=$(curl -s --max-time 30 "$BASE/search?q=Hi%2C%20we%20help%20businesses%20grow%20your%20instagram%20presence")
grep -q "promotional message" <<<"$spam_page"
check SM-08 "promo spam bounced before AI (block copy rendered)" 0 $?

# SM-09: garbage filter params degrade gracefully.
check SM-09 "garbage params (?page=abc&min_amount=abc&country=XX) → 200" 200 \
  "$(status_of "$BASE/search?page=abc&min_amount=abc&country=XX")"

# SM-10: unknown route → 404.
check SM-10 "unknown route → 404" 404 "$(status_of "$BASE/definitely-not-a-page")"

echo
echo "smoke: $PASS passed, $FAIL failed"
exit $((FAIL > 0))
