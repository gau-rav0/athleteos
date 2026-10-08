"use client";
import type { Dataset, Metric } from "@/lib/analytics/engine";
import { localDay } from "@/lib/analytics/time";
import { Status, fmt, dateLabel } from "./dashboard-primitives";
export function InventoryTable({ data }: { data: Dataset }) {
  return (
    <div
      className="table-scroll"
      role="region"
      aria-label="Scrollable data table"
      tabIndex={0}
    >
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
                  ? dateLabel(localDay(item.first_at, data.timezone))
                  : "Unknown"}
                <br />
                {item.last_at
                  ? dateLabel(localDay(item.last_at, data.timezone))
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
export function Sources({ data, demo }: { data: Dataset; demo: boolean }) {
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
export function Explanation({ name, data }: { name: string; data: Dataset }) {
  const map: Record<string, string> = {
    "Skin temperature deviation":
      "Current skin measurement minus the preceding 28-day median from the same source, requiring at least 14 measured days. Source changes reset usable evidence. Peripheral temperature is not core temperature or a diagnosis.",
    "Logged cardio minutes":
      "Minutes of source-labeled running, walking, cycling or hiking sessions. Unknown categories and HR spikes are never converted to workouts. This is logged duration, not physiological strain or demonstrated performance improvement.",
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
