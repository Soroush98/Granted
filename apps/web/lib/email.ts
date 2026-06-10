import "server-only";
import { Resend } from "resend";
import { env } from "@/lib/env";

// Transactional email via Resend. NOTE: the auth verify / password-reset emails
// are sent by Supabase Auth (routed through Resend via the Supabase SMTP
// setting) — this module is only for app-side mail like the pass receipt.

export async function sendPassReceipt(
  to: string,
  opts: { credits: number; days: number },
): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not set — skipping pass receipt");
    return;
  }
  try {
    const resend = new Resend(env.RESEND_API_KEY);
    await resend.emails.send({
      from: env.RESEND_FROM,
      to,
      subject: "Your Granted Job Hunt Pass is active 🎉",
      text:
        `Thanks for getting the 30-Day Job Hunt Pass!\n\n` +
        `You now have ${opts.credits} searches valid for ${opts.days} days, including live web ` +
        `search for funded companies. Sign in and start hunting:\n\n` +
        `${env.NEXT_PUBLIC_APP_URL}/jobs\n\n— Granted`,
    });
  } catch (e) {
    console.error("[email] pass receipt failed:", e);
  }
}
