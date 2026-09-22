import { normaliseCode, ProposalSchema } from './proposal';
import {
  CourseSchema,
  ItemSchema,
  RoutineSlotSchema,
  type AppState,
  type Course,
  type Item,
  type RoutineSlot,
} from './schema';
import { newId, updateState } from './store';
import { DATE_ONLY_TIME, isDateOnly } from './kinds';
import { toLocalIso } from './time';

/**
 * Saves a user-approved proposal. Every record is re-validated against the
 * strict storage schemas AND against the current state (the kind or course
 * it references must still exist) inside the store's write queue, so a
 * proposal is saved entirely or not at all.
 */

export class ConfirmError extends Error {
  constructor(readonly issues: string[]) {
    super(issues.join('; '));
    this.name = 'ConfirmError';
  }
}

/**
 * A routine already exists and the caller did not say to replace it. A new
 * routine replaces the whole old one, so the user must confirm that first.
 */
export class RoutineExistsError extends Error {
  constructor(readonly existingSlots: number) {
    super(`a routine with ${existingSlots} slot(s) already exists — confirm to replace it`);
    this.name = 'RoutineExistsError';
  }
}

export type ConfirmResult =
  | { type: 'item'; items: Item[] }
  | { type: 'routine'; courses: Course[]; slots: RoutineSlot[]; replacedSlots: number };

function zodIssues(prefix: string, error: { issues: { path: PropertyKey[]; message: string }[] }) {
  return error.issues.map((i) => `${prefix}${i.path.length ? '.' + i.path.join('.') : ''}: ${i.message}`);
}

export async function confirmProposal(
  input: unknown,
  options: { replaceRoutine?: boolean } = {},
): Promise<ConfirmResult> {
  const parsed = ProposalSchema.safeParse(input);
  if (!parsed.success) throw new ConfirmError(zodIssues('proposal', parsed.error));
  const proposal = parsed.data;

  let result: ConfirmResult | undefined;

  await updateState((state: AppState) => {
    const issues: string[] = [];
    const now = new Date().toISOString();
    const kindIds = new Set(state.kinds.map((k) => k.id));
    const courseIds = new Set(state.courses.map((c) => c.id));

    if (proposal.type === 'item') {
      const items: Item[] = [];
      proposal.items.forEach((draft, i) => {
        const at = `items[${i}]`;
        if (draft.kindId === null) issues.push(`${at}.kindId: choose Quiz, Assignment or Exam`);
        else if (!kindIds.has(draft.kindId)) issues.push(`${at}.kindId: no such kind`);
        if (draft.courseId !== null && !courseIds.has(draft.courseId)) issues.push(`${at}.courseId: no such course`);
        if (draft.kindId === null) return;
        // Quizzes keep their calendar date only: whatever time came in, store
        // the end of that day. The date is read as written (its own offset).
        const kind = state.kinds.find((k) => k.id === draft.kindId);
        const dueAt =
          draft.dueAt && isDateOnly(kind) ? toLocalIso(draft.dueAt.slice(0, 10), DATE_ONLY_TIME) : draft.dueAt;
        const item = ItemSchema.safeParse({ ...draft, dueAt, id: newId(), status: 'pending', createdAt: now });
        if (item.success) items.push(item.data);
        else issues.push(...zodIssues(at, item.error));
      });
      if (issues.length) throw new ConfirmError(issues);
      result = { type: 'item', items };
      return { ...state, items: [...state.items, ...items] };
    }

    // Routine: a new routine REPLACES the whole old one (never merges), and
    // only after the user confirmed that. Courses are upserted by id and never
    // removed, because items may still reference them.
    if (state.routine.length > 0 && !options.replaceRoutine) {
      throw new RoutineExistsError(state.routine.length);
    }

    const courses = new Map(state.courses.map((c) => [c.id, c]));
    proposal.courses.forEach((c, i) => {
      const at = `courses[${i}]`;
      const course = CourseSchema.safeParse(c);
      if (!course.success) return void issues.push(...zodIssues(at, course.error));
      const clash = state.courses.find(
        (s) => s.id !== c.id && normaliseCode(s.code) === normaliseCode(c.code),
      );
      if (clash) {
        issues.push(`${at}: code "${c.code}" already belongs to a saved course (id ${clash.id}) — use that id to update it`);
        return;
      }
      courses.set(c.id, course.data);
    });

    const slots: RoutineSlot[] = [];
    proposal.slots.forEach((s, i) => {
      const at = `slots[${i}]`;
      const slot = RoutineSlotSchema.safeParse(s);
      if (!slot.success) return void issues.push(...zodIssues(at, slot.error));
      if (!courses.has(s.courseId)) return void issues.push(`${at}.courseId: no such course`);
      slots.push(slot.data);
    });

    if (issues.length) throw new ConfirmError(issues);
    result = {
      type: 'routine',
      courses: proposal.courses.map((c) => courses.get(c.id)!),
      slots,
      replacedSlots: state.routine.length,
    };
    return { ...state, courses: [...courses.values()], routine: slots };
  });

  return result!;
}
