'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { postChange } from '@/lib/api-client';
import type { Course } from '@/lib/schema';
import { buttonClass, inputClass } from './ui';

const FIELDS = [
  ['code', 'Code'],
  ['title', 'Title'],
  ['section', 'Section'],
  ['faculty', 'Faculty'],
  ['room', 'Room'],
] as const;

/** Edit a course's details — for when OCR misread the routine. */
export function CourseEditor({ course }: { course: Course }) {
  const router = useRouter();
  const [draft, setDraft] = useState(course);
  const [status, setStatus] = useState<{ kind: 'idle' | 'saving' | 'saved' } | { kind: 'error'; message: string }>({
    kind: 'idle',
  });
  const dirty = JSON.stringify(draft) !== JSON.stringify(course);

  async function save() {
    setStatus({ kind: 'saving' });
    const { id, ...patch } = draft;
    const res = await postChange({ type: 'course.update', id, patch });
    if (res.ok) {
      setStatus({ kind: 'saved' });
      router.refresh();
    } else {
      setStatus({ kind: 'error', message: res.error });
    }
  }

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {FIELDS.map(([key, label]) => (
        <label key={key} className="text-sm">
          <span className="mb-1 block font-medium text-zinc-700">{label}</span>
          <input
            className={inputClass}
            value={draft[key]}
            onChange={(e) => {
              setDraft({ ...draft, [key]: e.target.value });
              setStatus({ kind: 'idle' });
            }}
          />
        </label>
      ))}
      <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium text-zinc-700">
        <input
          type="checkbox"
          checked={draft.isLab}
          onChange={(e) => setDraft({ ...draft, isLab: e.target.checked })}
          className="h-4 w-4 rounded border-zinc-300"
        />
        Lab course
      </label>
      <div className="flex items-center gap-3 sm:col-span-2">
        <button type="submit" className={buttonClass.primary} disabled={!dirty || status.kind === 'saving'}>
          {status.kind === 'saving' ? 'Saving…' : 'Save changes'}
        </button>
        {dirty && (
          <button type="button" className={buttonClass.secondary} onClick={() => setDraft(course)}>
            Reset
          </button>
        )}
        {status.kind === 'saved' && !dirty && <span className="text-sm text-emerald-700">Saved</span>}
        {status.kind === 'error' && <span className="text-sm text-red-700">{status.message}</span>}
      </div>
    </form>
  );
}
