import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Course, Item, Kind } from '@/lib/schema';
import { formatDateTime, relativeDay } from '@/lib/time';
import { dueWord, isOverdue } from '@/lib/view';

/** Presentational pieces with no hooks, usable from server and client components. */

export function KindChip({ kind }: { kind: Kind | undefined }) {
  if (!kind) {
    return <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500">No kind</span>;
  }
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `${kind.color}1a`, color: kind.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: kind.color }} />
      {kind.name}
    </span>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-zinc-200 bg-white shadow-sm ${className}`}>{children}</div>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{children}</h2>
      {action}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-zinc-300 px-4 py-6 text-center text-sm text-zinc-500">{children}</p>;
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

/**
 * One deadline. Overdue pending items get a red edge and label; done items
 * are struck through. `now` is passed in so server and client render alike.
 */
export function ItemRow({
  item,
  kind,
  course,
  now,
  leading,
}: {
  item: Item;
  kind: Kind | undefined;
  course: Course | undefined;
  now: Date;
  leading?: ReactNode;
}) {
  const overdue = isOverdue(item, now);
  const done = item.status === 'done';
  return (
    <li
      className={`flex gap-3 border-l-4 px-4 py-3 ${
        overdue ? 'border-l-red-500 bg-red-50/60' : 'border-l-transparent'
      } ${done ? 'opacity-60' : ''}`}
    >
      {leading}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`font-medium ${done ? 'line-through' : ''}`}>{item.title}</span>
          <KindChip kind={kind} />
          {course && (
            <Link href={`/courses/${course.id}`} className="text-xs font-medium text-zinc-500 hover:text-zinc-900">
              {course.code}
            </Link>
          )}
        </div>
        <div className={`mt-0.5 text-sm ${overdue ? 'font-medium text-red-700' : 'text-zinc-600'}`}>
          {overdue ? 'Overdue · ' : ''}
          {dueWord(kind)} {formatDateTime(item.dueAt)}
          <span className="text-zinc-400"> · {relativeDay(item.dueAt, now)}</span>
        </div>
        {(item.syllabus || item.instructions) && (
          <div className="mt-1 space-y-0.5 text-sm text-zinc-500">
            {item.syllabus && <p>{item.syllabus}</p>}
            {item.instructions && <p className="italic">{item.instructions}</p>}
          </div>
        )}
      </div>
    </li>
  );
}

export const buttonClass = {
  primary:
    'inline-flex items-center justify-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:opacity-50',
  secondary:
    'inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50',
  danger:
    'inline-flex items-center justify-center rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50',
};

/** Field styling without a width, for inline controls that size themselves. */
export const inputBase =
  'rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500';

export const inputClass = `w-full ${inputBase}`;
