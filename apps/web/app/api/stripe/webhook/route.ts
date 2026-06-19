import type Stripe from "stripe";
import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseService } from "@/lib/db/supabase-server";
import { env } from "@/lib/env";
import { PASS_CREDITS, PASS_DAYS } from "@/lib/njf/access";
import { sendPassReceipt } from "@/lib/email";

// Stripe webhook: on a completed checkout, grant/refresh the buyer's pass.
// Reads the RAW body for signature verification — proxy excludes this path
// so the body is untouched.
export async function POST(req: Request) {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Webhook not configured" }, { status: 503 });
  }
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Missing signature" }, { status: 400 });

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, sig, env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error("[stripe] signature verification failed:", e);
    return NextResponse.json({ error: "Bad signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const service = supabaseService();

    // Idempotency: insert the event id first; a unique-violation means we've
    // already processed this event, so just acknowledge.
    const { error: dupErr } = await service.from("stripe_events").insert({ id: event.id });
    if (dupErr) {
      if (dupErr.code === "23505") return NextResponse.json({ received: true });
      console.error("[stripe] stripe_events insert error:", dupErr); // proceed best-effort
    }

    const session = event.data.object as Stripe.Checkout.Session;

    // Only grant on a session that was ACTUALLY paid. `checkout.session.completed`
    // also fires for unpaid/no_payment_required/async-pending sessions; granting
    // on those hands out a free pass. (Price/quantity are already fixed server-side
    // in the checkout route, so payment_status is the gap that matters here.)
    if (session.payment_status !== "paid") {
      return NextResponse.json({ received: true, skipped: "unpaid" });
    }

    const userId = session.metadata?.userId ?? session.client_reference_id ?? null;
    if (userId) {
      const expiresAt = new Date(Date.now() + PASS_DAYS * 86_400_000).toISOString();
      const { error } = await service.from("passes").upsert({
        user_id: userId,
        status: "active",
        expires_at: expiresAt,
        credits_remaining: PASS_CREDITS, // a re-purchase resets to a full pass
        stripe_session_id: session.id,
        updated_at: new Date().toISOString(),
      });
      if (error) console.error("[stripe] pass upsert failed:", error);

      const email = session.customer_details?.email ?? session.customer_email;
      if (email) await sendPassReceipt(email, { credits: PASS_CREDITS, days: PASS_DAYS });
    }
  }

  return NextResponse.json({ received: true });
}
