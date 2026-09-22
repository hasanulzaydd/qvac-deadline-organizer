import Link from 'next/link';
import { EmptyState, PageTitle, buttonClass } from '@/components/ui';
import { readState } from '@/lib/store';
import { DAY_SHORT, formatClock } from '@/lib/time';
import { courseTone } from '@/lib/view';

export const dynamic = 'force-dynamic';

export default async function RoutinePage() {
  const state = await readState();
  const today = new Date().getDay();
  const courses = new Map(state.courses.map((c) => [c.id, c]));

  // Rows: every distinct time slot, in start-time order.
  const slotKeys = [...new Set(state.routine.map((s) => `${s.startTime}-${s.endTime}`))].sort();

  return (
    <>
      <PageTitle
        title="Routine"
        subtitle={
          state.routine.length
            ? `${state.routine.length} classes a week across ${new Set(state.routine.map((s) => s.courseId)).size} courses`
            : undefined
        }
        action={
          <Link href="/add" className={buttonClass.secondary}>
            {state.routine.length ? 'Replace routine' : 'Add routine'}
          </Link>
        }
      />

      {state.routine.length === 0 ? (
        <EmptyState>
          No routine yet. Screenshot your class schedule and{' '}
          <Link href="/add" className="font-medium text-indigo-600">add it</Link> — your courses are created from it.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white shadow-sm">
          <table className="w-full min-w-[760px] table-fixed border-collapse text-sm">
            <thead>
              <tr>
                <th className="w-32 border-b border-zinc-200 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  Time
                </th>
                {DAY_SHORT.map((d, i) => (
                  <th
                    key={d}
                    className={`border-b border-zinc-200 px-2 py-2 text-xs font-semibold uppercase tracking-wide ${
                      i === today ? 'bg-indigo-50 text-indigo-700' : 'text-zinc-500'
                    }`}
                  >
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slotKeys.map((key) => {
                const [start, end] = key.split('-');
                return (
                  <tr key={key} className="border-b border-zinc-100 last:border-0">
                    <td className="px-3 py-2 align-top text-xs tabular-nums text-zinc-600">
                      {formatClock(start)}
                      <br />
                      <span className="text-zinc-400">{formatClock(end)}</span>
                    </td>
                    {DAY_SHORT.map((d, day) => {
                      const slots = state.routine.filter(
                        (s) => s.day === day && s.startTime === start && s.endTime === end,
                      );
                      return (
                        <td key={d} className={`p-1.5 align-top ${day === today ? 'bg-indigo-50/40' : ''}`}>
                          {slots.map((s) => {
                            const course = courses.get(s.courseId);
                            return (
                              <Link
                                key={s.id}
                                href={course ? `/courses/${course.id}` : '/courses'}
                                className={`block rounded-lg border px-2 py-1.5 hover:shadow-sm ${
                                  course ? courseTone(course.code) : 'border-zinc-200'
                                }`}
                              >
                                <div className="font-semibold leading-tight">{course?.code ?? '?'}</div>
                                <div className="truncate text-xs opacity-75">{s.room || course?.room}</div>
                                {course?.isLab && <div className="text-[10px] font-semibold uppercase opacity-60">Lab</div>}
                              </Link>
                            );
                          })}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
