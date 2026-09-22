import { ChangeSchema, type Change } from './change';
import { DATE_ONLY_TIME, hasExamType, isDateOnly } from './kinds';
import { normaliseCode } from './proposal';
import { ItemSchema, type AppState } from './schema';
import { toLocalIso } from './time';
import { updateState } from './store';

/**
 * Applies one user-approved change atomically. Throws ApplyError with an HTTP
 * status and a message the UI can show; nothing is written on error.
 */

export class ApplyError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApplyError';
  }
}

function issues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

function mutate(state: AppState, change: Change): AppState {
  switch (change.type) {
    case 'item.setStatus': {
      if (!state.items.some((i) => i.id === change.id)) throw new ApplyError(404, 'no such item');
      return {
        ...state,
        items: state.items.map((i) => (i.id === change.id ? { ...i, status: change.status } : i)),
      };
    }

    case 'item.update': {
      const current = state.items.find((i) => i.id === change.id);
      if (!current) throw new ApplyError(404, 'no such item');
      const merged = { ...current, ...change.patch };
      const kind = state.kinds.find((k) => k.id === merged.kindId);
      if (!kind) throw new ApplyError(400, 'choose Quiz, Assignment or Exam');
      if (merged.courseId !== null && !state.courses.some((c) => c.id === merged.courseId)) {
        throw new ApplyError(400, 'no such course');
      }
      // Quizzes stay date-only whatever time was sent; only exams carry a type.
      if (isDateOnly(kind)) merged.dueAt = toLocalIso(merged.dueAt.slice(0, 10), DATE_ONLY_TIME);
      if (!hasExamType(kind)) merged.examType = '';
      const parsed = ItemSchema.safeParse(merged);
      if (!parsed.success) throw new ApplyError(400, issues(parsed.error));
      return { ...state, items: state.items.map((i) => (i.id === change.id ? parsed.data : i)) };
    }

    case 'routine.update': {
      const known = new Map(state.courses.map((c) => [c.id, c]));
      for (const c of change.courses) {
        if (!known.has(c.id)) throw new ApplyError(400, `course "${c.code}" does not exist — courses come from the routine screenshot`);
      }
      const courses = state.courses.map((c) => change.courses.find((e) => e.id === c.id) ?? c);
      const seen = new Map<string, string>();
      for (const c of courses) {
        const key = normaliseCode(c.code);
        if (seen.has(key)) throw new ApplyError(409, `two courses would share the code "${c.code}"`);
        seen.set(key, c.id);
      }
      const ids = new Set(courses.map((c) => c.id));
      const orphan = change.slots.find((s) => !ids.has(s.courseId));
      if (orphan) throw new ApplyError(400, 'a class refers to a course that does not exist');
      return { ...state, courses, routine: change.slots };
    }

    case 'items.remove': {
      const ids = new Set(change.ids);
      const missing = change.ids.filter((id) => !state.items.some((i) => i.id === id));
      if (missing.length) throw new ApplyError(404, `no such item: ${missing.join(', ')}`);
      return { ...state, items: state.items.filter((i) => !ids.has(i.id)) };
    }
  }
}

export async function applyChange(input: unknown): Promise<AppState> {
  const parsed = ChangeSchema.safeParse(input);
  if (!parsed.success) {
    throw new ApplyError(
      400,
      parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
    );
  }
  return updateState((state) => mutate(state, parsed.data));
}
