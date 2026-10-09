"use client";
import { createContext, useContext, useState, type ReactNode } from "react";
import type { Dataset } from "@/lib/analytics/engine";

export type PrivateDashboardSnapshot = {
  key: string;
  data: Dataset;
  loadedAt: number;
};
type RetainedState = {
  days: number;
  timezone: string;
  snapshot: PrivateDashboardSnapshot | null;
  error: { key: string; message: string } | null;
};

class DashboardSession {
  private owner: string | null = null;
  private state: RetainedState | null = null;
  private cancellations = new Set<() => void>();

  read(owner: string) {
    return this.owner === owner ? this.state : null;
  }
  activate(owner: string) {
    if (this.owner === owner) return;
    this.clear();
    this.owner = owner;
  }
  save(owner: string, state: RetainedState) {
    // An old request/render must never repopulate a newly selected account.
    if (this.owner === owner) this.state = state;
  }
  registerCancellation(owner: string, cancel: () => void) {
    if (this.owner !== owner) {
      cancel();
      return () => {};
    }
    this.cancellations.add(cancel);
    return () => {
      this.cancellations.delete(cancel);
    };
  }
  clear(owner?: string) {
    if (owner !== undefined && this.owner !== owner) return;
    this.owner = null;
    this.state = null;
    for (const cancel of this.cancellations) cancel();
    this.cancellations.clear();
  }
}

const SessionContext = createContext<DashboardSession | null>(null);
export const useDashboardSession = () => useContext(SessionContext);

export function PrivateDashboardShell({ children }: { children: ReactNode }) {
  // One active account, scoped to this private layout and browser tab. No global,
  // browser-persistent or shared cache contains personal snapshots.
  const [session] = useState(() => new DashboardSession());
  return (
    <SessionContext.Provider value={session}>
      {children}
    </SessionContext.Provider>
  );
}
