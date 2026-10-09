import type { Dataset } from "@/lib/analytics/engine";

type Coverage = Pick<
  Dataset,
  "partial" | "projectionPending" | "readIncomplete" | "partialReasons"
>;

export function summaryStatus(data?: Coverage) {
  if (!data?.partial) return "Data quality";
  return data.projectionPending &&
    !data.partialReasons?.includes("PROJECTION_STATUS_UNAVAILABLE")
    ? "Summaries updating"
    : "Partial data";
}

export function summaryNotices(data: Coverage): string[] {
  if (!data.partial) return [];
  const reasons = data.partialReasons ?? [];
  const notices: string[] = [];
  if (reasons.includes("PROJECTION_STATUS_UNAVAILABLE"))
    notices.push("Summary status could not be checked. Please refresh later.");
  else if (data.projectionPending)
    notices.push("Summaries are catching up with uploaded records.");
  if (data.readIncomplete)
    notices.push(
      "Only part of this range loaded. Available charts remain visible; try a shorter range or refresh.",
    );
  if (reasons.includes("INVALID_SUMMARIES"))
    notices.push("Some summaries could not be validated.");
  if (!notices.length)
    notices.push("Only some summaries are available for this range.");
  notices.push(
    "Scores and associations are withheld until the range is complete.",
  );
  return notices;
}
