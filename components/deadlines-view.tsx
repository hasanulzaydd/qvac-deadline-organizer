'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { postChange } from '@/lib/api-client';
import type { Course, Item, Kind } from '@/lib/schema';
import { byDueAt } from '@/lib/view';
import { Card, EmptyState, ItemRow } from './ui';

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
  const [showDone, setShowDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Status flips shown immediately, before the server round-trip completes.
  const [optimistic, setOptimistic] = useState<Record<string, Item['status']>>({});

  const kindById = new Map(kinds.map((k) => [k.id, k]));
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const withStatus = items.map((i) => (optimistic[i.id] ? { ...i, status: optimistic[i.id] } : i));
  const doneCount = withStatus.filter((i) => i.status === 'done').length;

  const visible = withStatus
    .filter((i) => (kindId ? i.kindId === kindId : true))
    .filter((i) => (courseId ? i.courseId === courseId : true))
    .filter((i) => showDone || i.status === 'pending')
    .sort(byDueAt);

  async function toggle(item: Item) {
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

  return (
    <>
      <div className="space-y-2">
        {/* Generated from the kinds list, so a new kind gets a chip automatically. */}
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
        <label className="flex items-center gap-2 text-sm text-zinc-600">
          <input
            type="checkbox"
            checked={showDone}
            onChange={(e) => setShowDone(e.target.checked)}
            className="h-4 w-4 rounded border-zinc-300"
          />
          Show done ({doneCount})
        </label>
      </div>

      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

      <div className="mt-4">
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
                    <input
                      type="checkbox"
                      aria-label={item.status === 'done' ? `Mark "${item.title}" not done` : `Mark "${item.title}" done`}
                      checked={item.status === 'done'}
                      onChange={() => void toggle(item)}
                      className="mt-1 h-4 w-4 shrink-0 rounded border-zinc-300"
                    />
                  }
                />
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
