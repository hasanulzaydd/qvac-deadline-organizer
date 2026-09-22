import { z } from 'zod';

/**
 * Zod schemas are the single source of truth: every TypeScript type below is
 * inferred from its schema, so the runtime check and the static type cannot
 * drift apart. AI output and data.json are both parsed through these.
 */

const id = z.uuid();

/** Full ISO-8601 timestamp with an explicit offset or Z — never a bare date. */
const isoTimestamp = z.iso.datetime({ offset: true });

/** 24-hour wall-clock time, "08:00". */
const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM (24-hour)');

export const KindSchema = z.object({
  id,
  name: z.string().trim().min(1),
  /** Affects wording only: "due" (submit) vs "at" (attend). */
  mode: z.enum(['submit', 'attend']),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #rrggbb'),
});

export const CourseSchema = z.object({
  id,
  code: z.string().trim().min(1),
  title: z.string(),
  section: z.string(),
  faculty: z.string(),
  room: z.string(),
  isLab: z.boolean(),
});

/** One type for assignments, quizzes, midterms, finals — the kind tells them apart. */
export const ItemSchema = z.object({
  id,
  /** References Kind.id, never the name, so renaming a kind orphans nothing. */
  kindId: id,
  courseId: id.nullable(),
  title: z.string().trim().min(1),
  dueAt: isoTimestamp,
  syllabus: z.string(),
  instructions: z.string(),
  /** Raw OCR/pasted text, always kept so a misread can be checked later. */
  sourceText: z.string(),
  status: z.enum(['pending', 'done']),
  createdAt: isoTimestamp,
});

/** Announcements with no deadline: class cancelled, room changed. */
export const NoticeSchema = z.object({
  id,
  text: z.string().trim().min(1),
  courseId: id.nullable(),
  postedAt: isoTimestamp,
  sourceText: z.string(),
});

export const RoutineSlotSchema = z
  .object({
    id,
    courseId: id,
    /** 0 = Sunday … 6 = Saturday, matching Date#getDay. */
    day: z.int().min(0).max(6),
    startTime: clockTime,
    endTime: clockTime,
    room: z.string(),
  })
  // Zero-padded HH:MM compares correctly as a string.
  .refine((s) => s.startTime < s.endTime, {
    message: 'startTime must be before endTime',
    path: ['endTime'],
  });

/** The whole of data.json. */
export const AppStateSchema = z.object({
  version: z.literal(1),
  kinds: z.array(KindSchema),
  courses: z.array(CourseSchema),
  items: z.array(ItemSchema),
  notices: z.array(NoticeSchema),
  routine: z.array(RoutineSlotSchema),
});

export type Kind = z.infer<typeof KindSchema>;
export type KindMode = Kind['mode'];
export type Course = z.infer<typeof CourseSchema>;
export type Item = z.infer<typeof ItemSchema>;
export type ItemStatus = Item['status'];
export type Notice = z.infer<typeof NoticeSchema>;
export type RoutineSlot = z.infer<typeof RoutineSlotSchema>;
export type AppState = z.infer<typeof AppStateSchema>;
