export function median(values: number[]): number | null {
  const list = values.filter(Number.isFinite).sort((a, b) => a - b),
    n = list.length;
  if (!n) return null;
  return n % 2 ? list[(n - 1) / 2] : (list[n / 2 - 1] + list[n / 2]) / 2;
}
export function robustBaseline(values: number[]) {
  const center = median(values);
  return {
    median: center,
    mad:
      center === null ? null : median(values.map((v) => Math.abs(v - center))),
    samples: values.length,
  };
}
export function deviation(value: number, values: number[]): number | null {
  const baseline = robustBaseline(values);
  if (
    baseline.median === null ||
    baseline.mad === null ||
    baseline.samples < 28
  )
    return null;
  return (value - baseline.median) / Math.max(1, baseline.mad * 1.4826);
}
function ranks(values: number[]): number[] {
  const sorted = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v),
    out = Array(values.length).fill(0);
  for (let i = 0; i < sorted.length;) {
    let end = i + 1;
    while (end < sorted.length && sorted[end].v === sorted[i].v) end++;
    const rank = (i + 1 + end) / 2;
    for (let j = i; j < end; j++) out[sorted[j].i] = rank;
    i = end;
  }
  return out;
}
export function spearman(pairs: [number, number][]): number | null {
  if (pairs.length < 3) return null;
  const x = ranks(pairs.map((p) => p[0])),
    y = ranks(pairs.map((p) => p[1]));
  const mean = (x.length + 1) / 2;
  let cov = 0,
    xx = 0,
    yy = 0;
  for (let i = 0; i < x.length; i++) {
    cov += (x[i] - mean) * (y[i] - mean);
    xx += (x[i] - mean) ** 2;
    yy += (y[i] - mean) ** 2;
  }
  return xx && yy ? cov / Math.sqrt(xx * yy) : null;
}
export function association(pairs: [number, number][], windowDays: number) {
  if (pairs.length < 30 || pairs.length / windowDays < 0.6) return null;
  const rho = spearman(pairs);
  if (rho === null || Math.abs(rho) < 0.3) return null;
  // Deterministic seven-observation moving-block bootstrap; protects against
  // treating adjacent daily observations as wholly independent samples.
  let seed = 731;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const scores: number[] = [];
  for (let iteration = 0; iteration < 600; iteration++) {
    const sample: [number, number][] = [];
    while (sample.length < pairs.length) {
      const start = Math.floor(random() * pairs.length);
      for (let j = 0; j < 7 && sample.length < pairs.length; j++)
        sample.push(pairs[(start + j) % pairs.length]);
    }
    const r = spearman(sample);
    if (r !== null) scores.push(r);
  }
  scores.sort((a, b) => a - b);
  const low = scores[Math.floor(scores.length * 0.025)],
    high = scores[Math.floor(scores.length * 0.975)];
  if (scores.length < 500 || (low <= 0 && high >= 0)) return null;
  return {
    rho,
    low,
    high,
    samples: pairs.length,
    coverage: pairs.length / windowDays,
    version: "association-block-bootstrap-v0.1",
    windowDays,
  };
}
