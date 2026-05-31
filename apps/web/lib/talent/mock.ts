import "server-only";
import type { ProfileProvider } from "./provider";
import type { RawProfile } from "./types";

/** Zero-cost provider for local dev + tests. Generates a deterministic,
 * role-aware synthetic cohort so the whole compete flow (embed → cosine →
 * verdict → most-similar) can be exercised without spending on a real scraper.
 *
 * Deterministic on (company, role, index): same inputs → same cohort, so the
 * cache and "most similar" selection behave reproducibly across runs. */
export class MockProvider implements ProfileProvider {
  readonly name = "mock";

  async fetchCohort(company: string, role: string, limit: number): Promise<RawProfile[]> {
    const skillPool = skillsForRole(role);
    const n = Math.min(limit, 20);
    const out: RawProfile[] = [];
    for (let i = 0; i < n; i++) {
      const seniority = at(SENIORITY, i);
      const years = 1 + ((i * 7) % 12); // 1..12, spread out
      // Each person gets a rotating window of the skill pool so cohorts have a
      // realistic skill-frequency distribution rather than identical lists.
      const skills = rotate(skillPool, i).slice(0, 5 + (i % 4));
      const name = `${at(FIRST, i)} ${at(LAST, i * 3)}`;
      const title = `${seniority} ${titleCase(role)}`.trim();
      out.push({
        full_name: name,
        headline: at(HEADLINES, i)(title, company, skills),
        linkedin_url: `https://www.linkedin.com/in/${slug(name)}-${i}`,
        location: at(LOCATIONS, i),
        current_title: title,
        current_company: company,
        // Vary the prose per person so the cohort isn't a cluster of near-identical
        // embeddings — real profiles differ in wording, and a too-tight synthetic
        // cohort would pin every outside resume to the 0th fit percentile.
        summary: at(SUMMARIES, i)(titleCase(role), years, skills, company),
        skills,
        experience: [
          { title, company, duration: `${years > 3 ? 3 : years} yrs` },
          {
            title: `${at(PRIOR_SENIORITY, i)} ${titleCase(role)}`.trim(),
            company: at(PRIOR_COMPANIES, i),
            duration: `${Math.max(1, years - 3)} yrs`,
          },
        ],
        education: [
          {
            school: at(SCHOOLS, i),
            degree: i % 3 === 0 ? "MSc" : "BSc",
            field: i % 2 === 0 ? "Computer Science" : "Software Engineering",
          },
        ],
        years_experience: years,
        raw: { mock: true, index: i },
      });
    }
    return out;
  }
}

function skillsForRole(role: string): string[] {
  const r = role.toLowerCase();
  if (r.includes("data") && r.includes("eng"))
    return ["Python", "SQL", "Apache Spark", "Airflow", "dbt", "Kafka", "Snowflake", "AWS", "Databricks", "Scala", "Terraform", "Docker"];
  if (r.includes("machine learning") || r.includes("ml") || r.includes("ai"))
    return ["Python", "PyTorch", "TensorFlow", "MLOps", "Kubernetes", "SQL", "Pandas", "scikit-learn", "AWS SageMaker", "LLMs", "Spark", "Docker"];
  if (r.includes("front"))
    return ["TypeScript", "React", "Next.js", "CSS", "GraphQL", "Testing", "Accessibility", "Webpack", "Node.js", "Tailwind"];
  if (r.includes("back"))
    return ["Go", "Python", "PostgreSQL", "Redis", "gRPC", "Kafka", "Docker", "Kubernetes", "AWS", "Microservices"];
  return ["Python", "SQL", "AWS", "Docker", "Git", "Linux", "REST APIs", "CI/CD", "Agile", "System Design"];
}

// Distinct prose templates so embeddings spread out like a real cohort.
const SUMMARIES: Array<(role: string, years: number, skills: string[], company: string) => string> = [
  (r, y, s, c) => `${r} with ${y} years building production systems at scale. Day-to-day in ${s.slice(0, 3).join(", ")}. Currently at ${c}, focused on reliability and developer velocity.`,
  (r, y, s) => `I turn messy requirements into shipped ${r.toLowerCase()} work. ${y} years across startups and enterprise. Comfortable owning ${s.slice(0, 2).join(" and ")} end to end.`,
  (r, y, s, c) => `${y}+ yrs. Joined ${c} to scale our platform. Deep on ${s[0]} and ${s[1]}, learning ${s[3] ?? s[0]}. Mentor junior engineers and care about clean interfaces.`,
  (r, y, s) => `Pragmatic ${r.toLowerCase()}. Shipped data/products used by millions. Strengths: ${s.slice(0, 4).join(", ")}. ${y} years and counting; happiest near hard problems.`,
  (r, y, s, c) => `Builder at heart — ${y} years of ${r.toLowerCase()} experience. At ${c} I lead ${s[0]} initiatives and partner with ML and product teams. Tooling: ${s.slice(1, 4).join(", ")}.`,
  (r, y, s) => `${r} who cares about correctness and cost. ${y} years optimizing ${s[0]} and ${s[2] ?? s[1]} pipelines. Open-source contributor; speak at local meetups.`,
];

const HEADLINES: Array<(title: string, company: string, skills: string[]) => string> = [
  (t, c) => `${t} at ${c}`,
  (t, c, s) => `${t} @ ${c} · ${s[0]} / ${s[1]}`,
  (t, c) => `${t} | building data infrastructure at ${c}`,
  (t, c, s) => `${t} at ${c} — ${s.slice(0, 3).join(", ")}`,
];

const SENIORITY = ["Senior", "Staff", "", "Lead", "Senior", "", "Principal", "Senior"];
const PRIOR_SENIORITY = ["", "Junior", "Associate", "", "Junior"];
const FIRST = ["Ava", "Liam", "Noah", "Maya", "Ethan", "Priya", "Omar", "Sofia", "Wei", "Aiden", "Zara", "Lucas", "Nina", "Diego", "Hana", "Ravi", "Elena", "Kofi", "Mei", "Sam"];
const LAST = ["Chen", "Patel", "Nguyen", "Garcia", "Smith", "Kim", "Okafor", "Singh", "Rossi", "Ahmed", "Dubois", "Yilmaz", "Kowalski", "Haddad", "Tanaka"];
const LOCATIONS = ["Edmonton, AB", "Calgary, AB", "Toronto, ON", "Vancouver, BC", "Montreal, QC", "Remote, Canada"];
const PRIOR_COMPANIES = ["Shopify", "Telus", "RBC", "Wealthsimple", "Amazon", "Google", "Benevity", "Jobber", "Neo Financial", "ATB"];
const SCHOOLS = ["University of Alberta", "University of Waterloo", "University of Toronto", "UBC", "McGill University", "University of Calgary"];

/** Cyclic index helper — modulo keeps it in range, so the result is always
 * defined (satisfies noUncheckedIndexedAccess). */
function at<T>(arr: T[], i: number): T {
  return arr[((i % arr.length) + arr.length) % arr.length]!;
}
function rotate<T>(arr: T[], by: number): T[] {
  const k = ((by % arr.length) + arr.length) % arr.length;
  return arr.slice(k).concat(arr.slice(0, k));
}
function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
