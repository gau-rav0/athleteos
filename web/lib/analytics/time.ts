const formatters = new Map<string, Intl.DateTimeFormat>();
const midnightFormatters = new Map<string, Intl.DateTimeFormat>();
const clockFormatters = new Map<string, Intl.DateTimeFormat>();
// Calendar-only memoization: no account, record identity or health measurement.
// Bound all maps so arbitrary valid timezones/ranges cannot grow process memory.
const midnightCache = new Map<string, number>();
function remember<T>(
  map: Map<string, T>,
  key: string,
  value: T,
  limit: number,
) {
  if (map.size >= limit && !map.has(key)) map.delete(map.keys().next().value!);
  map.set(key, value);
}
export function localDay(
  value: string | number | Date,
  timezone: string,
): string {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    remember(formatters, timezone, formatter, 64);
  }
  const parts = formatter.formatToParts(new Date(value)),
    get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export function addDays(day: string, amount: number): string {
  return new Date(Date.parse(day + "T12:00:00Z") + amount * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function midnight(day: string, timezone: string): number {
  const key = timezone + "\u0000" + day;
  const cached = midnightCache.get(key);
  if (cached !== undefined) return cached;
  const target = Date.parse(day + "T00:00:00Z");
  let guess = target;
  let formatter = midnightFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    remember(midnightFormatters, timezone, formatter, 64);
  }
  for (let i = 0; i < 4; i++) {
    const parts = formatter.formatToParts(new Date(guess)),
      get = (type: string) => parts.find((p) => p.type === type)!.value;
    const represented = Date.parse(
      `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`,
    );
    guess += target - represented;
  }
  remember(midnightCache, key, guess, 4096);
  return guess;
}
export function clockMinutes(value: string, timezone: string): number {
  let formatter = clockFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    remember(clockFormatters, timezone, formatter, 64);
  }
  const parts = formatter.formatToParts(new Date(value));
  return (
    Number(parts.find((p) => p.type === "hour")!.value) * 60 +
    Number(parts.find((p) => p.type === "minute")!.value)
  );
}
export function splitInterval(
  start: string,
  end: string,
  timezone: string,
): { day: string; start: number; end: number; fraction: number }[] {
  const from = Date.parse(start),
    until = Date.parse(end);
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(until) ||
    until <= from ||
    until - from > 734 * 86400000
  )
    return [];
  const slices = [];
  let cursor = from;
  while (cursor < until) {
    const day = localDay(cursor, timezone),
      next = Math.min(until, midnight(addDays(day, 1), timezone));
    if (next <= cursor) break;
    slices.push({
      day,
      start: cursor,
      end: next,
      fraction: (next - cursor) / (until - from),
    });
    cursor = next;
  }
  return slices;
}
