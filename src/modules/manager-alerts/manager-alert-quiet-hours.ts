export function managerAlertQuietUntil(now: Date, preference: { quietHoursStart: string | null; quietHoursEnd: string | null; timezone: string }): Date | null {
  const start = preference.quietHoursStart;
  const end = preference.quietHoursEnd;
  if (!start || !end || start === end) return null;
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: preference.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const quiet = (date: Date) => {
    const parts = formatter.formatToParts(date);
    const clock = `${parts.find((part) => part.type === 'hour')!.value}:${parts.find((part) => part.type === 'minute')!.value}`;
    return start < end ? clock >= start && clock < end : clock >= start || clock < end;
  };
  if (!quiet(now)) return null;
  // Follow actual timezone transitions rather than assuming every day has 24 hours.
  for (let minute = 1; minute <= 26 * 60; minute++) {
    const candidate = new Date(Math.floor(now.getTime() / 60_000) * 60_000 + minute * 60_000);
    if (!quiet(candidate)) return candidate;
  }
  throw new Error('MANAGER_ALERT_QUIET_HOURS_UNAVAILABLE');
}
