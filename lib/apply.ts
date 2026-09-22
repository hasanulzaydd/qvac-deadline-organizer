import { ChangeSchema, type Change } from './change';
import type { AppState } from './schema';
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

function mutate(state: AppState, change: Change): AppState {
  switch (change.type) {
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
