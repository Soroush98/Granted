import "server-only";
import Stripe from "stripe";
import { env } from "@/lib/env";

// Lazily constructed so the app boots without Stripe configured (the checkout /
// webhook routes guard on STRIPE_SECRET_KEY before calling this).
export function stripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(env.STRIPE_SECRET_KEY);
}
