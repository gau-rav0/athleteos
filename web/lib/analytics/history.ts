// Current metrics need up to 35 preceding days. 61 calendar days retain full
// 28-day displayed rolling context and leave 60 preceding days plus today.
// This is acquisition scope, not a new baseline model or an analytics score.
export const MIN_ANALYTICS_HISTORY_DAYS = 61;
