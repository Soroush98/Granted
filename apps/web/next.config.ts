import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js 16: Turbopack is the default for `next dev` and `next build`.

  // `cacheComponents` is the Next.js 16 successor to the old `dynamicIO`.
  // It also subsumes Partial Prerendering (the old `experimental.ppr` flag),
  // so all we need is this single switch.
  cacheComponents: true,

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.ca" },
      { protocol: "https", hostname: "**.edu" },
      { protocol: "https", hostname: "**.supabase.co" },
    ],
  },

  // Scraper service may post webhooks to revalidate cache tags.
  // Lock the body parser size for that route in route handler itself.
};

export default nextConfig;
