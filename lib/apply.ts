import { ChangeSchema, kindNameKey, type Change } from './change';
import { normaliseCode } from './proposal';
import { CourseSchema, KindSchema, type AppState } from './schema';
import { newId, updateState } from './store';

/**
 * Applies one user-approved change atomically. Throws ApplyError with an HTTP
 * status and a message the UI can show; nothing is written on error.
 */

export class ApplyError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Extra detail for the UI, e.g. how many items still use a kind. */
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApplyError';
  }
}

function assertUniqueKindName(state: AppState, name: string, exceptId?: string) {
  const key = kindNameKey(name);
  const clash = state.kinds.find((k) => k.id !== exceptId && kindNameKey(k.name) === key);
  if (clash) throw new ApplyError(409, `a kind named "${clash.name}" already exists`);
}

function mutate(state: AppState, change: Change): AppState {
  switch (change.type) {
    case 'kind.create': {
      assertUniqueKindName(state, change.kind.name);
      const kind = KindSchema.parse({ id: newId(), ...change.kind, name: change.kind.name.trim() });
      return { ...state, kinds: [...state.kinds, kind] };
    }

    case 'kind.update': {
      const current = state.kinds.find((k) => k.id === change.id);
      if (!current) throw new ApplyError(404, 'no such kind');
      if (change.patch.name !== undefined) assertUniqueKindName(state, change.patch.name, change.id);
      const next = KindSchema.parse({ ...current, ...change.patch });
      return { ...state, kinds: state.kinds.map((k) => (k.id === change.id ? next : k)) };
    }

    case 'kind.delete': {
      if (!state.kinds.some((k) => k.id === change.id)) throw new ApplyError(404, 'no such kind');
      const used = state.items.filter((i) => i.kindId === change.id);
      const kinds = state.kinds.filter((k) => k.id !== change.id);

      if (used.length === 0) return { ...state, kinds };
      if (!change.items) {
        throw new ApplyError(409, `${used.length} item(s) use this kind — reassign or delete them`, {
          itemCount: used.length,
        });
      }
      if (change.items.action === 'delete') {
        return { ...state, kinds, items: state.items.filter((i) => i.kindId !== change.id) };
      }
      const target = change.items.toKindId;
      if (target === change.id || !kinds.some((k) => k.id === target)) {
        throw new ApplyError(400, 'reassign target must be another existing kind');
      }
      return {
        ...state,
        kinds,
        items: state.items.map((i) => (i.kindId === change.id ? { ...i, kindId: target } : i)),
      };
    }

    case 'course.update': {
      const current = state.courses.find((c) => c.id === change.id);
      if (!current) throw new ApplyError(404, 'no such course');
      const next = CourseSchema.parse({ ...current, ...change.patch });
      const clash = state.courses.find(
        (c) => c.id !== change.id && normaliseCode(c.code) === normaliseCode(next.code),
      );
      if (clash) throw new ApplyError(409, `another course already has the code "${clash.code}"`);
      // Slots copy the course's room at ingest. When the user corrects the
      // room (typically an OCR misread), carry the fix to slots that still
      // hold the old value; a slot deliberately in another room is left alone.
      const roomFixed = next.room !== current.room;
      return {
        ...state,
        courses: state.courses.map((c) => (c.id === change.id ? next : c)),
        routine: roomFixed
          ? state.routine.map((s) =>
              s.courseId === change.id && s.room === current.room ? { ...s, room: next.room } : s,
            )
          : state.routine,
      };
    }

    case 'item.setStatus': {
      if (!state.items.some((i) => i.id === change.id)) throw new ApplyError(404, 'no such item');
      return {
        ...state,
        items: state.items.map((i) => (i.id === change.id ? { ...i, status: change.status } : i)),
      };
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
