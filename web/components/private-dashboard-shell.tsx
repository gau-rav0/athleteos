"use client";
import type { ReactNode } from "react";
import { useSelectedLayoutSegment } from "next/navigation";
import { Dashboard } from "./dashboard";

const screens = ["today", "train", "recover", "progress", "insights"];

export function PrivateDashboardShell({ children }: { children: ReactNode }) {
  const screen = useSelectedLayoutSegment();
  if (!screen || !screens.includes(screen)) return children;
  return (
    <>
      {children}
      {/* One mounted client instance owns its private, in-memory snapshot.
          Page navigation changes presentation, not the selected dataset. */}
      <Dashboard screen={screen} demo={false} />
    </>
  );
}
