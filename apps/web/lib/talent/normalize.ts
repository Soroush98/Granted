import "server-only";
import type { RawProfile } from "./types";

/** Canonical key form for a company name or role — lower-cased, whitespace
 * collapsed. Used both for the cohort unique key and for cache lookups. */
export function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Build the text blob we embed for a profile. Order matters a little: the
 * headline + current title carry the strongest role signal, so they go first;
 * skills and history add breadth. Capped to keep the Voyage payload tidy. */
export function profileEmbedText(p: RawProfile): string {
  const expTitles = p.experience
    .map((e) => [e.title, e.company].filter(Boolean).join(" at "))
    .filter(Boolean);
  const edu = p.education
    .map((e) => [e.degree, e.field, e.school].filter(Boolean).join(" "))
    .filter(Boolean);
  const parts = [
    p.current_title ?? "",
    p.headline ?? "",
    p.summary ?? "",
    p.skills.length ? `Skills: ${p.skills.join(", ")}` : "",
    expTitles.length ? `Experience: ${expTitles.join("; ")}` : "",
    edu.length ? `Education: ${edu.join("; ")}` : "",
  ].filter(Boolean);
  const text = parts.join("\n");
  return text.length > 4000 ? text.slice(0, 4000) : text;
}

/** Coerce whatever an Apify actor returns for one profile into our RawProfile.
 * Actors vary in field naming, so this is defensive: every field is optional
 * and falls back to null / []. `obj` is the raw dataset item. */
export function rawFromApifyItem(obj: Record<string, unknown>): RawProfile | null {
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;

  // Location may be a plain string or an object (HarvestAPI returns
  // { linkedinText: "Edmonton, Alberta, Canada", ... }).
  const loc = (v: unknown): string | null => {
    if (typeof v === "string") return str(v);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return str(o.linkedinText) ?? str(o.text) ?? str(o.name) ?? str(o.default);
    }
    return null;
  };

  const fullName =
    str(obj.fullName) ??
    str(obj.full_name) ??
    str(obj.name) ??
    ([str(obj.firstName), str(obj.lastName)].filter(Boolean).join(" ") || null);
  if (!fullName) return null; // a profile with no name is useless

  const skillsRaw = obj.skills;
  const skills = Array.isArray(skillsRaw)
    ? skillsRaw
        .map((s) =>
          typeof s === "string" ? s : str((s as Record<string, unknown>)?.name),
        )
        .filter((s): s is string => Boolean(s))
    : [];

  const expRaw = Array.isArray(obj.experience)
    ? obj.experience
    : Array.isArray(obj.positions)
      ? obj.positions
      : [];
  const experience = (expRaw as Array<Record<string, unknown>>).map((e) => ({
    title: str(e.title) ?? str(e.position) ?? undefined,
    company: str(e.company) ?? str(e.companyName) ?? undefined,
    duration: str(e.duration) ?? str(e.dateRange) ?? undefined,
  }));

  const eduRaw = Array.isArray(obj.education) ? obj.education : [];
  const education = (eduRaw as Array<Record<string, unknown>>).map((e) => ({
    school: str(e.school) ?? str(e.schoolName) ?? str(e.title) ?? undefined,
    degree: str(e.degree) ?? str(e.degreeName) ?? undefined,
    field: str(e.field) ?? str(e.fieldOfStudy) ?? undefined,
  }));

  const yearsRaw = obj.yearsOfExperience ?? obj.years_experience;
  const years =
    typeof yearsRaw === "number" && Number.isFinite(yearsRaw) ? yearsRaw : null;

  return {
    full_name: fullName,
    headline: str(obj.headline) ?? str(obj.occupation) ?? null,
    linkedin_url: str(obj.url) ?? str(obj.profileUrl) ?? str(obj.linkedinUrl) ?? null,
    location: loc(obj.location) ?? str(obj.locationName) ?? str(obj.geoLocationName) ?? null,
    current_title:
      str(obj.currentTitle) ??
      str(obj.jobTitle) ??
      experience[0]?.title ??
      null,
    current_company:
      str(obj.currentCompany) ??
      str(obj.companyName) ??
      experience[0]?.company ??
      null,
    summary: str(obj.summary) ?? str(obj.about) ?? null,
    skills,
    experience,
    education,
    years_experience: years,
    raw: obj,
  };
}
