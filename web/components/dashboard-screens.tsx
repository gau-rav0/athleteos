"use client";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Check,
  Dumbbell,
  Heart,
  Moon,
  TrendingUp,
} from "lucide-react";
import type { Dataset, Day } from "@/lib/analytics/engine";
import {
  Card,
  Metric,
  Status,
  Empty,
  fmt,
  sleepFmt,
  latest,
  dateLabel,
  category,
} from "./dashboard-primitives";
import { TrendChart } from "./trend-chart";
import { InventoryTable } from "./dashboard-quality";
export function Screens({
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
      kicker={
        ["skinDeviation", "weightSmooth", "cardioMinutes"].includes(metric)
          ? "DERIVED TREND"
          : "SOURCE-SELECTED TREND"
      }
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
              detail={
                measured(sleep) +
                (sleep?.warnings.some((w) => w.startsWith("Sleep duration"))
                  ? " · interval; time asleep unverified"
                  : "")
              }
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
            detail={
              measured(sleep) +
              (sleep?.warnings.some((w) => w.startsWith("Sleep duration"))
                ? " · interval; time asleep unverified"
                : "")
            }
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
          {chart(
            "Skin temperature deviation",
            "skinDeviation",
            "°C vs baseline",
            "#cdbd9e",
            "line",
          )}
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
    const measuredWeights = data.days.filter((d) => d.weight !== null).length;
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
            label="30-day weight change"
            value={fmt(data.weightThirtyChange?.kg, 2)}
            unit="kg"
            detail={
              data.weightThirtyChange
                ? `${data.weightThirtyChange.samples} observations · edge-week medians`
                : "Needs two measurements in each edge week"
            }
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
          {chart(
            "Logged cardio minutes",
            "cardioMinutes",
            "min",
            "#a5cfff",
            "bar",
          )}
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
      <div
        className="table-scroll"
        role="region"
        aria-label="Scrollable data table"
        tabIndex={0}
      >
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
