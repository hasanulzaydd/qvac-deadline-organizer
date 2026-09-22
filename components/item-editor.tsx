'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { postChange } from '@/lib/api-client';
import type { Course, Item, Kind } from '@/lib/schema';
import { hasExamType } from '@/lib/kinds';
import { CourseSelect, DueField, ExamTypeField, KindSelect, Label, dueAtForKind } from './confirm-cards';
import { Modal } from './modal';
import { buttonClass, inputClass } from './ui';

/** Edit a saved deadline: the same fields as the review card, saved via /api/apply. */
export function ItemEditor({
  item,
  kinds,
  courses,
  onClose,
}: {
  item: Item;
  kinds: Kind[];
  courses: Course[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState({
    title: item.title,
    kindId: item.kindId,
    courseId: item.courseId,
    dueAt: item.dueAt as string | null,
    examType: item.examType,
    syllabus: item.syllabus,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kind = kinds.find((k) => k.id === draft.kindId);
  const ready = draft.title.trim() && draft.kindId && draft.dueAt;

  async function save() {
    if (!ready) return;
    setSaving(true);
    setError(null);
    const res = await postChange({
      type: 'item.update',
      id: item.id,
      patch: { ...draft, title: draft.title.trim(), dueAt: draft.dueAt! },
    });
    setSaving(false);
    if (!res.ok) return setError(res.error);
    router.refresh();
    onClose();
  }

  return (
    <Modal open title="Edit deadline" onClose={onClose} wide>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="block">
          <Label>Title</Label>
          <input className={inputClass} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="block">
            <Label>Kind</Label>
            <KindSelect
              value={draft.kindId}
              kinds={kinds}
              onChange={(kindId) => {
                const next = kinds.find((k) => k.id === kindId);
                setDraft({ ...draft, kindId, dueAt: dueAtForKind(draft.dueAt, next), examType: hasExamType(next) ? draft.examType : '' });
              }}
            />
          </label>
          <label className="block">
            <Label>Course</Label>
            <CourseSelect value={draft.courseId} courses={courses} onChange={(courseId) => setDraft({ ...draft, courseId })} />
          </label>
          <label className="block">
            <DueField kind={kind} value={draft.dueAt} onChange={(dueAt) => setDraft({ ...draft, dueAt })} />
          </label>
        </div>
        <ExamTypeField kind={kind} value={draft.examType} onChange={(examType) => setDraft({ ...draft, examType })} />
        <label className="block">
          <Label>Syllabus / topics</Label>
          <textarea
            rows={2}
            className={inputClass}
            value={draft.syllabus}
            onChange={(e) => setDraft({ ...draft, syllabus: e.target.value })}
          />
        </label>
        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className={buttonClass.secondary} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className={buttonClass.primary} disabled={!ready || saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
