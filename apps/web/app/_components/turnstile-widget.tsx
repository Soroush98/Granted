"use client";

import Script from "next/script";
import { useEffect, useRef, useState } from "react";

// Cloudflare Turnstile widget (explicit render so we can reset it). Turnstile
// injects a hidden <input name="cf-turnstile-response"> into the widget
// container — which sits inside the <form> — so server actions receive the
// token via formData. Tokens are SINGLE-USE: because the finder forms submit
// via a server action (no page reload), the token must be reset after each
// submission or a repeat search reuses a spent token and is rejected. The
// parent bumps `resetKey` when a submission completes to trigger that reset.
//
// Renders nothing when the site key is unset OR outside production — a real
// site key rejects the `localhost` hostname, and verifyTurnstile() skips in
// dev to match.
const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const ENABLED = !!SITE_KEY && process.env.NODE_ENV === "production";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

export function TurnstileWidget({ resetKey = 0 }: { resetKey?: number }) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const [scriptReady, setScriptReady] = useState(false);

  // If the script was already loaded (e.g. client-side nav), onLoad won't fire.
  useEffect(() => {
    if (window.turnstile) setScriptReady(true);
  }, []);

  // Render once, when the script is ready and the container is mounted.
  useEffect(() => {
    if (!ENABLED || !scriptReady || !container.current || widgetId.current) return;
    if (!window.turnstile) return;
    widgetId.current = window.turnstile.render(container.current, {
      sitekey: SITE_KEY,
      size: "flexible",
    });
    return () => {
      if (widgetId.current && window.turnstile) {
        window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      }
    };
  }, [scriptReady]);

  // Reset after each completed submission to mint a fresh single-use token.
  useEffect(() => {
    if (resetKey > 0 && widgetId.current && window.turnstile) {
      window.turnstile.reset(widgetId.current);
    }
  }, [resetKey]);

  if (!ENABLED) return null;
  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => setScriptReady(true)}
      />
      <div ref={container} />
    </>
  );
}
