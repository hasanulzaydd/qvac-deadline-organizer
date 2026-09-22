'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { postChange } from '@/lib/api-client';
import type { Course, RoutineSlot } from '@/lib/schema';
import { RoutineCards } from './confirm-cards';
import { buttonClass } from './ui';

/**
 * The saved routine, read-only (`children` is the timetable grid) until the
 * user presses Edit; then the same tables as the review screen, saved through
 * /api/apply as one routine.update change.
 */
export function RoutineEditor({
  courses,
  slots,
  children,
}: {
  courses: Course[];
  slots: RoutineSlot[];
  children: ReactNode;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [draftCourses, setDraftCourses] = useState(courses);
  const [draftSlots, setDraftSlots] = useState(slots);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function start() {
    setDraftCourses(courses);
    setDraftSlots(slots);
    setError(null);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    setError(null);
    const res = await postChange({ type: 'routine.update', courses: draftCourses, slots: draftSlots });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    setEditing(false);
    router.refresh();
  }

  const invalid = draftSlots.some((s) => s.startTime >= s.endTime) || draftCourses.some((c) => !c.code.trim());

  if (!editing) {
    return (
      <>
        <div className="mb-3 flex justify-end">
          <button type="button" className={buttonClass.secondary} onClick={start}>
            Edit routine
          </button>
        </div>
        {children}
      </>
    );
  }

  return (
    <>
      <p className="mb-4 text-sm text-zinc-500">
        Fix any course detail or class, remove a class, or add one the screenshot missed. Leave a class&apos;s room empty to use
        its course&apos;s room.
      </p>
      <RoutineCards courses={draftCourses} slots={draftSlots} onCourses={setDraftCourses} onSlots={setDraftSlots} />
      {error && <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="sticky bottom-0 mt-6 flex items-center gap-3 border-t border-zinc-200 bg-zinc-50/95 py-3 backdrop-blur">
        <button type="button" className={buttonClass.primary} disabled={saving || invalid} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className={buttonClass.secondary} disabled={saving} onClick={() => setEditing(false)}>
          Cancel
        </button>
        {invalid && <span className="text-sm text-zinc-500">Every class must end after it starts, and every course needs a code.</span>}
      </div>
    </>
  );
}
