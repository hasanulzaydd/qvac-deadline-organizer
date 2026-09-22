import { kindNameKey } from './change';
import { normaliseCode, ProposalSchema } from './proposal';
import {
  CourseSchema,
  ItemSchema,
  KindSchema,
  NoticeSchema,
  RoutineSlotSchema,
  type AppState,
  type Course,
  type Item,
  type Kind,
  type Notice,
  type RoutineSlot,
} from './schema';
import { newId, updateState } from './store';

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
  | { type: 'item'; items: Item[]; createdKinds: Kind[] }
  | { type: 'notice'; notices: Notice[] }
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
      // Kinds created in this same action ("+ Create new kind"), keyed by
      // name, so several items can share one new kind and an existing kind
      // with the same name is reused instead of duplicated.
      const kinds = [...state.kinds];
      const createdKinds: Kind[] = [];
      const kindFor = (newKind: Omit<Kind, 'id'>): Kind => {
        const key = kindNameKey(newKind.name);
        const existing = kinds.find((k) => kindNameKey(k.name) === key);
        if (existing) return existing;
        const kind = KindSchema.parse({ ...newKind, name: newKind.name.trim(), id: newId() });
        kinds.push(kind);
        createdKinds.push(kind);
        return kind;
      };

      proposal.items.forEach((draft, i) => {
        const at = `items[${i}]`;
        const { newKind, ...fields } = draft;
        let kindId = fields.kindId;
        if (kindId === null && newKind) {
          const kind = KindSchema.omit({ id: true }).safeParse(newKind);
          if (kind.success) kindId = kindFor(kind.data).id;
          else issues.push(...zodIssues(`${at}.newKind`, kind.error));
        }
        if (kindId === null) {
          if (!newKind) issues.push(`${at}.kindId: choose a kind`);
        } else if (!kindIds.has(kindId) && !createdKinds.some((k) => k.id === kindId)) {
          issues.push(`${at}.kindId: no such kind`);
        }
        if (fields.courseId !== null && !courseIds.has(fields.courseId)) issues.push(`${at}.courseId: no such course`);
        if (kindId === null) return;
        const item = ItemSchema.safeParse({ ...fields, kindId, id: newId(), status: 'pending', createdAt: now });
        if (item.success) items.push(item.data);
        else issues.push(...zodIssues(at, item.error));
      });
      if (issues.length) throw new ConfirmError(issues);
      result = { type: 'item', items, createdKinds };
      return { ...state, kinds, items: [...state.items, ...items] };
    }

    if (proposal.type === 'notice') {
      const notices: Notice[] = [];
      proposal.notices.forEach((draft, i) => {
        const at = `notices[${i}]`;
        if (draft.courseId !== null && !courseIds.has(draft.courseId)) issues.push(`${at}.courseId: no such course`);
        const notice = NoticeSchema.safeParse({ ...draft, id: newId() });
        if (notice.success) notices.push(notice.data);
        else issues.push(...zodIssues(at, notice.error));
      });
      if (issues.length) throw new ConfirmError(issues);
      result = { type: 'notice', notices };
      return { ...state, notices: [...state.notices, ...notices] };
    }

    // Routine: a new routine REPLACES the whole old one (never merges), and
    // only after the user confirmed that. Courses are upserted by id and never
    // removed, because items and notices may still reference them.
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
