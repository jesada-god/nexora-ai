function minuteInTimezone(now: Date, timezone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
    const hour = Number(parts.find((part) => part.type === 'hour')?.value);
    const minute = Number(parts.find((part) => part.type === 'minute')?.value);
    return Number.isFinite(hour) && Number.isFinite(minute) ? hour * 60 + minute : null;
  } catch { return null; }
}

function timeToMinute(value: string): number {
  const [hour = '0', minute = '0'] = value.split(':');
  return Number(hour) * 60 + Number(minute);
}

export function isQuietHour(now: Date, timezone: string, start: string, end: string): boolean {
  const current = minuteInTimezone(now, timezone);
  if (current == null) return false;
  const from = timeToMinute(start); const until = timeToMinute(end);
  if (from === until) return true;
  return from < until ? current >= from && current < until : current >= from || current < until;
}
