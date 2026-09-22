'use client';

import type { Course, Kind, RoutineSlot } from '@/lib/schema';
import { DATE_ONLY_TIME, isDateOnly } from '@/lib/kinds';
import { DAY_NAMES, fromInputValue, toDateInputValue, toInputValue, toLocalIso } from '@/lib/time';
import { courseTitle } from '@/lib/view';
import { Card, inputClass } from './ui';

export type ItemCardDraft = {
  include: boolean;
  title: string;
  /** The chosen kind's id (Quiz, Assignment or Exam), or "" for none yet. */
  kindRef: string;
  courseId: string | null;
  dueAt: string | null;
  syllabus: string;
  sourceText: string;
};

function Label({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <span className={`mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500 ${className}`}>{children}</span>;
}

function Warnings({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <ul className="mt-3 space-y-1 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {warnings.map((w, i) => (
        <li key={i}>⚠ {w}</li>
      ))}
    </ul>
  );
}

/** Quiz, Assignment or Exam — the three fixed kinds. */
function KindSelect({ value, kinds, onChange }: { value: string; kinds: Kind[]; onChange: (kindId: string) => void }) {
  return (
    <select className={`${inputClass} ${value ? '' : 'border-red-300'}`} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose…</option>
      {kinds.map((k) => (
        <option key={k.id} value={k.id}>
          {k.name}
        </option>
      ))}
    </select>
  );
}

function CourseSelect({
  value,
  courses,
  onChange,
}: {
  value: string | null;
  courses: Course[];
  onChange: (id: string | null) => void;
}) {
  return (
    <select className={inputClass} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">No course</option>
      {[...courses]
        .sort((a, b) => a.code.localeCompare(b.code))
        .map((c) => (
          <option key={c.id} value={c.id}>
            {c.code}
            {courseTitle(c) ? ` — ${courseTitle(c)}` : ''}
          </option>
        ))}
    </select>
  );
}

/** What still blocks saving this draft, if anything. */
export function itemProblems(d: ItemCardDraft): string[] {
  const problems: string[] = [];
  if (!d.title.trim()) problems.push('a title');
  if (!d.kindRef) problems.push('a kind');
  if (!d.dueAt) problems.push('a date');
  return problems;
}

export function ItemCards({
  drafts,
  onChange,
  kinds,
  courses,
  warnings,
}: {
  drafts: ItemCardDraft[];
  onChange: (index: number, draft: ItemCardDraft) => void;
  kinds: Kind[];
  courses: Course[];
  warnings: Map<number, string[]>;
}) {
  return (
    <div className="space-y-4">
      {drafts.map((d, i) => {
        const set = (patch: Partial<ItemCardDraft>) => onChange(i, { ...d, ...patch });
        const kind = kinds.find((k) => k.id === d.kindRef);
        const dateOnly = isDateOnly(kind);
        const problems = itemProblems(d);
        return (
          <Card key={i} className={`p-4 ${d.include ? '' : 'opacity-50'}`}>
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                aria-label="Include this item"
                checked={d.include}
                onChange={(e) => set({ include: e.target.checked })}
                className="mt-2 h-4 w-4 rounded border-zinc-300"
              />
              <input
                aria-label="Title"
                className={`${inputClass} text-base font-medium`}
                value={d.title}
                onChange={(e) => set({ title: e.target.value })}
              />
            </div>
            {d.include && (
              <>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <label className="block">
                    <Label>Kind</Label>
                    <KindSelect
                      value={d.kindRef}
                      kinds={kinds}
                      onChange={(kindRef) => {
                        // Switching to a date-only kind (Quiz) drops the time at once.
                        const next = kinds.find((k) => k.id === kindRef);
                        const dueAt =
                          d.dueAt && isDateOnly(next) ? toLocalIso(toDateInputValue(d.dueAt), DATE_ONLY_TIME) : d.dueAt;
                        set({ kindRef, dueAt });
                      }}
                    />
                  </label>
                  <label className="block">
                    <Label>Course</Label>
                    <CourseSelect value={d.courseId} courses={courses} onChange={(courseId) => set({ courseId })} />
                  </label>
                  <label className="block">
                    <Label>{dateOnly ? 'Date' : kind?.mode === 'attend' ? 'At' : 'Due'}</Label>
                    {dateOnly ? (
                      <input
                        type="date"
                        className={`${inputClass} ${d.dueAt ? '' : 'border-red-300'}`}
                        value={toDateInputValue(d.dueAt)}
                        onChange={(e) =>
                          set({ dueAt: e.target.value ? toLocalIso(e.target.value, DATE_ONLY_TIME) : null })
                        }
                      />
                    ) : (
                      <input
                        type="datetime-local"
                        className={`${inputClass} ${d.dueAt ? '' : 'border-red-300'}`}
                        value={toInputValue(d.dueAt)}
                        onChange={(e) => set({ dueAt: fromInputValue(e.target.value) })}
                      />
                    )}
                  </label>
                </div>
                <label className="mt-3 block">
                  <Label>Syllabus / topics</Label>
                  <textarea
                    rows={2}
                    className={inputClass}
                    value={d.syllabus}
                    onChange={(e) => set({ syllabus: e.target.value })}
                  />
                </label>
                <Warnings warnings={warnings.get(i) ?? []} />
                {problems.length > 0 && (
                  <p className="mt-2 text-sm text-red-700">Needs {problems.join(', ')} before saving.</p>
                )}
              </>
            )}
          </Card>
        );
      })}
    </div>
  );
}

export function RoutineCards({
  courses,
  slots,
  onCourses,
  onSlots,
}: {
  courses: Course[];
  slots: RoutineSlot[];
  onCourses: (courses: Course[]) => void;
  onSlots: (slots: RoutineSlot[]) => void;
}) {
  const setCourse = (i: number, patch: Partial<Course>) => {
    const old = courses[i];
    onCourses(courses.map((c, j) => (j === i ? { ...c, ...patch } : c)));
    // A class that just repeated the course's room follows the course, so a
    // room fixed here is not left behind on its classes.
    if (patch.room !== undefined && old.room) {
      onSlots(slots.map((s) => (s.courseId === old.id && s.room === old.room ? { ...s, room: '' } : s)));
    }
  };
  const setSlot = (i: number, patch: Partial<RoutineSlot>) =>
    onSlots(slots.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  return (
    <div className="space-y-6">
      <Card className="overflow-x-auto">
        <div className="px-4 pt-3">
          <Label>Courses ({courses.length})</Label>
        </div>
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              {['Code', 'Title', 'Section', 'Faculty', 'Room', 'Lab'].map((h) => (
                <th key={h} className="px-2 py-2 font-medium first:pl-4">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {courses.map((c, i) => (
              <tr key={c.id} className="border-t border-zinc-100">
                {(['code', 'title', 'section', 'faculty', 'room'] as const).map((f) => (
                  <td key={f} className="px-2 py-1.5 first:pl-4">
                    <input
                      aria-label={f}
                      className={inputClass}
                      value={c[f]}
                      onChange={(e) => setCourse(i, { [f]: e.target.value })}
                    />
                  </td>
                ))}
                <td className="px-2 py-1.5 text-center">
                  <input
                    type="checkbox"
                    aria-label="Lab"
                    checked={c.isLab}
                    onChange={(e) => setCourse(i, { isLab: e.target.checked })}
                    className="h-4 w-4 rounded border-zinc-300"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="overflow-x-auto">
        <div className="px-4 pt-3">
          <Label>Weekly classes ({slots.length})</Label>
        </div>
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              {['Course', 'Day', 'Start', 'End', 'Room', ''].map((h, i) => (
                <th key={i} className="px-2 py-2 font-medium first:pl-4">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slots.map((s, i) => (
              <tr key={s.id} className="border-t border-zinc-100">
                <td className="px-2 py-1.5 pl-4">
                  <select
                    aria-label="Course"
                    className={inputClass}
                    value={s.courseId}
                    onChange={(e) => setSlot(i, { courseId: e.target.value })}
                  >
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code || '(no code)'}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <select
                    aria-label="Day"
                    className={inputClass}
                    value={s.day}
                    onChange={(e) => setSlot(i, { day: Number(e.target.value) })}
                  >
                    {DAY_NAMES.map((d, n) => (
                      <option key={d} value={n}>
                        {d}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="time"
                    aria-label="Start"
                    className={inputClass}
                    value={s.startTime}
                    onChange={(e) => setSlot(i, { startTime: e.target.value })}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    type="time"
                    aria-label="End"
                    className={`${inputClass} ${s.startTime < s.endTime ? '' : 'border-red-300'}`}
                    value={s.endTime}
                    onChange={(e) => setSlot(i, { endTime: e.target.value })}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input
                    aria-label="Room"
                    className={inputClass}
                    value={s.room}
                    // Empty means the course's room, shown greyed as a hint.
                    placeholder={courses.find((c) => c.id === s.courseId)?.room || ''}
                    onChange={(e) => setSlot(i, { room: e.target.value })}
                  />
                </td>
                <td className="px-2 py-1.5 pr-4 text-right">
                  <button
                    type="button"
                    onClick={() => onSlots(slots.filter((_, j) => j !== i))}
                    className="text-sm font-medium text-red-600 hover:text-red-500"
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
