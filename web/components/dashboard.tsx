"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ChevronRight,
  Database,
  Dumbbell,
  Info,
  LogOut,
  Moon,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  TrendingUp,
  Waves,
} from "lucide-react";
import { demoDataset } from "@/lib/data/demo";
import type { Dataset } from "@/lib/analytics/engine";
import { summaryNotices, summaryStatus } from "@/lib/data/coverage-ui";
import {
  Modal,
  Status,
  Skeleton,
  Empty,
  dateLabel,
} from "./dashboard-primitives";
import { Screens } from "./dashboard-screens";
import { Sources, Explanation } from "./dashboard-quality";
const nav = [
  { slug: "today", label: "Today", icon: Sun },
  { slug: "train", label: "Train", icon: Dumbbell },
  { slug: "recover", label: "Recover", icon: Moon },
  { slug: "progress", label: "Progress", icon: TrendingUp },
  { slug: "insights", label: "Insights", icon: Waves },
];
const titles: Record<
  string,
  { eyebrow: string; title: string; subtitle: string }
> = {
  today: {
    eyebrow: "YOUR DAILY PICTURE",
    title: "Make today count.",
    subtitle:
      "Your measurements, your context. A clearer view of what comes next.",
  },
  train: {
    eyebrow: "EFFORT & CONSISTENCY",
    title: "Build with intention.",
    subtitle:
      "See the work you put in. Keep training volume separate from physiological strain.",
  },
  recover: {
    eyebrow: "SLEEP & RECOVERY",
    title: "Understand your reset.",
    subtitle: "Personal patterns, observed signals, and room for uncertainty.",
  },
  progress: {
    eyebrow: "THE LONGER VIEW",
    title: "Progress has a pattern.",
    subtitle: "Look beyond one measurement. Follow the direction of your work.",
  },
  insights: {
    eyebrow: "PERSONAL EVIDENCE",
    title: "Explore what connects.",
    subtitle:
      "Measured trends and careful associations. No guesses dressed up as insights.",
  },
};
export function Dashboard({
  screen,
  demo,
  mode = "normal",
}: {
  screen: string;
  demo: boolean;
  mode?: string;
}) {
  const [days, setDays] = useState(28),
    [timezone, setTimezone] = useState("Asia/Kolkata"),
    [snapshot, setSnapshot] = useState<{ key: string; data: Dataset } | null>(
      null,
    ),
    [error, setError] = useState<{ key: string; message: string } | null>(null),
    [revision, setRevision] = useState(0),
    [panel, setPanel] = useState<string | null>(null),
    [logoutBusy, setLogoutBusy] = useState(false);
  const key = `${days}:${timezone}`,
    synthetic = useMemo(
      () => (demo ? demoDataset(days, timezone, mode) : null),
      [demo, days, timezone, mode],
    );
  const data = demo ? synthetic : snapshot?.key === key ? snapshot.data : null;
  useEffect(() => {
    if (demo || logoutBusy) return;
    const controller = new AbortController(),
      initialMaintenanceDue = Date.now() + 2000;
    let active = true,
      inFlight = false,
      workInFlight = false,
      partial = true,
      workDelay = 2000,
      inventoryPending = false,
      inventoryDelay = 2000,
      projectionDue = initialMaintenanceDue,
      inventoryDue = initialMaintenanceDue,
      preferInventory = true,
      lastRead = 0;
    let workTimer: ReturnType<typeof setTimeout> | undefined;
    const expireSession = () => {
      // Stop maintenance immediately: document navigation can remain pending.
      // Leaving expired deadlines active would schedule repeated zero-delay POSTs.
      active = false;
      controller.abort();
      if (workTimer) clearTimeout(workTimer);
      setSnapshot(null);
      setPanel(null);
      window.location.replace("/login");
    };
    const scheduleWork = () => {
      if (
        !active ||
        (!partial && !inventoryPending) ||
        workTimer ||
        workInFlight
      )
        return;
      const delay = Math.min(
        partial ? Math.max(0, projectionDue - Date.now()) : Infinity,
        inventoryPending ? Math.max(0, inventoryDue - Date.now()) : Infinity,
      );
      workTimer = setTimeout(() => {
        workTimer = undefined;
        void work();
      }, delay);
    };
    const work = async () => {
      if (!active || (!partial && !inventoryPending) || workInFlight) return;
      if (document.visibilityState !== "visible") {
        projectionDue = inventoryDue = Date.now() + 20000;
        scheduleWork();
        return;
      }
      const inventoryWork =
        inventoryPending &&
        inventoryDue <= Date.now() &&
        (!partial || projectionDue > Date.now() || preferInventory);
      if (!inventoryWork && (!partial || projectionDue > Date.now())) {
        scheduleWork();
        return;
      }
      // One maintenance request at a time. Independent deadlines/backoff keep
      // a failing coverage refresh from starving physiological projection work.
      preferInventory = !inventoryWork;
      workInFlight = true;
      try {
        const response = await fetch(
          inventoryWork
            ? "/api/dashboard/inventory"
            : "/api/dashboard/projection",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              inventoryWork ? { timezone } : { days, timezone },
            ),
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          },
        );
        if (!active) return;
        if (response.status === 401) {
          expireSession();
          return;
        }
        if (!response.ok) throw new Error("WORK_UNAVAILABLE");
        const progress = await response.json();
        if (typeof progress.busy !== "boolean")
          throw new Error("INVALID_PROGRESS");
        if (inventoryWork) {
          if (typeof progress.snapshot?.refresh_required !== "boolean")
            throw new Error("INVALID_INVENTORY_PROGRESS");
          inventoryPending =
            progress.busy || progress.snapshot.refresh_required;
          inventoryDelay = progress.busy
            ? Math.min(inventoryDelay * 2, 60000)
            : 2000;
          inventoryDue = Date.now() + inventoryDelay;
          if (!inventoryPending) void refresh();
        } else {
          if (typeof progress.remaining !== "boolean")
            throw new Error("INVALID_PROGRESS");
          partial = progress.remaining;
          workDelay = progress.busy ? Math.min(workDelay * 2, 60000) : 2000;
          projectionDue = Date.now() + workDelay;
          if (!partial) void refresh();
        }
      } catch {
        // Backfill failure never replaces valid cached charts with an error page.
        if (inventoryWork) {
          inventoryDelay = Math.min(inventoryDelay * 2, 60000);
          inventoryDue = Date.now() + inventoryDelay;
        } else {
          workDelay = Math.min(workDelay * 2, 60000);
          projectionDue = Date.now() + workDelay;
        }
      } finally {
        workInFlight = false;
        scheduleWork();
      }
    };
    const refresh = async () => {
      if (inFlight || !active) return;
      inFlight = true;
      lastRead = Date.now();
      try {
        const response = await fetch(
          `/api/dashboard?days=${days}&timezone=${encodeURIComponent(timezone)}`,
          {
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          },
        );
        if (!active) return;
        if (response.status === 401) {
          expireSession();
          return;
        }
        if (!response.ok)
          throw new Error(
            "Data connection is unavailable. Your records remain private.",
          );
        const result = (await response.json()) as Dataset;
        if (active) {
          setSnapshot({ key, data: result });
          setError(null);
          partial = result.projectionPending ?? result.partial;
          inventoryPending =
            result.inventorySnapshot?.refresh_required ?? false;
          scheduleWork();
        }
      } catch {
        if (active && !controller.signal.aborted) {
          setError({
            key,
            message:
              "Could not refresh your dashboard. Please retry; missing values have not been replaced.",
          });
          scheduleWork();
        }
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = setInterval(() => {
      if (
        document.visibilityState === "visible" &&
        (partial || Date.now() - lastRead >= 60000)
      )
        void refresh();
    }, 20000);
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", visible);
    const pageshow = (event: PageTransitionEvent) => {
      if (event.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", pageshow);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
      if (workTimer) clearTimeout(workTimer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("pageshow", pageshow);
    };
  }, [demo, days, timezone, key, revision, logoutBusy]);
  const heading = titles[screen],
    explain = (metric: string) => setPanel(metric);
  const signOut = async () => {
    setLogoutBusy(true);
    setSnapshot(null);
    setPanel(null);
    try {
      const response = await fetch("/api/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error();
      window.location.replace("/login");
    } catch {
      setError({ key, message: "Sign out could not finish. Please retry." });
      setLogoutBusy(false);
    }
  };
  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link href={demo ? "/demo/today" : "/today"} className="brand">
          <Activity aria-hidden size={24} />
          ATHLETE<span>OS</span>
        </Link>
        <div className="sidebar-label">YOUR PERFORMANCE</div>
        <nav aria-label="Primary navigation">
          {nav.map((item) => (
            <Link
              key={item.slug}
              href={`${demo ? "/demo" : ""}/${item.slug}${demo && mode !== "normal" ? `?state=${mode}` : ""}`}
              aria-current={screen === item.slug ? "page" : undefined}
              className={screen === item.slug ? "active" : ""}
              onNavigate={() => setPanel(null)}
            >
              <item.icon size={19} aria-hidden />
              <span>{item.label}</span>
              {screen === item.slug && <span className="nav-indicator" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button className="source-button" onClick={() => setPanel("sources")}>
            <Database size={17} aria-hidden />
            Sources & data quality
            <ChevronRight size={16} aria-hidden />
          </button>
          <div className="preview-box">
            <span className="preview-label">EXPERIMENTAL PREVIEW</span>
            <p>
              Built on observed data.
              <br />
              Reliability gate still pending.
            </p>
          </div>
          {demo ? (
            <Link href="/login" className="account-button">
              <ShieldCheck size={17} aria-hidden />
              Sign in to your data
            </Link>
          ) : (
            <button
              className="account-button"
              disabled={logoutBusy}
              onClick={signOut}
            >
              <LogOut size={17} aria-hidden />
              {logoutBusy ? "Signing out…" : "Sign out"}
            </button>
          )}
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <span>
            ATHLETE INTELLIGENCE <span className="topbar-separator">/</span>{" "}
            <strong>{nav.find((n) => n.slug === screen)?.label}</strong>
          </span>
          <div>
            <Status tone={demo ? "demo" : "neutral"}>
              {demo ? "DEMO · synthetic data" : "Private session"}
            </Status>
            <button
              className="icon-button"
              onClick={() => {
                setRevision(revision + 1);
              }}
              aria-label="Refresh dashboard"
            >
              <RefreshCw size={17} />
            </button>
            {!demo && (
              <button
                className="icon-button"
                aria-label="Sign out"
                disabled={logoutBusy}
                onClick={signOut}
              >
                <LogOut size={17} />
              </button>
            )}
          </div>
        </header>
        <main
          id="main"
          className="dashboard-main"
          data-response-at={demo ? undefined : data?.fetchedAt}
        >
          <div className="page-heading">
            <div>
              <p className="eyebrow">{heading.eyebrow}</p>
              <h1>{heading.title}</h1>
              <p>{heading.subtitle}</p>
            </div>
            <button
              className="quality-button"
              onClick={() => setPanel("sources")}
            >
              <SlidersHorizontal size={16} aria-hidden />
              {summaryStatus(data ?? undefined)}
            </button>
          </div>
          <div className="control-row">
            <div className="range-control" aria-label="Date range">
              {[7, 28, 90, 180, 365, 730].map((value) => (
                <button
                  key={value}
                  aria-pressed={days === value}
                  className={days === value ? "selected" : ""}
                  onClick={() => setDays(value)}
                >
                  {value === 365 ? "1Y" : value === 730 ? "2Y" : `${value}D`}
                </button>
              ))}
            </div>
            <label className="timezone-control">
              <span>Display timezone</span>
              <select
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              >
                {[
                  "Asia/Kolkata",
                  "UTC",
                  "Europe/London",
                  "America/New_York",
                  "America/Los_Angeles",
                  "Australia/Sydney",
                ].map((tz) => (
                  <option key={tz}>{tz}</option>
                ))}
              </select>
            </label>
            <span className="freshness">
              {data
                ? `${dateLabel(data.today)} · ${data.days.length} days selected`
                : "Connecting to your data…"}
            </span>
          </div>
          {demo && (
            <div className="demo-banner">
              <Info size={16} aria-hidden />
              DEMO — every measurement on this page is invented. No live account
              is connected.
            </div>
          )}
          {data?.partial && (
            <div className="notice">
              <RefreshCw size={16} aria-hidden />
              {summaryNotices(data).join(" ")}
            </div>
          )}
          {error?.key === key && (
            <div role="alert" className="notice error-notice">
              {error.message}
              <button
                className="text-button"
                onClick={() => setRevision(revision + 1)}
              >
                Retry
              </button>
            </div>
          )}
          {demo && mode === "error" ? (
            <div role="alert" className="notice error-notice">
              Synthetic test: data connection unavailable. No mock fallback is
              substituted for real data.
            </div>
          ) : data ? (
            <Screens screen={screen} data={data} explain={explain} />
          ) : error?.key !== key ? (
            <Skeleton />
          ) : (
            <Empty title="Your dashboard will return when the connection does.">
              No personal data is exposed by this error. Use Refresh to try
              again.
            </Empty>
          )}
          <footer className="dashboard-footer">
            <span>
              <ShieldCheck size={13} aria-hidden />
              {demo
                ? "Synthetic demonstration"
                : "Authenticated · ownership protected by RLS"}
            </span>
            <span>
              {data?.version || "athleteos-analytics-v0.1"} · Experimental
              preview
            </span>
          </footer>
        </main>
      </div>
      {panel && (
        <Modal
          title={
            panel === "sources"
              ? "Sources & data quality"
              : "Behind the measurement"
          }
          onClose={() => setPanel(null)}
        >
          {data ? (
            panel === "sources" ? (
              <Sources data={data} demo={demo} />
            ) : (
              <Explanation name={panel} data={data} />
            )
          ) : (
            <p>
              Data is not available yet. No measurement is inferred from the
              loading state.
            </p>
          )}
        </Modal>
      )}
    </div>
  );
}
