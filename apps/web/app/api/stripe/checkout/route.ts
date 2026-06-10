import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseServer } from "@/lib/db/supabase-server";
import { env } from "@/lib/env";

// Creates a one-time Checkout Session for the Job Hunt Pass. Requires a logged-
// in user (the pass is tied to their account); the webhook grants credits.
export async function POST() {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID) {
    return NextResponse.json({ error: "Payments aren't set up yet." }, { status: 503 });
  }

  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Please log in to buy the pass." }, { status: 401 });
  }

  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }],
    customer_email: user.email ?? undefined,
    client_reference_id: user.id,
    metadata: { userId: user.id },
    success_url: `${env.NEXT_PUBLIC_APP_URL}/pass?status=success`,
    cancel_url: `${env.NEXT_PUBLIC_APP_URL}/pass?status=cancelled`,
  });

  return NextResponse.json({ url: session.url });
}
