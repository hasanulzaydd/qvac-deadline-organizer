import type { Kind } from './schema';

/**
 * The app tracks exactly three kinds of deadline. They are fixed — not
 * user-editable — and seeded into data.json. Items still reference them by id.
 */
export const FIXED_KINDS: ReadonlyArray<
  Omit<Kind, 'id'> & {
    /** What the model is told this kind covers. */
    covers: string;
    /** Words that, if present in the source text, show the kind was not invented. */
    evidence: RegExp;
    /** Tracked by date only — no time of day is kept or shown. */
    dateOnly?: boolean;
  }
> = [
  {
    name: 'Quiz',
    mode: 'attend',
    color: '#d97706',
    covers: 'quizzes and class tests (CT)',
    evidence: /quiz|class\s*test|\bct\b/i,
    dateOnly: true,
  },
  {
    name: 'Assignment',
    mode: 'submit',
    color: '#2563eb',
    covers: 'anything submitted by a deadline: assignments, homework, lab reports, projects',
    evidence: /assignment|homework|\bhw\b|report|project|submi/i,
  },
  {
    name: 'Exam',
    mode: 'attend',
    color: '#dc2626',
    covers: 'midterms, finals and other exams',
    evidence: /exam|mid[\s-]*term|\bmid\b|final/i,
  },
];

export function fixedKind(name: string) {
  return FIXED_KINDS.find((k) => k.name === name);
}

/**
 * Date-only items (quizzes) are stored at the end of their day, so they sort
 * after timed deadlines that day and only count as overdue once it is over.
 */
export const DATE_ONLY_TIME = '23:59';

export function isDateOnly(kind: { name: string } | undefined): boolean {
  return Boolean(kind && fixedKind(kind.name)?.dateOnly);
}

/**
 * Where kinds from older data files go. Anything not listed maps to
 * Assignment, the catch-all for submitted work.
 */
export const LEGACY_KIND_MAP: Record<string, string> = {
  quiz: 'Quiz',
  midterm: 'Exam',
  final: 'Exam',
  exam: 'Exam',
  assignment: 'Assignment',
  'lab report': 'Assignment',
};
