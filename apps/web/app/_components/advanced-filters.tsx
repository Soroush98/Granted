// Server component: renders the collapsible structured-filter panel used by
// both /search (narrows ranked retrieval) and /browse (drives the list).
// Pure HTML form controls — no client JS — and stays in sync with the URL via
// the wrapping <form>'s GET submission.

import type { FilterFacet, OrgType, SearchFilters } from "@/lib/db/types";
import { COUNTRY_LABELS, COUNTRY_ORDER } from "@/lib/countries";

type Props = {
  facets: { provinces: FilterFacet[]; programs: FilterFacet[] };
  current: SearchFilters;
  // Show the open <details> by default when any filter is active — keeps the
  // panel hidden on a fresh visit, expanded once the user has chosen filters.
  defaultOpen: boolean;
};

const ORG_OPTIONS: { value: OrgType | ""; label: string }[] = [
  { value: "",                   label: "Any organization type" },
  { value: "company",            label: "Companies" },
  { value: "university",         label: "Universities" },
  { value: "research_institute", label: "Research institutes" },
  { value: "nonprofit",          label: "Non-profits" },
  { value: "government",         label: "Government" },
  { value: "other",              label: "Other" },
];

export function AdvancedFilters({ facets, current, defaultOpen }: Props) {
  const selectedPrograms = new Set(current.programCodes ?? []);
  return (
    <details
      open={defaultOpen}
      className="mb-6 rounded-2xl border border-black/10 bg-white p-4 text-sm shadow-sm"
    >
      <summary className="cursor-pointer select-none font-medium">
        Filters
        {defaultOpen && (
          <span className="ml-2 text-xs font-normal text-[var(--color-muted)]">
            (active)
          </span>
        )}
      </summary>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Country
          </span>
          <select
            name="country"
            defaultValue={current.country ?? ""}
            className="rounded-xl border border-black/10 bg-white px-3 py-2"
          >
            <option value="">All countries</option>
            {COUNTRY_ORDER.map((c) => (
              <option key={c} value={c}>{COUNTRY_LABELS[c]}</option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Organization type
          </span>
          <select
            name="org"
            defaultValue={current.orgFilter ?? ""}
            className="rounded-xl border border-black/10 bg-white px-3 py-2"
          >
            {ORG_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 sm:col-span-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Region (province / state)
          </span>
          <select
            name="province"
            defaultValue={current.province ?? ""}
            className="rounded-xl border border-black/10 bg-white px-3 py-2"
          >
            <option value="">All regions</option>
            {facets.provinces.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label} ({p.n.toLocaleString()})
              </option>
            ))}
          </select>
        </label>

        <fieldset className="sm:col-span-2 grid gap-1.5">
          <legend className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Funding programs{" "}
            <span className="font-normal normal-case text-[10px]">
              (overrides the country filter when any are checked)
            </span>
          </legend>
          {/* Multi-select via checkboxes. The form submits one ?programs=…
              CSV value built client-side by the form's hidden field; but to
              keep this server-only we instead post each checkbox under the
              same name and join in the action layer. Browsers submit repeated
              params as ?programs=A&programs=B — we'll read them all. */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 sm:grid-cols-3">
            {facets.programs
              .filter((p) => p.n > 0)
              .map((p) => (
                <label key={p.value} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="programs"
                    value={p.value}
                    defaultChecked={selectedPrograms.has(p.value)}
                    className="size-4"
                  />
                  <span className="truncate" title={p.label}>
                    {p.value}{" "}
                    <span className="text-xs text-[var(--color-muted)]">
                      ({p.n.toLocaleString()})
                    </span>
                  </span>
                </label>
              ))}
          </div>
        </fieldset>

        <label className="grid gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Start date (from)
          </span>
          <input
            type="date"
            name="min_date"
            defaultValue={current.minStartDate ?? ""}
            className="rounded-xl border border-black/10 bg-white px-3 py-2"
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Start date (to)
          </span>
          <input
            type="date"
            name="max_date"
            defaultValue={current.maxStartDate ?? ""}
            className="rounded-xl border border-black/10 bg-white px-3 py-2"
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Min amount (CAD)
          </span>
          <input
            type="number"
            name="min_amount"
            min={0}
            step={1000}
            defaultValue={current.minAmount ?? ""}
            placeholder="0"
            className="rounded-xl border border-black/10 bg-white px-3 py-2"
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-muted)]">
            Max amount (CAD)
          </span>
          <input
            type="number"
            name="max_amount"
            min={0}
            step={1000}
            defaultValue={current.maxAmount ?? ""}
            placeholder="no max"
            className="rounded-xl border border-black/10 bg-white px-3 py-2"
          />
        </label>
      </div>
    </details>
  );
}
