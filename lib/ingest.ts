import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { completion, ocr } from '@qvac/sdk';
import { z } from 'zod';
import { modelText, parseTimeRange, parseTimetable, readingOrderText, type Timetable } from './layout';
import { getQvac } from './qvac';
import { normaliseCode, type Proposal } from './proposal';
import type { AppState, Course, Kind } from './schema';
import { DATE_ONLY_TIME, fixedKind, isDateOnly } from './kinds';
import { newId } from './store';
import { DAY_NAMES, localDate, toLocalIso } from './time';

/**
 * Ingest pipeline: screenshot → OCR → classify (routine, or quiz/assignment/
 * exam) → extract → validate → proposal.
 * Nothing here writes to data.json; /api/confirm is the only writer.
 *
 * Reliability rules baked in:
 * - The model never sees or emits uuids. It picks kind NAMES from a
 *   grammar-enforced enum of the user's current kinds (or null) and writes
 *   course CODES; the server maps both to ids. Inventing a kind is
 *   impossible, not merely discouraged.
 * - Dates come back as YYYY-MM-DD plus HH:MM. The server builds the ISO
 *   timestamp in local time — small models get UTC offsets wrong.
 * - Deterministic checks the model cannot fake (year present in the source
 *   text, date in the past, missing time) become warnings on the proposal.
 */

export type IngestType = 'routine' | 'item' | 'unknown';

const NOTHING_FOUND = 'No quiz, assignment, exam or class routine was found in this screenshot.';

export type IngestTimings = { ocrMs?: number; classifyMs: number; extractMs?: number };

export type IngestResult =
  | {
      ok: true;
      type: Exclude<IngestType, 'unknown'>;
      sourceText: string;
      proposal: Proposal;
      warnings: string[];
      attempts: number;
      timings: IngestTimings;
    }
  | {
      ok: false;
      type: IngestType;
      sourceText: string;
      error: string;
      /** The model's last raw output, so a failure can be inspected. */
      rawOutput?: string;
      attempts: number;
      timings: IngestTimings;
    };

// ---------------------------------------------------------------------------
// OCR
// ---------------------------------------------------------------------------

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.bmp', '.webp']);

/**
 * Save the upload to a temp file, run QVAC `ocr` on it, always delete it.
 * Returns the faithful reading-order text (stored as sourceText) and the
 * layout-rebuilt, OCR-corrected text the model reads.
 */
export async function ocrImage(
  file: File,
): Promise<{ sourceText: string; modelText: string; timetable: Timetable | null; ms: number }> {
  const ext = path.extname(file.name).toLowerCase();
  const tmp = path.join(
    os.tmpdir(),
    `qvac-ingest-${randomUUID()}${IMAGE_EXTENSIONS.has(ext) ? ext : '.png'}`,
  );
  const startedAt = Date.now();
  await fs.writeFile(tmp, Buffer.from(await file.arrayBuffer()));
  try {
    const { ocrModelId } = await getQvac();
    const { blocks } = ocr({ modelId: ocrModelId, image: tmp });
    const result = await blocks;
    return {
      sourceText: readingOrderText(result),
      modelText: modelText(result),
      timetable: parseTimetable(result),
      ms: Date.now() - startedAt,
    };
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Completion with grammar-constrained JSON + one validated retry
// ---------------------------------------------------------------------------

type JsonRun<T> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; error: string; rawOutput?: string; attempts: number };

const OCR_NOTE =
  'The text comes from OCR of a screenshot. Cells on the same visual row are ' +
  'separated by " | "; a timetable is rebuilt as rows of time slots with one ' +
  '"DAY:" line per class. OCR often reads a colon in a time as a period ' +
  '("11.59 PM" means 11:59 PM) and may drop dashes or split words.';

function todayLine(now: Date): string {
  const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
  return `Today is ${weekday}, ${localDate(now)}.`;
}

/**
 * Calls QVAC `completion` with the Zod schema compiled to a JSON-schema
 * grammar, then validates with the same Zod schema (which also enforces the
 * refinements a grammar cannot express, like real calendar dates). On a
 * validation failure, retries ONCE with the errors appended to the prompt.
 */
async function completeJson<T>(
  schema: z.ZodType<T>,
  system: string,
  user: string,
  maxTokens: number,
): Promise<JsonRun<T>> {
  const { llmModelId } = await getQvac();
  const jsonSchema = z.toJSONSchema(schema, { target: 'draft-7', io: 'output' });

  let prompt = user;
  let lastRaw: string | undefined;
  let lastError = '';

  for (let attempt = 1; attempt <= 2; attempt++) {
    const run = completion({
      modelId: llmModelId,
      history: [
        // Qwen3 is a hybrid reasoning model; /no_think skips the <think> phase.
        { role: 'system', content: `${system} /no_think` },
        { role: 'user', content: prompt },
      ],
      stream: false,
      responseFormat: {
        type: 'json_schema',
        json_schema: { name: 'extraction', schema: jsonSchema },
      },
      generationParams: { temp: 0, predict: maxTokens },
    });
    const final = await run.final;
    lastRaw = final.contentText.trim();
    const s = final.stats;
    console.log(
      `[ingest] completion: ${s?.promptTokens ?? '?'} prompt tok @ ${s?.promptTokensPerSecond?.toFixed(0) ?? '?'}/s, ` +
        `${s?.generatedTokens ?? '?'} gen tok @ ${s?.tokensPerSecond?.toFixed(1) ?? '?'}/s, stop=${final.stopReason ?? '?'}`,
    );

    // Non-streaming runs leave stopReason undefined, so also treat hitting
    // the token budget as truncation.
    if (final.stopReason === 'length' || (s?.generatedTokens ?? 0) >= maxTokens) {
      // Retrying the same input would be cut off at the same place.
      return {
        ok: false,
        attempts: attempt,
        rawOutput: lastRaw,
        error: `model output was cut off at ${maxTokens} tokens (stopReason "length") — the screenshot likely has more content than fits in one pass`,
      };
    }

    let json: unknown;
    try {
      json = JSON.parse(lastRaw);
    } catch (err) {
      lastError = `output is not valid JSON: ${err instanceof Error ? err.message : String(err)}`;
      json = undefined;
    }

    if (json !== undefined) {
      const parsed = schema.safeParse(json);
      if (parsed.success) return { ok: true, value: parsed.data, attempts: attempt };
      lastError = parsed.error.issues
        .slice(0, 8)
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ');
    }

    console.warn(`[ingest] attempt ${attempt} failed validation: ${lastError}`);
    prompt =
      `${user}\n\nYour previous answer was:\n${lastRaw}\n\n` +
      `It failed validation with these errors:\n${lastError}\n` +
      'Return corrected JSON only.';
  }

  return { ok: false, attempts: 2, rawOutput: lastRaw, error: `validation failed twice: ${lastError}` };
}

// ---------------------------------------------------------------------------
// Step 2: classify
// ---------------------------------------------------------------------------

const ClassifySchema = z.object({
  type: z.enum(['routine', 'item', 'unknown']),
});

const CLASSIFY_SYSTEM = `You sort university screenshots into exactly one category.
- "routine": a weekly class timetable — recurring classes laid out by day of the week and time.
- "item": the screenshot announces at least one quiz, assignment or exam with a date (assignments include homework, lab reports and projects; exams include midterms and finals).
- "unknown": anything else — general announcements, lecture notes, class cancellations — or unreadable.
If a post mixes a quiz, assignment or exam with other news, choose "item".`;

async function classify(text: string, now: Date) {
  return completeJson(
    ClassifySchema,
    CLASSIFY_SYSTEM,
    `${todayLine(now)}\n${OCR_NOTE}\n\nText:\n"""\n${text}\n"""\n\nReturn {"type": ...}.`,
    32,
  );
}

// ---------------------------------------------------------------------------
// Step 3: extract — shapes the model fills (names/codes, never ids)
// ---------------------------------------------------------------------------

// Keep grammar patterns simple: llama.cpp's JSON-schema→grammar converter
// fails ("failed to parse grammar") on `\d` and on the regex Zod emits for
// z.iso.date(); `[0-9]{n}` works. The grammar enforces the shape; the
// refinements (invisible to the grammar, enforced by Zod afterwards and fed
// to the retry) enforce real values.
const clock = z
  .string()
  .regex(/^[0-9]{2}:[0-9]{2}$/)
  .refine((t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t), 'not a valid 24-hour time');
const calendarDate = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)
  .refine((d) => {
    const [y, m, day] = d.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, day));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day;
  }, 'not a real calendar date');
const DAYS = DAY_NAMES;

function itemExtractSchema(kinds: Kind[]) {
  const names = kinds.map((k) => k.name);
  // An enum of the user's CURRENT kind names, or null. The grammar makes any
  // other string unrepresentable.
  const kind =
    names.length > 0 ? z.enum(names as [string, ...string[]]).nullable() : z.null();
  return z.object({
    items: z
      .array(
        z.object({
          title: z.string().min(1),
          kind,
          courseCode: z.string().nullable(),
          date: calendarDate.nullable(),
          time: clock.nullable(),
          syllabus: z.string(),
        }),
      )
      // May be empty: grammar-constrained output must satisfy the schema, so
      // requiring an entry would force the model to invent one.
      .max(20),
  });
}

const RoutineExtractSchema = z.object({
  courses: z
    .array(
      z.object({
        code: z.string().min(1),
        title: z.string(),
        section: z.string(),
        faculty: z.string(),
        room: z.string(),
        isLab: z.boolean(),
      }),
    )
    .min(1),
  slots: z
    .array(
      z
        .object({
          courseCode: z.string().min(1),
          day: z.enum(DAYS),
          startTime: clock,
          endTime: clock,
          room: z.string(),
        })
        .refine((s) => s.startTime < s.endTime, {
          message: 'startTime must be before endTime (use 24-hour HH:MM)',
          path: ['endTime'],
        }),
    )
    .min(1),
});

function coursesLine(courses: Course[]): string {
  return courses.length
    ? `Known courses: ${courses.map((c) => `${c.code}${c.title ? ` (${c.title})` : ''}`).join(', ')}. Use these exact codes when they match.`
    : 'No courses are saved yet.';
}

function itemPrompt(kinds: Kind[], courses: Course[], text: string, now: Date) {
  const kindList = kinds.map((k) => `- ${k.name}: ${fixedKind(k.name)?.covers ?? k.name}`).join('\n');
  return {
    system: `You extract quizzes, assignments and exams from university screenshots into JSON.
One entry per distinct quiz, assignment or exam that has a date. Skip everything else — lecture notes, topic lists, general news. If there is none, return an empty "items" list.
- "kind": one of the listed kinds ONLY. If none fits, use null. Never invent a kind.
- "courseCode": the course code the entry belongs to (e.g. "CSE 3103"), or null. A course named in a page header applies to every entry under it.
- "date": YYYY-MM-DD — the submission deadline ("Due: ...") OR the scheduled date of a quiz/exam ("On: ...", "at ..."). If the year is not written, use the year that puts the date closest to today. null if no date is given.
- "time": 24-hour HH:MM of that deadline or start time (5:00 PM → 17:00, 11:59 PM → 23:59). null if no time is given.
- "syllabus": chapters/topics covered, else "".
Copy facts from the text only. Do not guess missing values — use null or "".`,
    user: `${todayLine(now)}\n${OCR_NOTE}\n\nKinds:\n${kindList || '(none)'}\n\n${coursesLine(courses)}\n\nText:\n"""\n${text}\n"""`,
  };
}

const RoutineCoursesSchema = RoutineExtractSchema.pick({ courses: true });

function routineCoursesPrompt(text: string, now: Date) {
  return {
    system: `You list the courses in a weekly class routine (timetable) from a university screenshot, as JSON.
- One entry per distinct course code. A lab (code ending in "L", or marked lab) is its own course with isLab true.
- code: exactly as written in the class cells (e.g. "CSE260L"); title: the course name if shown, else "".
- section, faculty, room: read them from the class cells, which are often written as CODE-SECTION-FACULTY-ROOM (e.g. "ECO101 -21 -AYSH -09G-30C" → section "21", faculty "AYSH", room "09G-30C"). Use "" for anything not shown.
Copy facts from the text only.`,
    user: `${todayLine(now)}\n${OCR_NOTE}\n\nText:\n"""\n${text}\n"""`,
  };
}

/**
 * Slots straight from the rebuilt grid: day from the column, time from the
 * row (parsed in code), course matched by the code at the start of the cell.
 * Anything that cannot be matched becomes a warning, never a silent drop.
 */
function slotsFromGrid(
  grid: Timetable,
  courses: { code: string; room: string }[],
  warnings: string[],
): z.infer<typeof RoutineExtractSchema>['slots'] {
  // Longest code first, so "CSE260L" is tried before "CSE260".
  const byLength = [...courses].sort((a, b) => normaliseCode(b.code).length - normaliseCode(a.code).length);
  const slots: z.infer<typeof RoutineExtractSchema>['slots'] = [];
  for (const row of grid.rows) {
    const range = parseTimeRange(row.time);
    for (const cell of row.classes) {
      const where = `${cell.dayName} ${row.time}`;
      if (!range) {
        warnings.push(`${where}: could not read the time range "${row.time}" — class "${cell.text}" skipped`);
        continue;
      }
      const cellKey = normaliseCode(cell.text.split(/\s/)[0] ?? '');
      const course =
        byLength.find((c) => normaliseCode(c.code) === cellKey) ??
        byLength.find((c) => normaliseCode(cell.text).startsWith(normaliseCode(c.code)));
      if (!course) {
        warnings.push(`${where}: class "${cell.text}" did not match any extracted course — skipped`);
        continue;
      }
      slots.push({
        courseCode: course.code,
        day: DAYS[cell.day],
        startTime: range.start,
        endTime: range.end,
        // Empty = "the course's room". Copying it here would leave a stale
        // duplicate when the user corrects the course's room before saving.
        room: '',
      });
    }
  }
  return slots;
}

function routinePrompt(text: string, now: Date) {
  return {
    system: `You extract a weekly class routine (timetable) from a university screenshot into JSON.
- "courses": one entry per distinct course: code (e.g. "CSE 3103"), title, section, faculty, room, isLab (true for lab sessions/courses). Use "" for anything not shown.
- "slots": one entry per weekly class meeting: courseCode (must match a course above), day (full English weekday), startTime and endTime as 24-hour HH:MM, room ("" if not shown).
Convert 12-hour times to 24-hour: 1:00 PM → 13:00. In a routine, an afternoon class written as "1:00" or "2:30" without AM/PM is 13:00 / 14:30.
Include every class meeting you can see. Copy facts from the text only.`,
    user: `${todayLine(now)}\n${OCR_NOTE}\n\nText:\n"""\n${text}\n"""`,
  };
}

// ---------------------------------------------------------------------------
// Step 5: map model output → proposal (ids, local timestamps, warnings)
// ---------------------------------------------------------------------------

function findCourse(courses: Course[], code: string | null): Course | undefined {
  if (!code) return undefined;
  const key = normaliseCode(code);
  return courses.find((c) => normaliseCode(c.code) === key);
}

const MIDNIGHT = /\b(12[:.]00\s*a\.?m|00[:.]00|midnight)\b/i;

function itemsToProposal(
  out: z.infer<ReturnType<typeof itemExtractSchema>>,
  state: AppState,
  sourceText: string,
  now: Date,
  warnings: string[],
): Proposal {
  const today = localDate(now);
  const items = out.items.map((it, i) => {
    const at = `items[${i}] "${it.title}"`;
    const kind = it.kind ? state.kinds.find((k) => k.name === it.kind) : undefined;
    if (!kind) {
      warnings.push(`${at}: no matching kind — choose one before saving`);
    } else if (!(fixedKind(kind.name)?.evidence ?? new RegExp(kind.name, 'i')).test(sourceText)) {
      // Nothing in the text supports this kind (no "quiz", "midterm",
      // "assignment"...). Could be a fair inference, could be invented.
      warnings.push(`${at}: nothing in the text says this is a ${kind.name.toLowerCase()} — check this entry is real`);
    }

    const course = findCourse(state.courses, it.courseCode);
    if (it.courseCode && !course) {
      warnings.push(`${at}: course "${it.courseCode}" is not saved yet — left unlinked`);
    }

    let dueAt: string | null = null;
    if (!it.date) {
      warnings.push(`${at}: no date found — set it before saving`);
    } else if (isDateOnly(kind)) {
      // Quizzes are tracked by date only; any time the model read is dropped.
      dueAt = toLocalIso(it.date, DATE_ONLY_TIME);
    } else {
      // Small models fill a missing time with "00:00" instead of null. Treat
      // midnight as missing unless the text actually says midnight.
      let time = it.time;
      if (time === '00:00' && !MIDNIGHT.test(sourceText)) time = null;
      if (!time) {
        warnings.push(`${at}: no time in the text — assumed 23:59, check it`);
      }
      dueAt = toLocalIso(it.date, time ?? '23:59');
    }
    if (it.date) {
      const year = it.date.slice(0, 4);
      if (!sourceText.includes(year)) {
        warnings.push(`${at}: year ${year} is not in the text — it was inferred`);
      }
      if (it.date < today) warnings.push(`${at}: the date ${it.date} is in the past`);
    }

    return {
      kindId: kind?.id ?? null,
      courseId: course?.id ?? null,
      title: it.title,
      dueAt,
      syllabus: it.syllabus,
      sourceText,
    };
  });
  return { type: 'item', items };
}

function routineToProposal(
  out: z.infer<typeof RoutineExtractSchema>,
  state: AppState,
  warnings: string[],
): Proposal {
  // Reuse a saved course's id when the code matches, so confirming updates
  // it instead of creating a duplicate.
  const courses: Course[] = [];
  const byCode = new Map<string, Course>();
  const addCourse = (c: Omit<Course, 'id'>) => {
    const key = normaliseCode(c.code);
    const existing = byCode.get(key);
    if (existing) return existing;
    const saved = findCourse(state.courses, c.code);
    const course = { ...c, id: saved?.id ?? newId() };
    byCode.set(key, course);
    courses.push(course);
    return course;
  };

  for (const c of out.courses) {
    // Small models fill a missing title with the code itself; that is "no title".
    addCourse(normaliseCode(c.title) === normaliseCode(c.code) ? { ...c, title: '' } : c);
  }

  const slots = out.slots.map((s, i) => {
    let course = byCode.get(normaliseCode(s.courseCode));
    if (!course) {
      warnings.push(`slots[${i}]: course "${s.courseCode}" was not in the course list — added with blank details`);
      course = addCourse({ code: s.courseCode, title: '', section: '', faculty: '', room: s.room, isLab: false });
    }
    if (s.startTime < '07:00') {
      warnings.push(`slots[${i}] ${s.courseCode} ${s.day} starts at ${s.startTime} — likely a PM time read as AM`);
    }
    return {
      id: newId(),
      courseId: course.id,
      day: DAYS.indexOf(s.day),
      startTime: s.startTime,
      endTime: s.endTime,
      room: s.room,
    };
  });

  // Saving updates a matching saved course with what this screenshot says.
  // Name every field that would change, so a fix the user made earlier (say,
  // a room OCR misread) is never silently overwritten by the same misread.
  for (const c of courses) {
    const saved = findCourse(state.courses, c.code);
    if (!saved) continue;
    for (const field of ['title', 'section', 'faculty', 'room'] as const) {
      if (c[field] !== saved[field] && saved[field]) {
        warnings.push(
          `course ${c.code}: ${field} reads "${c[field]}" here but you saved "${saved[field]}" — saving will overwrite it`,
        );
      }
    }
    if (c.isLab !== saved.isLab) {
      warnings.push(`course ${c.code}: lab flag differs from your saved course — saving will overwrite it`);
    }
  }
  return { type: 'routine', courses, slots };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export async function runIngest(
  input: { sourceText: string; modelText: string; timetable: Timetable | null; ocrMs: number },
  state: AppState,
): Promise<IngestResult> {
  const now = new Date();
  const { sourceText } = input;
  // What the model reads: the layout-rebuilt, OCR-corrected text.
  const text = input.modelText;
  const timings: IngestTimings = { ocrMs: input.ocrMs, classifyMs: 0 };

  let t = Date.now();
  const cls = await classify(text, now);
  timings.classifyMs = Date.now() - t;
  if (!cls.ok) {
    return { ok: false, type: 'unknown', sourceText, error: `classification failed: ${cls.error}`, rawOutput: cls.rawOutput, attempts: cls.attempts, timings };
  }
  const type = cls.value.type;
  console.log(`[ingest] classified as "${type}" in ${timings.classifyMs}ms`);
  if (type === 'unknown') {
    return { ok: false, type, sourceText, error: NOTHING_FOUND, attempts: cls.attempts, timings };
  }

  const warnings: string[] = [];
  t = Date.now();

  let result: IngestResult;
  if (type === 'item') {
    const p = itemPrompt(state.kinds, state.courses, text, now);
    const run = await completeJson(itemExtractSchema(state.kinds), p.system, p.user, 1500);
    timings.extractMs = Date.now() - t;
    result = !run.ok
      ? { ok: false, type, sourceText, error: run.error, rawOutput: run.rawOutput, attempts: run.attempts, timings }
      : run.value.items.length === 0
        ? { ok: false, type, sourceText, error: NOTHING_FOUND, attempts: run.attempts, timings }
        : { ok: true, type, sourceText, proposal: itemsToProposal(run.value, state, sourceText, now, warnings), warnings, attempts: run.attempts, timings };
  } else {
    const grid = input.timetable?.rows.some((r) => r.classes.length) ? input.timetable : undefined;
    if (grid) {
      // The grid already fixes every slot's day (column) and time (row), so
      // the model only reads the course list; slots are built in code.
      const p = routineCoursesPrompt(text, now);
      const run = await completeJson(RoutineCoursesSchema, p.system, p.user, 1200);
      timings.extractMs = Date.now() - t;
      result = run.ok
        ? {
            ok: true, type, sourceText, warnings, attempts: run.attempts, timings,
            proposal: routineToProposal(
              { courses: run.value.courses, slots: slotsFromGrid(grid, run.value.courses, warnings) },
              state,
              warnings,
            ),
          }
        : { ok: false, type, sourceText, error: run.error, rawOutput: run.rawOutput, attempts: run.attempts, timings };
    } else {
      const p = routinePrompt(text, now);
      const run = await completeJson(RoutineExtractSchema, p.system, p.user, 2000);
      timings.extractMs = Date.now() - t;
      warnings.push('no timetable grid was detected — days and times were read by the model, check every slot');
      result = run.ok
        ? { ok: true, type, sourceText, proposal: routineToProposal(run.value, state, warnings), warnings, attempts: run.attempts, timings }
        : { ok: false, type, sourceText, error: run.error, rawOutput: run.rawOutput, attempts: run.attempts, timings };
    }
  }

  console.log(`[ingest] extracted "${type}" in ${timings.extractMs}ms (${result.attempts} attempt(s), ok=${result.ok})`);
  return result;
}
