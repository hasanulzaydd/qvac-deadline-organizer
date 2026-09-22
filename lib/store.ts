import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { DATE_ONLY_TIME, FIXED_KINDS, LEGACY_KIND_MAP, isDateOnly } from './kinds';
import { toLocalIso } from './time';
import { AppStateSchema, type AppState, type Kind } from './schema';

/**
 * data.json is the app's entire database. Two guarantees:
 *
 * 1. Atomic writes — the new state goes to a temp file in the same directory,
 *    is fsynced, then renamed over data.json. A crash mid-write leaves either
 *    the old file or the new one, never a half-written mix.
 * 2. Serialised access — every read and write runs through one promise queue,
 *    so concurrent requests cannot interleave a read-modify-write and lose an
 *    update, and two first-run requests cannot both seed.
 *
 * A file that exists but fails to parse is never overwritten: that is the
 * user's data, and silently replacing it with seed defaults would destroy it.
 */

// data.json is runtime user data, not a build input: the ignore comment stops
// Turbopack's file tracer from bundling the whole project because of it.
export const DATA_FILE = path.resolve(
  /*turbopackIgnore: true*/ process.env.DATA_FILE ??
    path.join(process.cwd(), 'data.json'),
);

export class StoreCorruptError extends Error {
  constructor(detail: string) {
    super(`${DATA_FILE} is unreadable and was left untouched: ${detail}`);
    this.name = 'StoreCorruptError';
  }
}

export function newId(): string {
  return randomUUID();
}

function seedState(): AppState {
  return {
    version: 1,
    kinds: FIXED_KINDS.map(({ name, mode, color }) => ({ id: newId(), name, mode, color })),
    courses: [],
    items: [],
    routine: [],
  };
}

/**
 * Brings an older data file to exactly the three fixed kinds. A kind whose
 * name already matches keeps its id (so its items need no change); any other
 * kind's items move to the fixed kind it maps to, and that kind is dropped.
 * Returns null when the file is already up to date.
 */
function migrateKinds(state: AppState): AppState | null {
  const byName = new Map(state.kinds.map((k) => [k.name.trim().toLowerCase(), k]));
  const kinds: Kind[] = FIXED_KINDS.map(({ name, mode, color }) => ({
    id: byName.get(name.toLowerCase())?.id ?? newId(),
    name,
    mode,
    color,
  }));
  const idByName = new Map(kinds.map((k) => [k.name, k.id]));
  const remap = new Map<string, string>();
  for (const old of state.kinds) {
    const target = LEGACY_KIND_MAP[old.name.trim().toLowerCase()] ?? 'Assignment';
    remap.set(old.id, idByName.get(target)!);
  }
  const next: AppState = {
    ...state,
    kinds,
    items: state.items.map((i) => ({ ...i, kindId: remap.get(i.kindId) ?? i.kindId })),
  };
  return JSON.stringify(next) === JSON.stringify(state) ? null : next;
}

/**
 * Quizzes are date-only. Items saved before that rule may carry a time; move
 * them to the end of their calendar day. Returns null when nothing changes.
 */
function migrateDateOnly(state: AppState): AppState | null {
  const dateOnlyIds = new Set(state.kinds.filter((k) => isDateOnly(k)).map((k) => k.id));
  let changed = false;
  const items = state.items.map((i) => {
    if (!dateOnlyIds.has(i.kindId)) return i;
    const dueAt = toLocalIso(i.dueAt.slice(0, 10), DATE_ONLY_TIME);
    if (dueAt === i.dueAt) return i;
    changed = true;
    return { ...i, dueAt };
  });
  return changed ? { ...state, items } : null;
}

/**
 * A class whose room just repeats its course's room stores "" instead, so it
 * follows the course when the room is corrected. Returns null when unchanged.
 */
function migrateSlotRooms(state: AppState): AppState | null {
  const roomOf = new Map(state.courses.map((c) => [c.id, c.room]));
  let changed = false;
  const routine = state.routine.map((s) => {
    if (!s.room || s.room !== roomOf.get(s.courseId)) return s;
    changed = true;
    return { ...s, room: '' };
  });
  return changed ? { ...state, routine } : null;
}

/** Applied in order on every load; each returns null when it has nothing to do. */
const MIGRATIONS: ReadonlyArray<[string, (s: AppState) => AppState | null]> = [
  ['fixed kinds', migrateKinds],
  ['date-only quizzes', migrateDateOnly],
  ['class rooms follow their course', migrateSlotRooms],
];

// The queue lives on globalThis so a hot reload in dev does not create a
// second, independent queue racing the first against the same file.
const globalWithStore = globalThis as typeof globalThis & {
  __storeQueue?: Promise<unknown>;
  __storeSwept?: boolean;
};

function serialise<T>(task: () => Promise<T>): Promise<T> {
  const prev = globalWithStore.__storeQueue ?? Promise.resolve();
  const run = prev.then(task, task);
  // Keep the chain alive after a failure; the caller still sees the rejection.
  globalWithStore.__storeQueue = run.catch(() => {});
  return run;
}

function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}

async function readFromDisk(): Promise<AppState | null> {
  let raw: string;
  try {
    raw = await fs.readFile(DATA_FILE, 'utf8');
  } catch (err) {
    if (isErrnoException(err) && err.code === 'ENOENT') return null;
    throw err;
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new StoreCorruptError(
      `invalid JSON (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  const parsed = AppStateSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new StoreCorruptError(`schema mismatch — ${issues}`);
  }
  return parsed.data;
}

/**
 * On Windows, rename onto a file another process briefly holds open (an
 * editor, antivirus, the indexer) fails with EPERM/EBUSY. Those clear in
 * milliseconds, so retry a few times before giving up.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const transient =
        isErrnoException(err) &&
        (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES');
      if (!transient || attempt >= 5) throw err;
      await new Promise((r) => setTimeout(r, 20 * 2 ** attempt));
    }
  }
}

async function writeToDisk(state: AppState): Promise<AppState> {
  // Validate before touching the disk: nothing invalid ever reaches data.json.
  const valid = AppStateSchema.parse(state);

  const dir = path.dirname(DATA_FILE);
  await fs.mkdir(dir, { recursive: true });

  // Same directory as the target so the rename never crosses a filesystem.
  const tmp = path.join(
    dir,
    `.${path.basename(DATA_FILE)}.${process.pid}.${newId()}.tmp`,
  );

  try {
    const handle = await fs.open(tmp, 'wx');
    try {
      await handle.writeFile(JSON.stringify(valid, null, 2) + '\n', 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await renameWithRetry(tmp, DATA_FILE);
    return valid;
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but belongs to someone else.
    return isErrnoException(err) && err.code === 'EPERM';
  }
}

/**
 * A crash mid-write leaves its temp file behind (data.json itself is fine).
 * Remove temp files whose writer process is gone; never touch a live one's.
 */
async function removeOrphanedTempFiles(): Promise<void> {
  const dir = path.dirname(DATA_FILE);
  const prefix = `.${path.basename(DATA_FILE)}.`;
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(prefix) || !name.endsWith('.tmp')) continue;
    const pid = Number(name.slice(prefix.length).split('.')[0]);
    if (!Number.isInteger(pid) || pid === process.pid || isProcessAlive(pid)) continue;
    await fs.rm(path.join(dir, name), { force: true }).catch(() => {});
  }
}

/** Read state, seeding the default kinds if data.json does not exist yet. */
async function loadOrSeed(): Promise<AppState> {
  if (!globalWithStore.__storeSwept) {
    globalWithStore.__storeSwept = true;
    await removeOrphanedTempFiles();
  }

  const existing = await readFromDisk();
  if (existing) {
    let state = existing;
    const applied: string[] = [];
    for (const [name, migrate] of MIGRATIONS) {
      const next = migrate(state);
      if (next) {
        state = next;
        applied.push(name);
      }
    }
    if (!applied.length) return existing;
    console.log(`[store] migrated ${DATA_FILE}: ${applied.join(', ')}`);
    return writeToDisk(state);
  }

  const seeded = await writeToDisk(seedState());
  console.log(`[store] created ${DATA_FILE} with ${seeded.kinds.length} default kinds`);
  return seeded;
}

export function readState(): Promise<AppState> {
  return serialise(loadOrSeed);
}

/**
 * Read-modify-write under the queue. `mutate` receives the current state and
 * returns the next one; the result is validated and written atomically.
 */
export function updateState(
  mutate: (state: AppState) => AppState | Promise<AppState>,
): Promise<AppState> {
  return serialise(async () => {
    const next = await mutate(await loadOrSeed());
    return writeToDisk(next);
  });
}
