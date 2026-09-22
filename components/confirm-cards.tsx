'use client';

import { useState } from 'react';
import { kindNameKey } from '@/lib/change';
import type { Course, Kind, KindMode, RoutineSlot } from '@/lib/schema';
import { DAY_NAMES, fromInputValue, toInputValue } from '@/lib/time';
import { KIND_COLORS, courseTitle } from '@/lib/view';
import { Card, buttonClass, inputClass } from './ui';

/** A kind the user created inside the confirm card; saved together with the items. */
export type PendingKind = { key: string; name: string; mode: KindMode; color: string };

export type ItemCardDraft = {
  include: boolean;
  title: string;
  /** An existing kind id, "new:<key>" for a pending kind, or "" for none yet. */
  kindRef: string;
  courseId: string | null;
  dueAt: string | null;
  syllabus: string;
  instructions: string;
  sourceText: string;
};

export type NoticeCardDraft = {
  include: boolean;
  text: string;
  courseId: string | null;
  postedAt: string;
  sourceText: string;
};

const NEW_KIND = '__new__';

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

/**
 * Kind picker for a confirm card. The last option, "+ Create new kind…",
 * opens an inline form; the new kind is saved in the same action as the item.
 */
function KindSelect({
  value,
  kinds,
  pending,
  onChange,
  onCreate,
}: {
  value: string;
  kinds: Kind[];
  pending: PendingKind[];
  onChange: (kindRef: string) => void;
  onCreate: (kind: Omit<PendingKind, 'key'>) => string;
}) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', mode: 'submit' as KindMode, color: KIND_COLORS[5] });
  const taken = new Set([...kinds.map((k) => kindNameKey(k.name)), ...pending.map((p) => kindNameKey(p.name))]);
  const duplicate = taken.has(kindNameKey(draft.name));

  if (creating) {
    return (
      <div className="space-y-2 rounded-md border border-indigo-200 bg-indigo-50/50 p-2">
        <div className="flex gap-2">
          <input
            type="color"
            aria-label="New kind colour"
            value={draft.color}
            onChange={(e) => setDraft({ ...draft, color: e.target.value })}
            className="h-8 w-8 shrink-0 cursor-pointer rounded border border-zinc-300 bg-white p-0.5"
          />
          <input
            autoFocus
            className={inputClass}
            placeholder="New kind name"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <select
          aria-label="New kind wording"
          className={inputClass}
          value={draft.mode}
          onChange={(e) => setDraft({ ...draft, mode: e.target.value as KindMode })}
        >
          <option value="submit">Submitted — “Due …”</option>
          <option value="attend">Attended — “At …”</option>
        </select>
        {duplicate && <p className="text-xs text-red-700">A kind with this name already exists — pick it from the list.</p>}
        <div className="flex gap-2">
          <button
            type="button"
            className={`${buttonClass.primary} py-1`}
            disabled={!draft.name.trim() || duplicate}
            onClick={() => {
              onChange(`new:${onCreate({ ...draft, name: draft.name.trim() })}`);
              setCreating(false);
              setDraft({ ...draft, name: '' });
            }}
          >
            Create
          </button>
          <button type="button" className={`${buttonClass.secondary} py-1`} onClick={() => setCreating(false)}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <select
      className={`${inputClass} ${value ? '' : 'border-red-300'}`}
      value={value}
      onChange={(e) => (e.target.value === NEW_KIND ? setCreating(true) : onChange(e.target.value))}
    >
      <option value="">Choose a kind…</option>
      {kinds.map((k) => (
        <option key={k.id} value={k.id}>
          {k.name}
        </option>
      ))}
      {pending.map((p) => (
        <option key={p.key} value={`new:${p.key}`}>
          {p.name} (new)
        </option>
      ))}
      <option value={NEW_KIND}>+ Create new kind…</option>
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
  if (!d.dueAt) problems.push('a date and time');
  return problems;
}

export function ItemCards({
  drafts,
  onChange,
  kinds,
  courses,
  pendingKinds,
  onCreateKind,
  warnings,
}: {
  drafts: ItemCardDraft[];
  onChange: (index: number, draft: ItemCardDraft) => void;
  kinds: Kind[];
  courses: Course[];
  pendingKinds: PendingKind[];
  onCreateKind: (kind: Omit<PendingKind, 'key'>) => string;
  warnings: Map<number, string[]>;
}) {
  return (
    <div className="space-y-4">
      {drafts.map((d, i) => {
        const set = (patch: Partial<ItemCardDraft>) => onChange(i, { ...d, ...patch });
        const mode = d.kindRef.startsWith('new:')
          ? pendingKinds.find((p) => `new:${p.key}` === d.kindRef)?.mode
          : kinds.find((k) => k.id === d.kindRef)?.mode;
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
                      pending={pendingKinds}
                      onChange={(kindRef) => set({ kindRef })}
                      onCreate={onCreateKind}
                    />
                  </label>
                  <label className="block">
                    <Label>Course</Label>
                    <CourseSelect value={d.courseId} courses={courses} onChange={(courseId) => set({ courseId })} />
                  </label>
                  <label className="block">
                    <Label>{mode === 'attend' ? 'At' : 'Due'}</Label>
                    <input
                      type="datetime-local"
                      className={`${inputClass} ${d.dueAt ? '' : 'border-red-300'}`}
                      value={toInputValue(d.dueAt)}
                      onChange={(e) => set({ dueAt: fromInputValue(e.target.value) })}
                    />
                  </label>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <Label>Syllabus / topics</Label>
                    <textarea
                      rows={2}
                      className={inputClass}
                      value={d.syllabus}
                      onChange={(e) => set({ syllabus: e.target.value })}
                    />
                  </label>
                  <label className="block">
                    <Label>Instructions</Label>
                    <textarea
                      rows={2}
                      className={inputClass}
                      value={d.instructions}
                      onChange={(e) => set({ instructions: e.target.value })}
                    />
                  </label>
                </div>
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

export function NoticeCards({
  drafts,
  onChange,
  courses,
  warnings,
}: {
  drafts: NoticeCardDraft[];
  onChange: (index: number, draft: NoticeCardDraft) => void;
  courses: Course[];
  warnings: Map<number, string[]>;
}) {
  return (
    <div className="space-y-4">
      {drafts.map((d, i) => {
        const set = (patch: Partial<NoticeCardDraft>) => onChange(i, { ...d, ...patch });
        return (
          <Card key={i} className={`p-4 ${d.include ? '' : 'opacity-50'}`}>
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                aria-label="Include this notice"
                checked={d.include}
                onChange={(e) => set({ include: e.target.checked })}
                className="mt-2 h-4 w-4 rounded border-zinc-300"
              />
              <textarea
                aria-label="Notice text"
                rows={3}
                className={inputClass}
                value={d.text}
                onChange={(e) => set({ text: e.target.value })}
              />
            </div>
            {d.include && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <Label>Course</Label>
                  <CourseSelect value={d.courseId} courses={courses} onChange={(courseId) => set({ courseId })} />
                </label>
                <label className="block">
                  <Label>Posted</Label>
                  <input
                    type="datetime-local"
                    className={inputClass}
                    value={toInputValue(d.postedAt)}
                    onChange={(e) => set({ postedAt: fromInputValue(e.target.value) ?? d.postedAt })}
                  />
                </label>
              </div>
            )}
            <Warnings warnings={warnings.get(i) ?? []} />
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
  const setCourse = (i: number, patch: Partial<Course>) =>
    onCourses(courses.map((c, j) => (j === i ? { ...c, ...patch } : c)));
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
