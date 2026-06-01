"use client";

import { useState } from "react";
import type { EngineersData, PublicEngineer } from "@/lib/engineers/types";
import { EngineersGrid } from "./engineers-grid";
import { EngineerDetail } from "./engineer-detail";

export function EngineersResults({ data }: { data: EngineersData }) {
  const [selected, setSelected] = useState<PublicEngineer | null>(null);
  const { company } = data;
  const where = [company.city, company.province].filter(Boolean).join(", ");

  return (
    <div className="grid gap-6">
      <div className="flex flex-col items-center gap-2">
        <p className="text-center text-sm text-[var(--color-muted)]">
          <span className="font-medium text-[var(--color-ink)]">{data.count}</span>{" "}
          {data.count === 1 ? "engineer" : "engineers"} at{" "}
          <span className="font-medium text-[var(--color-ink)]">
            {company.display_name}
          </span>
          {where ? ` · ${where}` : ""}
          {data.cached ? " · reused from a recent lookup" : ""}
        </p>
        <SourceBadge source={data.source} org={data.github_org} />
      </div>

      <EngineersGrid engineers={data.engineers} onSelect={setSelected} />

      {selected && (
        <EngineerDetail engineer={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

/** Tells the user how this set was sourced — accurate org members vs the fuzzier
 * "lists this company as employer" search. */
function SourceBadge({
  source,
  org,
}: {
  source: EngineersData["source"];
  org: string | null;
}) {
  const label =
    source === "org" && org
      ? `Public members of the @${org} GitHub org`
      : "GitHub users who list this company as their employer";
  return (
    <span className="rounded-full border border-black/10 bg-white/70 px-3 py-1 text-xs text-[var(--color-muted)] shadow-sm backdrop-blur">
      {label}
    </span>
  );
}
