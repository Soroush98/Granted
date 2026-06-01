// "Intro Kit" — the one paid loop: a recently-funded company + your background →
// the engineer there most like you + a drafted, grounded outreach message.
// Plain-JSON shapes only; these cross to the client.

import type { PublicEngineer } from "@/lib/engineers/types";

/** The specific grant the outreach is grounded in (their real funded work). */
export type GroundingGrant = {
  title: string | null;
  program: string | null;
  amount_cad: number | null;
  fiscal_year: string | null;
  start_date: string | null;
  description: string | null;
};

export type IntroKit = {
  ok: true;
  company: { display_name: string; province: string | null; city: string | null };
  grant: GroundingGrant | null;
  /** The engineer most similar to the job seeker — the referral target. */
  engineer: PublicEngineer;
  why_match: string;
  subject: string;
  message: string;
};

export type IntroOutcome = IntroKit | { ok: false; error: string };
