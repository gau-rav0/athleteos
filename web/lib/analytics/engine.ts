import type {
  Fact,
  Inventory,
  InventorySnapshot,
  Session,
} from "@/lib/data/schema";
import { addDays, clockMinutes, localDay, splitInterval } from "./time";
import { association, deviation, median, robustBaseline } from "./statistics";
import { MIN_ANALYTICS_HISTORY_DAYS } from "./history";
export const ANALYTICS_VERSION = "athleteos-analytics-v0.1";
export type Metric =
  | "steps"
  | "sleep"
  | "weight"
  | "bodyFat"
  | "hr"
  | "overnightHr"
  | "hrv"
  | "energy"
  | "skin"
  | "spo2"
  | "respiratory"
  | "trainingMinutes"
  | "distance";
export type Day = {
  day: string;
  steps: number | null;
  sleep: number | null;
  weight: number | null;
  weightSmooth: number | null;
  bodyFat: number | null;
  hr: number | null;
  overnightHr: number | null;
  hrv: number | null;
  energy: number | null;
  skin: number | null;
  skinDeviation: number | null;
  cardioMinutes: number | null;
  spo2: number | null;
  respiratory: number | null;
  trainingMinutes: number | null;
  distance: number | null;
  bedtime: number | null;
  wake: number | null;
  stages: Record<string, number>;
  sources: Partial<Record<Metric, string>>;
  sampleCounts: Partial<Record<Metric, number>>;
  stepCoverageMinutes: number;
  warnings: string[];
};
type Observation = {
  fact: Fact;
  value: number;
  start: number;
  end: number;
  samples: number;
  estimated: boolean;
};
type Contributor = {
  name: string;
  score: number;
  weight: number;
  direction: string;
  samples: number;
};
export type Readiness = {
  score: number | null;
  confidence: "INSUFFICIENT_DATA" | "MODERATE";
  reason: string;
  version: string;
  contributors: Contributor[];
  baselineDays: number;
};
export type PartialReason =
  | "PROJECTION_PENDING"
  | "PROJECTION_STATUS_UNAVAILABLE"
  | "READ_INCOMPLETE"
  | "INVALID_SUMMARIES";
export type Dataset = {
  version: string;
  timezone: string;
  today: string;
  days: Day[];
  workouts: Session[];
  inventory: Inventory;
  inventoryAvailable?: boolean;
  inventorySnapshot?: InventorySnapshot;
  partial: boolean;
  projectionPending?: boolean;
  readIncomplete?: boolean;
  partialReasons?: PartialReason[];
  invalidFacts: number;
  readiness: Readiness;
  sleepBaseline: ReturnType<typeof robustBaseline>;
  sleepRegularity: number | null;
  weightChange: { kg: number; percent: number; samples: number } | null;
  weightThirtyChange: { kg: number; samples: number } | null;
  volume: {
    seven: number | null;
    baseline: number | null;
    ratio: number | null;
  };
  insight: ReturnType<typeof association>;
  fetchedAt: string;
  queryCount: number;
  queryMs: number;
  timings?: {
    rpcMs: number;
    analyticsMs: number;
    statusMs: number;
    inventoryMs: number;
    pageMs: number;
  };
  excludedOverlaps: number;
};
const emptyDay = (day: string): Day => ({
  day,
  steps: null,
  sleep: null,
  weight: null,
  weightSmooth: null,
  bodyFat: null,
  hr: null,
  overnightHr: null,
  hrv: null,
  energy: null,
  skin: null,
  skinDeviation: null,
  cardioMinutes: null,
  spo2: null,
  respiratory: null,
  trainingMinutes: null,
  distance: null,
  bedtime: null,
  wake: null,
  stages: {},
  sources: {},
  sampleCounts: {},
  stepCoverageMinutes: 0,
  warnings: [],
});
function metric(f: Fact): Metric | null {
  return (
    (
      {
        steps: "steps",
        steps_daily: "steps",
        pedometer_day_summary: "steps",
        activity_summary: "steps",
        weight: "weight",
        body_composition: "weight",
        body_fat: "bodyFat",
        heart_rate: "hr",
        hrv_rmssd: "hrv",
        energy_score: "energy",
        skin_temperature: "skin",
        blood_oxygen: "spo2",
        respiratory_rate: "respiratory",
        distance: "distance",
      } as Record<string, Metric>
    )[f.kind] || null
  );
}
function validValue(m: Metric, v: number): boolean {
  if (!Number.isFinite(v)) return false;
  if (m === "weight") return v > 0 && v < 1000;
  if (m === "hr") return v > 0 && v < 1000;
  if (m === "bodyFat" || m === "spo2" || m === "energy")
    return v >= 0 && v <= 100;
  if (m === "skin") return v > -100 && v < 100;
  return v >= 0;
}
function sourceLabel(f: Fact) {
  return `${f.provider === "samsung_health" ? "Samsung Health" : "Health Connect"} · ${f.source}`;
}
function intervalsOverlap(
  a: { start: number; end: number },
  b: { start: number; end: number },
) {
  return a.start < b.end && b.start < a.end;
}
export function readiness(days: Day[], partial: boolean): Readiness {
  const base = {
    score: null,
    confidence: "INSUFFICIENT_DATA" as const,
    version: "experimental-readiness-v0.1",
    contributors: [],
    baselineDays: 35,
  };
  if (partial)
    return {
      ...base,
      reason: "Data summaries are still updating. A score is withheld.",
    };
  const current = days.at(-1);
  if (
    !current ||
    current.sleep === null ||
    current.hrv === null ||
    current.overnightHr === null
  )
    return {
      ...base,
      reason:
        "Sleep, genuine RMSSD and sleep-window heart rate are all required. Missing signals are not replaced.",
    };
  const history = days.slice(-36, -1),
    paired = history.filter(
      (d) => d.sleep !== null && d.hrv !== null && d.overnightHr !== null,
    );
  if (history.length < 35 || paired.length < 28)
    return {
      ...base,
      reason:
        "Needs 28 paired observed days in a 35-day baseline, with at least 80% core-signal coverage.",
    };
  const hrv = deviation(
    Math.log(Math.max(0.01, current.hrv)),
    paired.map((d) => Math.log(Math.max(0.01, d.hrv!))),
  );
  const hr = deviation(
    current.overnightHr,
    paired.map((d) => d.overnightHr!),
  );
  if (hrv === null || hr === null)
    return { ...base, reason: "Personal baseline is insufficient." };
  const clamp = (x: number) => Math.max(0, Math.min(100, x));
  const contributors = [
    {
      name: "RMSSD vs baseline",
      score: clamp(70 + hrv * 15),
      weight: 0.45,
      direction: hrv >= 0 ? "above baseline" : "below baseline",
      samples: paired.length,
    },
    {
      name: "Sleep vs selected target",
      score: clamp((current.sleep / 480) * 100),
      weight: 0.35,
      direction: current.sleep >= 480 ? "target met" : "below target",
      samples: paired.length,
    },
    {
      name: "Sleep-window HR vs baseline",
      score: clamp(70 - hr * 15),
      weight: 0.2,
      direction: hr <= 0 ? "at or below baseline" : "above baseline",
      samples: paired.length,
    },
  ];
  return {
    score: Math.round(
      contributors.reduce((sum, c) => sum + c.score * c.weight, 0),
    ),
    confidence: "MODERATE",
    reason:
      "Experimental wellness context, not a validated physiological or medical score. Sleep-window HR is not clinical resting HR.",
    version: base.version,
    contributors,
    baselineDays: 35,
  };
}
export function buildDataset(
  facts: Fact[],
  inventory: Inventory,
  options: {
    days: number;
    timezone: string;
    now?: Date;
    partial?: boolean;
    invalidFacts?: number;
  },
): Dataset {
  const now = options.now || new Date(),
    today = localDay(now, options.timezone),
    historyDays = Math.max(options.days, MIN_ANALYTICS_HISTORY_DAYS),
    first = addDays(today, 1 - historyDays);
  const calendar = new Map<string, Day>();
  for (let i = 0; i < historyDays; i++) {
    const day = addDays(first, i);
    calendar.set(day, emptyDay(day));
  }
  const groups = new Map<string, Map<string, Observation[]>>(),
    identities = new Set<string>();
  const selectedChannels = new Map<string, string>();
  let excludedOverlaps = 0;
  const add = (day: string, m: Metric, observation: Observation) => {
    if (!calendar.has(day)) return;
    const key = `${day}:${m}`,
      channels = groups.get(key) || new Map<string, Observation[]>();
    const rows = channels.get(observation.fact.channel) || [];
    rows.push(observation);
    channels.set(observation.fact.channel, rows);
    groups.set(key, channels);
  };
  const allSessions: Session[] = [];
  for (const fact of facts) {
    if (identities.has(fact.id)) continue;
    identities.add(fact.id);
    if (!fact.supported) continue;
    if (fact.kind === "sleep" || fact.kind === "exercise")
      for (const session of fact.sessions) {
        if (
          Date.parse(session.end) <= Date.parse(session.start) ||
          session.minutes > 1440 * 7
        )
          continue;
        allSessions.push({
          ...session,
          day: localDay(
            fact.kind === "sleep" ? session.end : session.start,
            options.timezone,
          ),
          provider: fact.provider,
          source: sourceLabel(fact),
        });
      }
    const m = metric(fact);
    if (!m || fact.value === null || !validValue(m, fact.value)) continue;
    if (m === "steps" || m === "distance") {
      const slices = fact.end
        ? splitInterval(fact.start, fact.end, options.timezone)
        : [];
      if (!slices.length) continue;
      for (const slice of slices)
        add(slice.day, m, {
          fact,
          value: fact.value * slice.fraction,
          start: slice.start,
          end: slice.end,
          samples: 1,
          estimated: slices.length > 1,
        });
    } else
      add(localDay(fact.start, options.timezone), m, {
        fact,
        value: fact.value,
        start: Date.parse(fact.start),
        end: Date.parse(fact.end || fact.start),
        samples: fact.samples || 1,
        estimated: false,
      });
    if (
      m === "weight" &&
      fact.bodyFat !== null &&
      validValue("bodyFat", fact.bodyFat)
    )
      add(localDay(fact.start, options.timezone), "bodyFat", {
        fact,
        value: fact.bodyFat,
        start: Date.parse(fact.start),
        end: Date.parse(fact.start),
        samples: 1,
        estimated: false,
      });
  }
  for (const [key, channels] of groups) {
    const [day, m] = key.split(":") as [string, Metric],
      row = calendar.get(day)!;
    const candidates = [...channels.values()].sort(
      (a, b) =>
        Math.max(...b.map((o) => o.fact.rank)) -
          Math.max(...a.map((o) => o.fact.rank)) ||
        a[0].fact.channel.localeCompare(b[0].fact.channel),
    );
    let selected: Observation[] | undefined;
    for (const observations of candidates) {
      observations.sort((a, b) => a.start - b.start);
      if (
        (m === "steps" || m === "distance") &&
        observations.some((o, i) => i > 0 && o.start < observations[i - 1].end)
      ) {
        excludedOverlaps += observations.length;
        row.warnings.push(
          `${m}: overlapping records in a source channel were withheld`,
        );
        continue;
      }
      selected = observations;
      break;
    }
    if (!selected) continue;
    const representative = selected.at(-1)!;
    selectedChannels.set(key, representative.fact.channel);
    row[m] =
      m === "steps" || m === "distance"
        ? selected.reduce((sum, o) => sum + o.value, 0)
        : m === "weight" || m === "bodyFat"
          ? representative.value
          : selected.reduce((sum, o) => sum + o.value * o.samples, 0) /
            selected.reduce((sum, o) => sum + o.samples, 0);
    row.sources[m] = sourceLabel(representative.fact);
    row.sampleCounts[m] = selected.reduce((sum, o) => sum + o.samples, 0);
    if (m === "steps")
      row.stepCoverageMinutes = selected.reduce(
        (sum, o) => sum + (o.end - o.start) / 60000,
        0,
      );
    if (selected.some((o) => o.estimated))
      row.warnings.push(
        `${m}: crossing-midnight counts are allocated by interval duration`,
      );
  }
  // Keep the existing overnight inclusion and traversal order exactly. These
  // buckets are intentionally separate from the daily metric identity filter:
  // overnight selection historically visits every HC heart-rate fact.
  const sleepHeartBuckets: {
    fact: Fact;
    start: number;
    end: number;
    mean: number;
    count: number;
  }[] = [];
  for (const fact of facts) {
    if (fact.provider !== "health_connect" || fact.kind !== "heart_rate")
      continue;
    for (const bucket of fact.hourly) {
      if (!bucket.count) continue;
      sleepHeartBuckets.push({
        fact,
        start: Date.parse(bucket.start),
        end: Date.parse(bucket.end),
        mean: bucket.mean,
        count: bucket.count,
      });
    }
  }
  const canonicalSessions: Session[] = [];
  for (const day of calendar.keys())
    for (const kind of ["sleep", "exercise"]) {
      const sessions = allSessions.filter(
        (s) =>
          s.day === day &&
          (kind === "sleep" ? s.category === "sleep" : s.category !== "sleep"),
      );
      if (!sessions.length) continue;
      const preferred = sessions.some((s) => s.provider === "samsung_health")
        ? "samsung_health"
        : "health_connect";
      const selected = sessions
          .filter((s) => s.provider === preferred)
          .sort((a, b) => b.minutes - a.minutes),
        kept: Session[] = [];
      for (const s of selected) {
        if (
          kept.some((other) =>
            intervalsOverlap(
              { start: Date.parse(s.start), end: Date.parse(s.end) },
              { start: Date.parse(other.start), end: Date.parse(other.end) },
            ),
          )
        ) {
          excludedOverlaps++;
          continue;
        }
        kept.push(s);
      }
      const row = calendar.get(day)!;
      if (kind === "sleep") {
        row.sleep = kept.reduce((sum, s) => sum + s.minutes, 0);
        row.sources.sleep = kept[0].source;
        row.sampleCounts.sleep = kept.length;
        row.bedtime = clockMinutes(kept[0].start, options.timezone);
        row.wake = clockMinutes(kept[0].end, options.timezone);
        for (const session of kept) {
          for (const [stage, minutes] of Object.entries(session.stages))
            row.stages[stage] = (row.stages[stage] || 0) + minutes;
          if (session.durationBasis === "interval")
            row.warnings.push(
              "Sleep duration uses session interval; time asleep is not separately proven.",
            );
        }
      } else {
        row.trainingMinutes = kept.reduce((sum, s) => sum + s.minutes, 0);
        row.sources.trainingMinutes = kept[0].source;
        row.sampleCounts.trainingMinutes = kept.length;
        canonicalSessions.push(...kept);
        const cardio = kept.filter((s) =>
          [
            "RUNNING",
            "WALKING",
            "CYCLING",
            "HIKING",
            "RUNNING_TREADMILL",
            "56",
            "79",
            "8",
            "37",
          ].includes(s.category),
        );
        if (cardio.length)
          row.cardioMinutes = cardio.reduce((sum, s) => sum + s.minutes, 0);
      }
      if (kind === "sleep") {
        const sleepBounds = kept.map((session) => ({
          start: Date.parse(session.start),
          end: Date.parse(session.end),
        }));
        const hourly = new Map<
          string,
          { rank: number; sum: number; count: number; source: string }
        >();
        for (const bucket of sleepHeartBuckets) {
          if (
            !sleepBounds.some(
              (s) => bucket.start >= s.start && bucket.end <= s.end,
            )
          )
            continue;
          const f = bucket.fact;
          const group = hourly.get(f.channel) || {
            rank: f.rank,
            sum: 0,
            count: 0,
            source: sourceLabel(f),
          };
          group.sum += bucket.mean * bucket.count;
          group.count += bucket.count;
          hourly.set(f.channel, group);
        }
        const best = [...hourly.values()].sort((a, b) => b.rank - a.rank)[0];
        if (best && best.count >= 20) {
          row.overnightHr = best.sum / best.count;
          row.sources.overnightHr = best.source;
          row.sampleCounts.overnightHr = best.count;
        }
      }
    }
  const full = [...calendar.values()];
  for (let i = 0; i < full.length; i++) {
    const day = full[i];
    const previousSkin = full
      .slice(Math.max(0, i - 28), i)
      .filter(
        (d) =>
          d.skin !== null &&
          selectedChannels.get(`${d.day}:skin`) ===
            selectedChannels.get(`${day.day}:skin`),
      )
      .map((d) => d.skin!);
    const center = median(previousSkin);
    if (day.skin !== null && center !== null && previousSkin.length >= 14)
      day.skinDeviation = day.skin - center;
  }
  for (let i = 0; i < full.length; i++) {
    const measured = full
      .slice(Math.max(0, i - 6), i + 1)
      .map((d) => d.weight)
      .filter((v): v is number => v !== null);
    full[i].weightSmooth = measured.length >= 3 ? median(measured) : null;
  }
  const recent = full
      .slice(-7)
      .map((d) => d.weight)
      .filter((v): v is number => v !== null),
    previous = full
      .slice(-14, -7)
      .map((d) => d.weight)
      .filter((v): v is number => v !== null),
    currentMedian = median(recent),
    previousMedian = median(previous);
  const weightChange =
    recent.length >= 2 &&
    previous.length >= 2 &&
    currentMedian !== null &&
    previousMedian !== null
      ? {
          kg: currentMedian - previousMedian,
          percent: ((currentMedian - previousMedian) / previousMedian) * 100,
          samples: recent.length + previous.length,
        }
      : null;
  const earlyThirty = full
    .slice(-30, -23)
    .map((d) => d.weight)
    .filter((v): v is number => v !== null);
  const earlyMedian = median(earlyThirty);
  const weightThirtyChange =
    recent.length >= 2 &&
    earlyThirty.length >= 2 &&
    currentMedian !== null &&
    earlyMedian !== null
      ? {
          kg: currentMedian - earlyMedian,
          samples: recent.length + earlyThirty.length,
        }
      : null;
  const minuteSum = (rows: Day[]) =>
    rows.some((d) => d.trainingMinutes !== null)
      ? rows.reduce((sum, d) => sum + (d.trainingMinutes || 0), 0)
      : null;
  const seven = minuteSum(full.slice(-7)),
    baseTotal = minuteSum(full.slice(-35, -7)),
    baseline = baseTotal === null ? null : baseTotal / 4;
  const volume = {
    seven,
    baseline,
    ratio:
      seven !== null && baseline !== null && baseline > 0
        ? seven / baseline
        : null,
  };
  const shown = full.slice(-options.days),
    pairs = shown
      .filter(
        (d) =>
          d.sleep !== null && d.steps !== null && d.stepCoverageMinutes >= 1200,
      )
      .map((d) => [d.sleep!, d.steps!] as [number, number]);
  const bedtimes = full
    .slice(-28)
    .filter((d) => d.bedtime !== null)
    .map((d) => (d.bedtime! > 720 ? d.bedtime! - 1440 : d.bedtime!));
  const bedtimeMedian = median(bedtimes),
    regularity =
      bedtimeMedian === null || bedtimes.length < 7
        ? null
        : median(bedtimes.map((v) => Math.abs(v - bedtimeMedian)));
  return {
    version: ANALYTICS_VERSION,
    timezone: options.timezone,
    today,
    days: shown,
    workouts: canonicalSessions
      .filter((s) => s.day >= shown[0].day)
      .sort((a, b) => Date.parse(b.start) - Date.parse(a.start)),
    inventory,
    partial: !!options.partial,
    invalidFacts: options.invalidFacts || 0,
    readiness: readiness(full, !!options.partial),
    sleepBaseline: robustBaseline(
      full
        .slice(-29, -1)
        .map((d) => d.sleep)
        .filter((v): v is number => v !== null),
    ),
    sleepRegularity: regularity,
    weightChange,
    weightThirtyChange,
    volume,
    insight: options.partial ? null : association(pairs, options.days),
    fetchedAt: now.toISOString(),
    queryCount: 0,
    queryMs: 0,
    excludedOverlaps,
  };
}
