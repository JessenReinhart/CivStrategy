const MS_PER_MINUTE = 60_000;

export function treatyMinutesToMilliseconds(minutes: number | undefined): number {
  if (!Number.isFinite(minutes) || minutes === undefined) return 0;
  return Math.max(0, minutes) * MS_PER_MINUTE;
}
