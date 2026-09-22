import Link from 'next/link';
import { Card, EmptyState, ItemRow, PageTitle, SectionTitle, buttonClass } from '@/components/ui';
import type { Course, RoutineSlot } from '@/lib/schema';
import { readState } from '@/lib/store';
import { DAY_NAMES, formatClock, pad } from '@/lib/time';
import { byDueAt, courseTitle, courseTone } from '@/lib/view';

// data.json changes at runtime; never prerender this page.
export const dynamic = 'force-dynamic';

/**
 * One day's classes in time order. With `nowClock` (today), finished classes
 * are dimmed and the one in progress is ringed and labelled "Now".
 */
function ClassList({
  slots,
  courses,
  nowClock,
}: {
  slots: RoutineSlot[];
  courses: Map<string, Course>;
  nowClock?: string;
}) {
  return (
    <ol className="space-y-2">
      {slots.map((slot) => {
        const course = courses.get(slot.courseId);
        const past = nowClock !== undefined && slot.endTime <= nowClock;
        const live = nowClock !== undefined && slot.startTime <= nowClock && nowClock < slot.endTime;
        return (
          <li
            key={slot.id}
            className={`rounded-xl border px-4 py-3 ${course ? courseTone(course.code) : 'bg-white border-zinc-200'} ${
              past ? 'opacity-50' : ''
            } ${live ? 'ring-2 ring-indigo-500' : ''}`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-semibold">{course?.code ?? 'Unknown course'}</span>
              <span className="text-sm tabular-nums">
                {formatClock(slot.startTime)} – {formatClock(slot.endTime)}
              </span>
            </div>
            <div className="mt-0.5 text-sm opacity-80">
              {[courseTitle(course), slot.room || course?.room, live ? 'Now' : null].filter(Boolean).join(' · ')}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export default async function Dashboard() {
  const state = await readState();
  const now = new Date();
  const nowClock = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const today = now.getDay();
  const tomorrow = (today + 1) % 7;
  const kinds = new Map(state.kinds.map((k) => [k.id, k]));
  const courses = new Map(state.courses.map((c) => [c.id, c]));

  const classesOn = (day: number) =>
    state.routine.filter((s) => s.day === day).sort((a, b) => a.startTime.localeCompare(b.startTime));
  const todaysClasses = classesOn(today);
  const tomorrowsClasses = classesOn(tomorrow);

  // Next 7 days, plus anything overdue that is still pending. Items marked
  // done stay (struck through) until their date passes.
  const horizon = now.getTime() + 7 * 86_400_000;
  const upcoming = state.items
    .filter((i) => {
      const due = new Date(i.dueAt).getTime();
      return due <= horizon && (i.status === 'pending' || due >= now.getTime());
    })
    .sort(byDueAt);

  return (
    <>
      <PageTitle
        title={DAY_NAMES[today]}
        subtitle={now.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
        action={
          <Link href="/add" className={`${buttonClass.primary} px-5 py-2.5 text-base`}>
            + Add screenshot
          </Link>
        }
      />

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="space-y-6 lg:col-span-2">
          {state.routine.length === 0 ? (
            <div>
              <SectionTitle>Today&apos;s classes</SectionTitle>
              <EmptyState>
                No routine yet. <Link href="/add" className="font-medium text-indigo-600">Add your routine</Link>
              </EmptyState>
            </div>
          ) : (
            <>
              <div>
                <SectionTitle>Today&apos;s classes</SectionTitle>
                {todaysClasses.length === 0 ? (
                  <EmptyState>No classes today.</EmptyState>
                ) : (
                  <ClassList slots={todaysClasses} courses={courses} nowClock={nowClock} />
                )}
              </div>
              <div>
                <SectionTitle>Tomorrow&apos;s classes · {DAY_NAMES[tomorrow]}</SectionTitle>
                {tomorrowsClasses.length === 0 ? (
                  <EmptyState>No classes tomorrow.</EmptyState>
                ) : (
                  <ClassList slots={tomorrowsClasses} courses={courses} />
                )}
              </div>
            </>
          )}
        </section>

        <section className="lg:col-span-3">
          <SectionTitle
            action={
              <Link href="/deadlines" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
                All deadlines →
              </Link>
            }
          >
            Next 7 days
          </SectionTitle>
          {upcoming.length === 0 ? (
            <EmptyState>Nothing due in the next 7 days.</EmptyState>
          ) : (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-zinc-100">
                {upcoming.map((item) => (
                  <ItemRow
                    key={item.id}
                    item={item}
                    kind={kinds.get(item.kindId)}
                    course={item.courseId ? courses.get(item.courseId) : undefined}
                    now={now}
                  />
                ))}
              </ul>
            </Card>
          )}
        </section>
      </div>
    </>
  );
}
