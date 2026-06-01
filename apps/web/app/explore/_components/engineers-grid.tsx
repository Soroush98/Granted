"use client";

import type { PublicEngineer } from "@/lib/engineers/types";
import { EngineerCard } from "./engineer-card";

export function EngineersGrid({
  engineers,
  onSelect,
}: {
  engineers: PublicEngineer[];
  onSelect: (e: PublicEngineer) => void;
}) {
  if (engineers.length === 0) {
    return (
      <p className="text-center text-sm text-[var(--color-muted)]">
        No engineers to show for this company.
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {engineers.map((e) => (
        <EngineerCard key={e.id} engineer={e} onSelect={onSelect} />
      ))}
    </div>
  );
}
