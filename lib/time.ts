/**
 * Date/time helpers shared by server and browser code. Everything is local
 * time: the app runs on the student's own machine, so "local" is theirs.
 * Stored timestamps are full ISO strings with an explicit offset.
 */

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** "2026-09-22" for a Date, in local time. */
export function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "2026-10-14" + "23:59" → "2026-10-14T23:59:00+06:00" in the local zone. */
export function toLocalIso(date: string, time: string): string {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const offsetMin = -new Date(y, mo - 1, d, h, mi).getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return `${date}T${time}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

export function localIsoNow(now = new Date()): string {
  return toLocalIso(localDate(now), `${pad(now.getHours())}:${pad(now.getMinutes())}`);
}

/** ISO timestamp → value for <input type="datetime-local"> ("2026-10-14T23:59"). */
export function toInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${localDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** <input type="datetime-local"> value → ISO with local offset, or null if empty. */
export function fromInputValue(value: string): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value);
  return m ? toLocalIso(m[1], m[2]) : null;
}

/** "13:50" → "1:50 PM". */
export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
}

/** ISO → "Wed 14 Oct, 11:59 PM". */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${date}, ${formatClock(`${pad(d.getHours())}:${pad(d.getMinutes())}`)}`;
}

/** Whole calendar days from today to the given instant (negative = past). */
export function daysFromToday(iso: string, now = new Date()): number {
  const d = new Date(iso);
  const a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const b = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((b - a) / 86_400_000);
}

/** "Today", "Tomorrow", "in 5 days", "Yesterday", "3 days ago". */
export function relativeDay(iso: string, now = new Date()): string {
  const days = daysFromToday(iso, now);
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}
