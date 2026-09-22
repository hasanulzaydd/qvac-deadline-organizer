'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { postChange } from '@/lib/api-client';
import type { Course, Item, Kind } from '@/lib/schema';
import { byDueAt } from '@/lib/view';
import { ItemEditor } from './item-editor';
import { Modal } from './modal';
import { Card, EmptyState, ItemRow, buttonClass } from './ui';

function Chip({
  active,
  onClick,
  color,
  children,
}: {
  active: boolean;
  onClick: () => void;
  color?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
        active ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50'
      }`}
    >
      {color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />}
      {children}
    </button>
  );
}

/** Round "done" toggle — visually distinct from the square selection checkbox. */
function DoneToggle({ item, onToggle }: { item: Item; onToggle: () => void }) {
  const done = item.status === 'done';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={done ? `Mark "${item.title}" not done` : `Mark "${item.title}" done`}
      onClick={onToggle}
      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors ${
        done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-zinc-300 hover:border-emerald-500'
      }`}
    >
      {done ? '✓' : ''}
    </button>
  );
}

export function DeadlinesView({
  items,
  kinds,
  courses,
  nowIso,
}: {
  items: Item[];
  kinds: Kind[];
  courses: Course[];
  nowIso: string;
}) {
  const router = useRouter();
  const now = new Date(nowIso);
  const [kindId, setKindId] = useState<string | null>(null);
  const [courseId, setCourseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Status flips and removals shown immediately, before the server answers.
  const [optimistic, setOptimistic] = useState<Record<string, Item['status']>>({});
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  // Selection mode: pick deadlines to remove.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);

  const kindById = new Map(kinds.map((k) => [k.id, k]));
  const courseById = new Map(courses.map((c) => [c.id, c]));

  // Done items stay in the list (struck through); only removal takes them out.
  const visible = items
    .filter((i) => !removed.has(i.id))
    .map((i) => (optimistic[i.id] ? { ...i, status: optimistic[i.id] } : i))
    .filter((i) => (kindId ? i.kindId === kindId : true))
    .filter((i) => (courseId ? i.courseId === courseId : true))
    .sort(byDueAt);

  async function toggleDone(item: Item) {
    setError(null);
    const status = item.status === 'done' ? 'pending' : 'done';
    setOptimistic((o) => ({ ...o, [item.id]: status }));
    const res = await postChange({ type: 'item.setStatus', id: item.id, status });
    if (res.ok) {
      router.refresh();
    } else {
      setError(res.error);
      setOptimistic((o) => {
        const next = { ...o };
        delete next[item.id];
        return next;
      });
    }
  }

  function toggleSelected(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function stopSelecting() {
    setSelecting(false);
    setSelected(new Set());
  }

  async function removeSelected() {
    const ids = [...selected];
    setConfirmRemove(false);
    setError(null);
    setRemoved((r) => new Set([...r, ...ids]));
    const res = await postChange({ type: 'items.remove', ids });
    if (res.ok) {
      stopSelecting();
      router.refresh();
    } else {
      setError(res.error);
      setRemoved((r) => new Set([...r].filter((id) => !ids.includes(id))));
    }
  }

  const allVisibleSelected = visible.length > 0 && visible.every((i) => selected.has(i.id));

  return (
    <>
      <div className="space-y-2">
        <div className="flex gap-2 overflow-x-auto pb-1">
          <Chip active={kindId === null} onClick={() => setKindId(null)}>
            All kinds
          </Chip>
          {kinds.map((k) => (
            <Chip key={k.id} active={kindId === k.id} onClick={() => setKindId(k.id)} color={k.color}>
              {k.name}
            </Chip>
          ))}
        </div>
        {courses.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            <Chip active={courseId === null} onClick={() => setCourseId(null)}>
              All courses
            </Chip>
            {[...courses]
              .sort((a, b) => a.code.localeCompare(b.code))
              .map((c) => (
                <Chip key={c.id} active={courseId === c.id} onClick={() => setCourseId(c.id)}>
                  {c.code}
                </Chip>
              ))}
          </div>
        )}
      </div>

      {visible.length > 0 && (
        <div className="mt-4 flex min-h-9 flex-wrap items-center gap-2">
          {selecting ? (
            <>
              <label className="flex items-center gap-2 text-sm text-zinc-600">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-zinc-300"
                  checked={allVisibleSelected}
                  onChange={() => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((i) => i.id)))}
                />
                Select all
              </label>
              <span className="text-sm text-zinc-500">{selected.size} selected</span>
              <div className="ml-auto flex gap-2">
                <button type="button" className={buttonClass.secondary} onClick={stopSelecting}>
                  Cancel
                </button>
                <button
                  type="button"
                  className={buttonClass.danger}
                  disabled={selected.size === 0}
                  onClick={() => setConfirmRemove(true)}
                >
                  Remove{selected.size ? ` (${selected.size})` : ''}
                </button>
              </div>
            </>
          ) : (
            <button type="button" className={`${buttonClass.secondary} ml-auto`} onClick={() => setSelecting(true)}>
              Select
            </button>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      <div className="mt-3">
        {visible.length === 0 ? (
          <EmptyState>{items.length === 0 ? 'No deadlines yet.' : 'Nothing matches these filters.'}</EmptyState>
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-zinc-100">
              {visible.map((item) => (
                <ItemRow
                  key={item.id}
                  item={item}
                  kind={kindById.get(item.kindId)}
                  course={item.courseId ? courseById.get(item.courseId) : undefined}
                  now={now}
                  leading={
                    selecting ? (
                      <input
                        type="checkbox"
                        aria-label={`Select "${item.title}"`}
                        checked={selected.has(item.id)}
                        onChange={() => toggleSelected(item.id)}
                        className="mt-1 h-4 w-4 shrink-0 rounded border-zinc-300"
                      />
                    ) : (
                      <DoneToggle item={item} onToggle={() => void toggleDone(item)} />
                    )
                  }
                  trailing={
                    !selecting && (
                      <button
                        type="button"
                        aria-label={`Edit "${item.title}"`}
                        onClick={() => setEditing(item)}
                        className="shrink-0 self-start rounded-md px-2 py-1 text-sm font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"
                      >
                        Edit
                      </button>
                    )
                  }
                />
              ))}
            </ul>
          </Card>
        )}
      </div>

      {editing && (
        <ItemEditor item={editing} kinds={kinds} courses={courses} onClose={() => setEditing(null)} />
      )}

      <Modal
        open={confirmRemove}
        title={`Remove ${selected.size} deadline${selected.size === 1 ? '' : 's'}?`}
        onClose={() => setConfirmRemove(false)}
      >
        <p className="text-sm text-zinc-600">
          {selected.size === 1 ? 'It' : 'They'} will be deleted permanently. To keep a finished deadline in the list,
          mark it done instead.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={buttonClass.secondary} onClick={() => setConfirmRemove(false)}>
            Cancel
          </button>
          <button type="button" className={buttonClass.danger} onClick={() => void removeSelected()}>
            Remove
          </button>
        </div>
      </Modal>
    </>
  );
}
