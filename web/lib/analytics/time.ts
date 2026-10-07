const formatters = new Map<string, Intl.DateTimeFormat>();
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
    formatters.set(timezone, formatter);
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
  const target = Date.parse(day + "T00:00:00Z");
  let guess = target;
  const formatter = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let i = 0; i < 4; i++) {
    const parts = formatter.formatToParts(new Date(guess)),
      get = (type: string) => parts.find((p) => p.type === type)!.value;
    const represented = Date.parse(
      `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}Z`,
    );
    guess += target - represented;
  }
  return guess;
}
export function clockMinutes(value: string, timezone: string): number {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
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
