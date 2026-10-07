"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronRight,
  Database,
  Dumbbell,
  Heart,
  Info,
  LogOut,
  Moon,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  TrendingUp,
  Waves,
  X,
} from "lucide-react";
import { TrendChart } from "./trend-chart";
import { demoDataset } from "@/lib/data/demo";
import type { Dataset, Day, Metric } from "@/lib/analytics/engine";
import { median } from "@/lib/analytics/statistics";
import { localDay } from "@/lib/analytics/time";
const nav = [
  { slug: "today", label: "Today", icon: Sun },
  { slug: "train", label: "Train", icon: Dumbbell },
  { slug: "recover", label: "Recover", icon: Moon },
  { slug: "progress", label: "Progress", icon: TrendingUp },
  { slug: "insights", label: "Insights", icon: Waves },
];
const fmt = (value: number | null | undefined, places = 0) =>
  value === null || value === undefined
    ? "—"
    : value.toLocaleString(undefined, { maximumFractionDigits: places });
const sleepFmt = (minutes: number | null | undefined) =>
  minutes === null || minutes === undefined
    ? "—"
    : `${Math.floor(Math.round(minutes) / 60)}h ${Math.round(minutes) % 60}m`;
const latest = (data: Dataset, m: Metric) =>
  [...data.days].reverse().find((day) => day[m] !== null);
const dateLabel = (day: string) =>
  new Date(day + "T12:00:00Z").toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
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
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={onClose}
      aria-labelledby="modal-title"
    >
      <header>
        <h2 id="modal-title">{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close panel"
        >
          <X size={20} />
        </button>
      </header>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
function Card({
  title,
  kicker,
  children,
  onExplain,
  className = "",
}: {
  title: string;
  kicker?: string;
  children: ReactNode;
  onExplain?: () => void;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      <div className="card-heading">
        <div>
          {kicker && <p className="eyebrow">{kicker}</p>}
          <h2>{title}</h2>
        </div>
        {onExplain && (
          <button
            className="icon-button"
            aria-label={`Explain ${title}`}
            onClick={onExplain}
          >
            <ArrowUpRight size={18} />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}
function Metric({
  label,
  value,
  unit,
  detail,
  icon,
  kind = "OBSERVED",
  onExplain,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  detail: string;
  icon?: ReactNode;
  kind?: string;
  onExplain: () => void;
}) {
  return (
    <Card title={label} onExplain={onExplain}>
      <div className="metric-top">
        {icon}
        <span className="metric-kind">{kind}</span>
      </div>
      <div className="metric-value">
        {value}
        <span>{unit}</span>
      </div>
      <p className="metric-detail">{detail}</p>
    </Card>
  );
}
function Status({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span className={`status status-${tone}`}>
      <span aria-hidden className="status-dot" />
      {children}
    </span>
  );
}
function Empty({
  title,
  children,
  icon = <Info size={22} />,
}: {
  title: string;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon}
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
function Skeleton() {
  return (
    <div className="skeleton-grid" aria-label="Loading dashboard" role="status">
      {Array.from({ length: 6 }, (_, i) => (
        <div className="skeleton" key={i}>
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}
function category(value: string) {
  const labels: Record<string, string> = {
    RUNNING: "Running",
    WALKING: "Walking",
    CYCLING: "Cycling",
    STRENGTH_TRAINING: "Strength",
    WEIGHT_TRAINING: "Strength",
    STRETCHING: "Mobility",
    YOGA: "Yoga",
    "56": "Running",
    "79": "Walking",
    "8": "Cycling",
    "80": "Strength",
    "81": "Strength",
    "16": "Other workout",
  };
  return (
    labels[value] ||
    value
      .toLowerCase()
      .replaceAll("_", " ")
      .replace(/^./, (v) => v.toUpperCase())
  );
}
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
    const controller = new AbortController();
    let active = true;
    const refresh = async () => {
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
          setSnapshot(null);
          window.location.replace("/login");
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
        }
      } catch {
        if (active && !controller.signal.aborted)
          setError({
            key,
            message:
              "Could not refresh your dashboard. Please retry; missing values have not been replaced.",
          });
      }
    };
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
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
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("pageshow", pageshow);
    };
  }, [demo, days, timezone, key, revision, logoutBusy]);
  const heading = titles[screen],
    explain = (metric: string) => setPanel(metric);
  const signOut = async () => {
    setLogoutBusy(true); setSnapshot(null); setPanel(null);
    try {
      const response=await fetch("/api/auth/logout",{method:"POST"});
      if(!response.ok)throw new Error();
      window.location.replace("/login");
    } catch {setError({key,message:"Sign out could not finish. Please retry."});setLogoutBusy(false);}
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
            {!demo && <button className="icon-button" aria-label="Sign out" disabled={logoutBusy} onClick={signOut}><LogOut size={17}/></button>}
          </div>
        </header>
        <main id="main" className="dashboard-main">
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
              {data?.partial ? "Summaries updating" : "Data quality"}
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
              Summaries are catching up with uploaded records. Scores and
              associations are withheld until this window is processed.
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
function Screens({
  screen,
  data,
  explain,
}: {
  screen: string;
  data: Dataset;
  explain: (metric: string) => void;
}) {
  const sleep = latest(data, "sleep"),
    steps = latest(data, "steps"),
    weight = latest(data, "weight"),
    hrv = latest(data, "hrv"),
    overnight = latest(data, "overnightHr"),
    energy = latest(data, "energy"),
    last = data.days.at(-1)!;
  const measured = (day: Day | undefined) =>
    day
      ? `Latest observed · ${dateLabel(day.day)}`
      : "No supported observation";
  const chart = (
    title: string,
    metric: keyof Day,
    unit: string,
    color: string,
    type: "area" | "bar" | "line" = "area",
    target?: number,
  ) => (
    <Card
      title={title}
      kicker="OBSERVED TREND"
      onExplain={() => explain(title)}
    >
      <TrendChart
        days={data.days}
        metric={metric}
        label={title}
        unit={unit}
        color={color}
        type={type}
        target={target}
      />
    </Card>
  );
  if (screen === "today")
    return (
      <>
        <div className="today-hero">
          <Card
            title="Readiness"
            kicker="YOUR RECOVERY CONTEXT"
            className="readiness-card"
            onExplain={() => explain("Readiness")}
          >
            <Status tone={data.readiness.score === null ? "neutral" : "blue"}>
              {data.readiness.score === null
                ? "Insufficient data"
                : "Experimental · moderate confidence"}
            </Status>
            {data.readiness.score === null ? (
              <>
                <div className="readiness-empty">
                  <span>—</span>
                  <div>
                    <h3>
                      Let the data
                      <br />
                      earn the score.
                    </h3>
                    <p>Missing signals stay missing.</p>
                  </div>
                </div>
                <p className="readiness-reason">{data.readiness.reason}</p>
                <div className="signal-chips">
                  <span className={sleep ? "present" : ""}>
                    {sleep ? <Check size={12} /> : <span>·</span>}Sleep
                  </span>
                  <span className={hrv ? "present" : ""}>
                    {hrv ? <Check size={12} /> : <span>·</span>}Genuine RMSSD
                  </span>
                  <span className={overnight ? "present" : ""}>
                    {overnight ? <Check size={12} /> : <span>·</span>}
                    Sleep-window HR
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="readiness-score">
                  {data.readiness.score}
                  <span>/ 100</span>
                </div>
                <p className="readiness-reason">
                  Experimental context for your next session. Consider how you
                  feel before adjusting training.
                </p>
                <div className="contributors">
                  {data.readiness.contributors.map((c) => (
                    <div key={c.name}>
                      <span>{c.name}</span>
                      <div>
                        <span style={{ width: `${c.score}%` }} />
                      </div>
                      <small>{Math.round(c.weight * 100)}% weight</small>
                    </div>
                  ))}
                </div>
              </>
            )}
            <button
              className="text-button"
              onClick={() => explain("Readiness")}
            >
              See inputs and confidence <ArrowRight size={14} />
            </button>
          </Card>
          <div className="hero-metrics">
            <Metric
              label="Sleep"
              value={sleepFmt(sleep?.sleep)}
              detail={measured(sleep)}
              icon={<Moon size={18} />}
              kind="SOURCE-SELECTED"
              onExplain={() => explain("Sleep")}
            />
            <Metric
              label="Observed steps"
              value={fmt(steps?.steps)}
              detail={measured(steps)}
              icon={<Activity size={18} />}
              kind="DERIVED"
              onExplain={() => explain("Steps")}
            />
            <Metric
              label="Sleep-window HR"
              value={fmt(overnight?.overnightHr)}
              unit="bpm"
              detail={
                overnight
                  ? measured(overnight)
                  : "Requires samples matched to sleep"
              }
              icon={<Heart size={18} />}
              kind="DERIVED"
              onExplain={() => explain("Sleep-window HR")}
            />
            <Metric
              label="Body weight"
              value={fmt(weight?.weight, 1)}
              unit="kg"
              detail={measured(weight)}
              icon={<TrendingUp size={18} />}
              onExplain={() => explain("Weight")}
            />
          </div>
        </div>
        <div className="two-column">
          {chart("Sleep duration", "sleep", "min", "#a5cfff", "bar", 480)}
          {chart("Daily activity", "steps", "steps", "#adcfbf", "bar")}
        </div>
        <div className="three-column">
          <Card
            title="Training this week"
            onExplain={() => explain("Training volume")}
          >
            <div className="metric-value">
              {fmt(data.volume.seven)}
              <span>min</span>
            </div>
            <p className="metric-detail">Logged session minutes over 7 days</p>
            <p className="caption">
              Volume describes time—not total muscular or cardiovascular stress.
            </p>
            <Link className="text-link" href="train">
              Explore training <ArrowRight size={14} />
            </Link>
          </Card>
          <Card title="HRV · real RMSSD" onExplain={() => explain("HRV")}>
            <div className="metric-value">
              {fmt(hrv?.hrv, 1)}
              <span>ms</span>
            </div>
            <p className="metric-detail">
              {hrv
                ? measured(hrv)
                : "Unavailable without genuine RMSSD records"}
            </p>
            <p className="caption">
              Samsung proprietary HRV-like fields are never substituted.
            </p>
          </Card>
          <Card
            title="Samsung Energy Score"
            onExplain={() => explain("Samsung Energy Score")}
          >
            <div className="metric-value">
              {fmt(energy?.energy)}
              <span>/ 100</span>
            </div>
            <p className="metric-detail">{measured(energy)}</p>
            <p className="caption">
              Observed vendor score. Separate from AthleteOS readiness.
            </p>
          </Card>
        </div>
        <Card
          title="Your next training decision"
          kicker="CONTEXT, NOT AN AI COACH"
          onExplain={() => explain("Training recommendation")}
        >
          <p className="decision-text">
            {data.readiness.score === null
              ? "Recovery evidence is incomplete. Follow your existing plan and how you feel; this preview cannot support an intensity recommendation."
              : "Use the experimental contributors alongside your existing plan and perceived recovery. A score alone does not justify a harder session."}
          </p>
          <p className="caption">
            No plan is automatically prescribed or changed.
          </p>
        </Card>
      </>
    );
  if (screen === "train") {
    const frequency = new Set(
      data.workouts
        .filter((w) => w.day >= data.days.slice(-7)[0].day)
        .map((w) => w.day),
    ).size;
    return (
      <>
        <div className="four-column">
          <Metric
            label="7-day training volume"
            value={fmt(data.volume.seven)}
            unit="min"
            detail="Logged sessions, not physiological load"
            kind="DERIVED"
            onExplain={() => explain("Training volume")}
          />
          <Metric
            label="Previous 28-day context"
            value={fmt(data.volume.baseline)}
            unit="min / week"
            detail="Previous 28 days divided by four"
            kind="DERIVED"
            onExplain={() => explain("Training volume")}
          />
          <Metric
            label="Relative volume"
            value={fmt(data.volume.ratio, 2)}
            unit="×"
            detail="Recent 7 days vs preceding weekly average"
            kind="DERIVED"
            onExplain={() => explain("Training volume")}
          />
          <Metric
            label="Weekly consistency"
            value={frequency}
            unit="days"
            detail="Observed training days in the last 7 days"
            kind="DERIVED"
            onExplain={() => explain("Workout consistency")}
          />
        </div>
        <div className="two-column">
          {chart(
            "Training minutes",
            "trainingMinutes",
            "min",
            "#adcfbf",
            "bar",
          )}
          <Card
            title="Cardiovascular load"
            onExplain={() => explain("Cardiovascular load")}
          >
            <Empty
              title="Intensity evidence is required."
              icon={<Heart size={24} />}
            >
              Session duration is available where observed. Without validated
              intensity and personal HR inputs, TRIMP, strain and muscular load
              are withheld.
            </Empty>
            <div className="mini-divider" />
            <h3>Strength benchmarks</h3>
            <p className="caption">
              No benchmarks logged. This space is prepared for future optional
              entries; no set-by-set diary is required.
            </p>
          </Card>
        </div>
        <WorkoutList data={data} />
      </>
    );
  }
  if (screen === "recover")
    return (
      <>
        <div className="four-column">
          <Metric
            label="Latest sleep"
            value={sleepFmt(sleep?.sleep)}
            detail={measured(sleep)}
            kind="SOURCE-SELECTED"
            onExplain={() => explain("Sleep")}
          />
          <Metric
            label="Personal sleep baseline"
            value={sleepFmt(data.sleepBaseline.median)}
            detail={`${data.sleepBaseline.samples} observed days · rolling median`}
            kind="DERIVED"
            onExplain={() => explain("Sleep baseline")}
          />
          <Metric
            label="Bedtime regularity"
            value={fmt(data.sleepRegularity)}
            unit="min"
            detail="Median absolute deviation over 28 days"
            kind="DERIVED"
            onExplain={() => explain("Sleep timing")}
          />
          <Metric
            label="Sleep target"
            value="8"
            unit="hours"
            detail="Preview comparison target; not a clinical prescription"
            kind="REFERENCE"
            onExplain={() => explain("Sleep target")}
          />
        </div>
        <div className="two-column">
          {chart("Sleep duration", "sleep", "min", "#a5cfff", "bar", 480)}
          <Card
            title="Latest sleep stages"
            onExplain={() => explain("Sleep stages")}
          >
            <Stages day={sleep} />
          </Card>
          {chart("RMSSD HRV", "hrv", "ms", "#b6b2df", "line")}
          {chart(
            "Sleep-window heart rate",
            "overnightHr",
            "bpm",
            "#d8a4a4",
            "line",
          )}
          {chart(
            "Samsung Energy Score",
            "energy",
            "vendor score",
            "#adcfbf",
            "line",
          )}
          {chart("Skin temperature", "skin", "°C", "#cdbd9e", "line")}
          {chart("Blood oxygen", "spo2", "%", "#a5cfff", "line")}
          {chart(
            "Respiratory rate",
            "respiratory",
            "breaths/min",
            "#b6b2df",
            "line",
          )}
        </div>
        <div className="two-column">
          {chart(
            "Bedtime (local minutes)",
            "bedtime",
            "minutes since midnight",
            "#a5cfff",
            "line",
          )}
          {chart(
            "Wake time (local minutes)",
            "wake",
            "minutes since midnight",
            "#adcfbf",
            "line",
          )}
        </div>
        <Card
          title="Recovery context"
          onExplain={() => explain("Recovery context")}
        >
          <p className="caption">
            Deviations need enough personal history and a stable measurement
            method. No medical anomaly or healthy/recovered diagnosis is
            inferred from this preview. Skin temperature is peripheral skin
            temperature, not core body temperature.
          </p>
        </Card>
      </>
    );
  if (screen === "progress") {
    const measuredWeights = data.days.filter((d) => d.weight !== null).length,
      thirty = data.days
        .slice(-30)
        .map((d) => d.weight)
        .filter((v): v is number => v !== null);
    return (
      <>
        <div className="four-column">
          <Metric
            label="Latest body weight"
            value={fmt(weight?.weight, 1)}
            unit="kg"
            detail={measured(weight)}
            onExplain={() => explain("Weight")}
          />
          <Metric
            label="Weekly change"
            value={fmt(data.weightChange?.kg, 2)}
            unit="kg"
            detail={
              data.weightChange
                ? `${data.weightChange.samples} measurements in two 7-day windows`
                : "Needs at least two measurements per week"
            }
            kind="DERIVED"
            onExplain={() => explain("Weight trend")}
          />
          <Metric
            label="Weekly percentage change"
            value={fmt(data.weightChange?.percent, 2)}
            unit="%"
            detail="Relative to the preceding weekly median"
            kind="DERIVED"
            onExplain={() => explain("Weight trend")}
          />
          <Metric
            label="30-day central weight"
            value={thirty.length >= 3 ? fmt(median(thirty), 1) : "—"}
            unit="kg"
            detail={`${thirty.length} observations · median`}
            kind="DERIVED"
            onExplain={() => explain("Weight trend")}
          />
        </div>
        <div className="two-column">
          {chart("Body weight", "weight", "kg", "#b6b2df", "line")}
          {chart(
            "7-day smoothed weight",
            "weightSmooth",
            "kg",
            "#b6b2df",
            "line",
          )}
          {chart("Body fat", "bodyFat", "%", "#cdbd9e", "line")}
          {chart("Activity consistency", "steps", "steps", "#adcfbf", "bar")}
          {chart(
            "Exercise minutes",
            "trainingMinutes",
            "min",
            "#a5cfff",
            "bar",
          )}
          <Card
            title="Performance preservation"
            onExplain={() => explain("Performance preservation")}
          >
            <Empty
              title="Let more than weight guide progress."
              icon={<TrendingUp size={24} />}
            >
              Use workout consistency and measured benchmarks alongside body
              trends. Exact calorie deficits and performance retention cannot be
              inferred from weight alone.
            </Empty>
            <p className="caption">
              {measuredWeights} measured weight days in this window. Smoothing
              is withheld when a seven-day window has fewer than three
              measurements.
            </p>
          </Card>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="two-column">
        <Card
          title="Sleep & same-day activity"
          kicker="ASSOCIATION EXPLORER"
          onExplain={() => explain("Associations")}
        >
          {data.insight ? (
            <>
              <Status tone="blue">Association · not causation</Status>
              <div className="metric-value">
                {fmt(data.insight.rho, 2)}
                <span>Spearman ρ</span>
              </div>
              <p className="metric-detail">
                {data.insight.samples} paired observations ·{" "}
                {Math.round(data.insight.coverage * 100)}% coverage
              </p>
              <p className="caption">
                95% moving-block bootstrap interval: {fmt(data.insight.low, 2)}{" "}
                to {fmt(data.insight.high, 2)}. Window:{" "}
                {data.insight.windowDays} days. This is an exploratory
                relationship; confounding and missing data remain possible.
              </p>
            </>
          ) : (
            <Empty title="Evidence is still building.">
              At least 30 paired days, 60% window coverage and a stable
              uncertainty interval are required. Step observations also need 20
              hours of interval coverage for this comparison.
            </Empty>
          )}
        </Card>
        <Card
          title="Weekly snapshot"
          onExplain={() => explain("Weekly summary")}
        >
          <div className="summary-row">
            <span>Logged training</span>
            <strong>{fmt(data.volume.seven)} min</strong>
          </div>
          <div className="summary-row">
            <span>Observed sleep days</span>
            <strong>
              {data.days.slice(-7).filter((d) => d.sleep !== null).length} / 7
            </strong>
          </div>
          <div className="summary-row">
            <span>Observed activity days</span>
            <strong>
              {data.days.slice(-7).filter((d) => d.steps !== null).length} / 7
            </strong>
          </div>
          <div className="summary-row">
            <span>Real RMSSD days</span>
            <strong>
              {data.days.slice(-7).filter((d) => d.hrv !== null).length} / 7
            </strong>
          </div>
          <p className="caption">
            Unobserved days are unknown. Counts describe coverage, not
            adherence.
          </p>
        </Card>
      </div>
      <div className="two-column">
        {chart("Sleep context", "sleep", "min", "#a5cfff", "line")}
        {chart("Activity context", "steps", "steps", "#adcfbf", "bar")}
      </div>
      <Card
        title="Dataset coverage"
        kicker="WHAT THE DATABASE ACTUALLY CONTAINS"
        onExplain={() => explain("Sources")}
      >
        <InventoryTable data={data} />
      </Card>
      <Card title="What this preview can—and cannot—tell you">
        <p className="caption">
          Observed metrics and deterministic trends are available when their
          source schema is supported. Readiness remains experimental and is
          withheld without core evidence. Training-load inference, medical
          diagnosis, causal claims and AI coaching are outside this preview.
        </p>
        <div className="signal-chips">
          <span>{last.day}</span>
          <span>{data.invalidFacts} unsupported summaries withheld</span>
          <span>
            {data.excludedOverlaps} overlapping representations excluded
          </span>
        </div>
      </Card>
    </>
  );
}
function Stages({ day }: { day: Day | undefined }) {
  if (!day || !Object.keys(day.stages).length)
    return (
      <Empty title="Stage detail is unavailable." icon={<Moon size={24} />}>
        A sleep interval does not imply known stages. Older or partial records
        remain explicitly unknown.
      </Empty>
    );
  const colors: Record<string, string> = {
      light: "#a5cfff",
      deep: "#657eab",
      rem: "#b6b2df",
      awake: "#cdbd9e",
      unknown: "#84909a",
      asleep_unspecified: "#adcfbf",
    },
    total = Object.values(day.stages).reduce((a, b) => a + b, 0);
  return (
    <>
      <p className="metric-detail">
        {dateLabel(day.day)} · consumer sleep-stage observations
      </p>
      <div
        className="stage-bar"
        role="img"
        aria-label="Sleep stage distribution"
      >
        {Object.entries(day.stages).map(([stage, minutes]) => (
          <span
            key={stage}
            style={{
              width: `${total ? (minutes / total) * 100 : 0}%`,
              background: colors[stage] || "#84909a",
            }}
          />
        ))}
      </div>
      <div className="stage-legend">
        {Object.entries(day.stages).map(([stage, minutes]) => (
          <div key={stage}>
            <span style={{ background: colors[stage] || "#84909a" }} />
            {stage.replaceAll("_", " ")}
            <strong>{fmt(minutes)} min</strong>
          </div>
        ))}
      </div>
      <p className="caption">
        Wearable stages provide context, not clinical sleep assessment.
      </p>
    </>
  );
}
function WorkoutList({ data }: { data: Dataset }) {
  return (
    <Card
      title="Session history"
      kicker={`${data.workouts.length} SOURCE-SELECTED SESSIONS`}
    >
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Session</th>
              <th scope="col">Date</th>
              <th scope="col">Duration</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {data.workouts.slice(0, 100).map((w, i) => (
              <tr key={`${w.start}-${i}`}>
                <th scope="row">
                  <span className="workout-category">
                    <Dumbbell size={15} aria-hidden />
                    {category(w.category)}
                  </span>
                </th>
                <td>{dateLabel(w.day)}</td>
                <td>{fmt(w.minutes)} min</td>
                <td className="source-cell">
                  {w.provider === "samsung_health"
                    ? "Samsung Health"
                    : "Health Connect"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!data.workouts.length && (
        <Empty title="No uploaded sessions in this window.">
          Workouts are never inferred from heart-rate spikes. Change the range
          or check Sources.
        </Empty>
      )}
      {data.workouts.length > 100 && (
        <p className="caption">
          Showing the 100 latest sessions. Trends use the full selected window.
        </p>
      )}
    </Card>
  );
}
function InventoryTable({ data }: { data: Dataset }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Metric / provider</th>
            <th scope="col">Raw records</th>
            <th scope="col">Observed start dates</th>
            <th scope="col">First / latest</th>
          </tr>
        </thead>
        <tbody>
          {data.inventory.inventory.map((item) => (
            <tr key={`${item.provider}:${item.record_type}`}>
              <th scope="row">
                {item.record_type.replaceAll("_", " ")}
                <small>{item.provider.replaceAll("_", " ")}</small>
              </th>
              <td>{fmt(item.records)}</td>
              <td>{item.observed_days}</td>
              <td>
                {item.first_at
                  ? dateLabel(localDay(item.first_at,data.timezone))
                  : "Unknown"}
                <br />
                {item.last_at
                  ? dateLabel(localDay(item.last_at,data.timezone))
                  : "Unknown"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!data.inventory.inventory.length && (
        <p className="caption">
          No uploaded records are currently available to this account.
        </p>
      )}
    </div>
  );
}
function Sources({ data, demo }: { data: Dataset; demo: boolean }) {
  const historical = data.inventory.inventory.reduce(
    (sum, item) => sum + item.historical_records,
    0,
  );
  return (
    <>
      <Status tone={demo ? "demo" : "blue"}>
        {demo ? "DEMO · synthetic inventory" : "Authenticated server inventory"}
      </Status>
      <p className="panel-copy">
        Only uploaded server records are represented. Phone-only or queued
        observations cannot appear here. Raw records, sample observations,
        observed days and sessions are different counts.
      </p>
      <div className="source-summary">
        <div>
          <span>Latest server run</span>
          <strong>{data.inventory.sync?.status || "No run recorded"}</strong>
        </div>
        <div>
          <span>Run completion</span>
          <strong>
            {data.inventory.sync?.finished
              ? new Date(data.inventory.sync.finished).toLocaleString("en", {
                  timeZone: data.timezone,
                })
              : "Unknown"}
          </strong>
        </div>
        <div>
          <span>Historical records</span>
          <strong>
            {historical
              ? `${fmt(historical)} present · continuity unverified`
              : "No imported records observed"}
          </strong>
        </div>
        <div>
          <span>Display timezone</span>
          <strong>{data.timezone}</strong>
        </div>
        <div>
          <span>Summary state</span>
          <strong>
            {data.partial ? "Partial · updating" : "Selected window processed"}
          </strong>
        </div>
      </div>
      <p className="notice">
        Capture completeness and seven-day ingestion reliability have not been
        certified. An uploaded SUCCESS run does not prove every source day is
        present.
      </p>
      <h3>Permissions / source results</h3>
      {data.inventory.sync?.sources && (
        <div className="source-codes">
          {Object.entries(data.inventory.sync.sources).map(
            ([source, result]) => (
              <div key={source}>
                <span>{source.replaceAll("_", " ")}</span>
                <strong>{result}</strong>
              </div>
            ),
          )}
        </div>
      )}
      <h3>Database coverage</h3>
      <InventoryTable data={data} />
      <h3>Derived coverage</h3>
      <div className="source-codes">
        {(
          [
            "steps",
            "sleep",
            "hr",
            "overnightHr",
            "hrv",
            "weight",
            "trainingMinutes",
          ] as Metric[]
        ).map((metric) => (
          <div key={metric}>
            <span>{metric}</span>
            <strong>
              {data.days.filter((day) => day[metric] !== null).length} /{" "}
              {data.days.length} days
            </strong>
          </div>
        ))}
      </div>
      <p className="caption">
        {data.queryCount} bounded data queries · {data.queryMs} ms for the
        latest response. Dense arrays stay on the server; raw payloads and
        source record IDs are not returned to this page.
      </p>
    </>
  );
}
function Explanation({ name, data }: { name: string; data: Dataset }) {
  const map: Record<string, string> = {
    Readiness: data.readiness.reason,
    Steps:
      "Select one provider/package/device channel per day using the documented priority. Non-overlapping intervals within that channel are added. Other channels are not added. Ambiguous overlapping records are withheld, not merged by timestamps. Cross-midnight allocation is proportional to duration and is an estimate.",
    Sleep:
      "Assign sleep by the display timezone's wake date. Prefer Samsung over Health Connect for each date. Keep non-overlapping preferred sessions; overlapping secondary representations are not summed. Known HC asleep stages determine duration when available; otherwise a session interval is explicitly labeled.",
    "Sleep stages":
      "Preserve known source stages. Missing or unknown stages remain missing/unknown. Consumer stage measurements are not a clinical sleep assessment.",
    "Sleep-window HR":
      "Uses only Health Connect hourly sample summaries whose entire hour falls within a selected sleep interval, with at least 20 samples. This is sleep-window sampled HR, not a clinical resting-heart-rate measurement.",
    HRV: "Only Health Connect's genuine rmssd_milliseconds field is used. Samsung shrv_value, vendor score fields and HRV envelopes are not interpreted as RMSSD.",
    "Samsung Energy Score":
      "Displays Samsung's original total_score under its vendor label. It is observed vendor output and never substituted for AthleteOS readiness or RMSSD.",
    Weight:
      "Choose the preferred source channel, then the latest measurement in each local calendar date. Do not combine distinct providers' simultaneous measurements. Weight is displayed in kilograms.",
    "Weight trend":
      "Seven-day smoothing is the median of actual measured days, requiring at least three measurements in that window. Weekly change compares two adjacent seven-day medians with at least two measurements each. Percentage change divides that difference by the preceding median. No absent measurement is interpolated.",
    "Training volume":
      "Recent 7-day volume is selected session minutes. Baseline is the sum of the preceding 28 days divided by four. The ratio compares time, not physiological load or muscular stress. Unobserved sessions may make logged volume incomplete.",
    Associations:
      "Exploratory Spearman correlation needs at least 30 paired observations and 60% calendar coverage. Sleep/activity comparisons also require 20 hours of interval coverage for each step date. Suppress |rho| < 0.3 or a 95% seven-observation moving-block bootstrap interval crossing zero. Gaps, confounding and selection effects remain possible.",
    "Sleep baseline":
      "Rolling median of actual observed sleep durations across the preceding 28 days. Sample count and missingness are shown. It is descriptive, not a personal sleep requirement.",
    "Sleep timing":
      "Bedtime is displayed in local minutes. For regularity, unwrap evening times around midnight and calculate median absolute deviation over observed bedtimes. At least seven observations are required.",
    "Sleep target":
      "The preview uses an explicit eight-hour comparison target. This is a reference for charting and experimental scoring, not a clinical prescription or measured personal requirement.",
    "Cardiovascular load":
      "No strain/TRIMP score is produced without valid intensity and personal HR evidence. Minutes of training are volume, not total muscular or cardiovascular stress.",
  };
  return (
    <>
      <p className="eyebrow">{name}</p>
      <p className="panel-copy">
        {map[name] ||
          "This preview uses observed source records and deterministic source-selected trends. Missing observations are not replaced; physiological or causal conclusions need additional evidence."}
      </p>
      <div className="source-summary">
        <div>
          <span>Analytics version</span>
          <strong>{data.version}</strong>
        </div>
        <div>
          <span>Selected window</span>
          <strong>{data.days.length} days</strong>
        </div>
        <div>
          <span>Summary coverage</span>
          <strong>
            {data.partial
              ? "Partial · scores withheld"
              : "Processed · capture completeness unverified"}
          </strong>
        </div>
      </div>
      {name === "Readiness" && (
        <>
          <h3>{data.readiness.version}</h3>
          <p className="caption">
            Baseline: 35 previous days. At least 28 paired observed days (80%)
            and all three current inputs are required. Confidence remains
            MODERATE, never inflated by redistributing missing weights.
          </p>
          <div className="source-codes">
            {[
              { name: "Log-RMSSD deviation", weight: 45 },
              { name: "Sleep / 8-hour target", weight: 35 },
              { name: "Sleep-window HR deviation", weight: 20 },
            ].map((c) => (
              <div key={c.name}>
                <span>{c.name}</span>
                <strong>{c.weight}%</strong>
              </div>
            ))}
          </div>
          <p className="caption">
            RMSSD component = clamp(70 + 15 × robust z). Sleep component =
            clamp(100 × minutes / 480). HR component = clamp(70 − 15 × robust
            z). Robust z uses median and 1.4826 × MAD, with a minimum scale of
            1. Score is the weighted sum; if evidence is missing, no score is
            produced.
          </p>
        </>
      )}
      <p className="notice">
        Experimental dashboard preview. No medical diagnosis, automatic training
        prescription or Phase 1 reliability certification.
      </p>
    </>
  );
}
