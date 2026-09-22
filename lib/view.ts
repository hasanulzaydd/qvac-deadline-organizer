import { normaliseCode } from './proposal';
import type { Course, Item, Kind } from './schema';

/** A kind's mode only changes wording: "Due" for submissions, "At" for sit-in exams. */
export function dueWord(kind: Kind | undefined): string {
  return kind?.mode === 'attend' ? 'At' : 'Due';
}

export function isOverdue(item: Item, now: Date): boolean {
  return item.status === 'pending' && new Date(item.dueAt).getTime() < now.getTime();
}

export function byDueAt(a: Item, b: Item): number {
  return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
}

/** The course title, or "" when it only repeats the code ("CSE260L"). */
export function courseTitle(course: Course | undefined): string {
  if (!course?.title) return '';
  return normaliseCode(course.title) === normaliseCode(course.code) ? '' : course.title;
}

/** Swatches offered for new kinds. */
export const KIND_COLORS = ['#2563eb', '#d97706', '#dc2626', '#7c3aed', '#059669', '#db2777', '#0891b2', '#65a30d'];

// Full class strings (not built dynamically) so Tailwind can see them.
const COURSE_TONES = [
  'bg-indigo-50 border-indigo-200 text-indigo-900',
  'bg-emerald-50 border-emerald-200 text-emerald-900',
  'bg-amber-50 border-amber-200 text-amber-900',
  'bg-rose-50 border-rose-200 text-rose-900',
  'bg-sky-50 border-sky-200 text-sky-900',
  'bg-violet-50 border-violet-200 text-violet-900',
  'bg-teal-50 border-teal-200 text-teal-900',
  'bg-orange-50 border-orange-200 text-orange-900',
];

/** A stable colour per course code, so a course looks the same everywhere. */
export function courseTone(code: string): string {
  let h = 0;
  for (const ch of code) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COURSE_TONES[h % COURSE_TONES.length];
}
