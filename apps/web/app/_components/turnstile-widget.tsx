"use client";

import Script from "next/script";

// Cloudflare Turnstile widget, implicit-render mode. When mounted inside a
// <form>, Turnstile auto-injects a hidden <input name="cf-turnstile-response">
// with the token, so server actions receive it via formData with no extra glue.
//
// Renders nothing when NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset — keeps local dev
// and pre-setup deploys working (verifyTurnstile() fails open to match).
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

export function TurnstileWidget() {
  if (!SITE_KEY) return null;
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        async
        defer
      />
      <div
        className="cf-turnstile"
        data-sitekey={SITE_KEY}
        data-size="flexible"
        data-appearance="interaction-only"
      />
    </>
  );
}
