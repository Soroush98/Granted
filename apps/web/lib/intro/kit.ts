import "server-only";
import { chatJson } from "@/lib/ai/llm";
import type { PublicEngineer } from "@/lib/engineers/types";
import type { GroundingGrant } from "./types";

/** What Claude returns: which engineer to approach + the drafted outreach. */
type KitDraft = {
  chosen_login: string;
  why_match: string;
  subject: string;
  message: string;
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["chosen_login", "why_match", "subject", "message"],
  properties: {
    chosen_login: { type: "string", description: "GitHub login of the single best-match engineer" },
    why_match: { type: "string", description: "One sentence: why this person is the most natural person to reach out to" },
    subject: { type: "string", description: "Short, specific subject line (<8 words)" },
    message: { type: "string", description: "The outreach body, <120 words" },
  },
} as const;

const SYSTEM = `You help a job seeker get a WARM REFERRAL into a Canadian company that recently won public R&D funding. You are given the company, the specific grant they won, a list of real engineers who work there (from GitHub), and the job seeker's background.

Do two things:
1. Pick the ONE engineer whose background most resembles the job seeker's, so a referral conversation feels natural (shared stack, domain, or trajectory). Return their exact GitHub login from the list.
2. Draft a short outreach message the job seeker can send that person to ask for a brief chat / referral.

The message MUST:
- Open with something specific and genuine — reference the company's actual funded work (the grant) naturally, not as a brag.
- Name one concrete thing in common with the engineer (a language, domain, or project).
- Make a small, low-pressure ask (a 15-minute chat or a pointer to the right person).
- Be under 120 words, warm, human, and specific. No buzzwords, no flattery, no "I'm passionate", no "I hope this finds you well." Sign off as the job seeker (use a placeholder name if none given).

Only choose a login that appears in the provided list. Return strict JSON.`;

/** Build the intro kit: pick the most-similar engineer and draft grounded
 * outreach. Falls back to the first engineer if the model returns a login that
 * isn't in the list. */
export async function generateIntroKit(opts: {
  companyName: string;
  grant: GroundingGrant | null;
  engineers: PublicEngineer[];
  background: string;
}): Promise<{ engineer: PublicEngineer; why_match: string; subject: string; message: string }> {
  const { companyName, grant, engineers, background } = opts;

  const engineerLines = engineers
    .map((e) => {
      const langs = e.top_languages.length ? ` | langs: ${e.top_languages.join(", ")}` : "";
      const bio = e.bio ? ` | bio: ${e.bio.replace(/\s+/g, " ").slice(0, 200)}` : "";
      const loc = e.location ? ` | ${e.location}` : "";
      return `- login=${e.login} | name=${e.name ?? e.login}${loc}${langs}${bio}`;
    })
    .join("\n");

  const grantBlock = grant
    ? [
        grant.title ? `Title: ${grant.title}` : "",
        grant.program ? `Program: ${grant.program}` : "",
        grant.amount_cad ? `Amount: $${Math.round(grant.amount_cad).toLocaleString()} CAD` : "",
        grant.fiscal_year ? `Year: ${grant.fiscal_year}` : "",
        grant.description ? `Description: ${grant.description.replace(/\s+/g, " ").slice(0, 600)}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "(no specific grant on record — keep the funded-R&D reference general)";

  const user = `COMPANY: ${companyName}

THE GRANT THEY WON:
${grantBlock}

ENGINEERS WHO WORK THERE (choose chosen_login from these):
${engineerLines}

JOB SEEKER BACKGROUND:
${background.slice(0, 3000)}`;

  const draft = await chatJson<KitDraft>({ system: SYSTEM, user, schema: SCHEMA });

  const engineer =
    engineers.find((e) => e.login.toLowerCase() === draft.chosen_login.toLowerCase()) ??
    engineers[0]!;

  return {
    engineer,
    why_match: draft.why_match,
    subject: draft.subject,
    message: draft.message,
  };
}
