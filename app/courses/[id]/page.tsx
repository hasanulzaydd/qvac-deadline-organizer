import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CourseEditor } from '@/components/course-editor';
import { Card, EmptyState, ItemRow, PageTitle, SectionTitle } from '@/components/ui';
import { readState } from '@/lib/store';
import { DAY_NAMES, formatClock, formatDateTime } from '@/lib/time';
import { byDueAt, courseTitle } from '@/lib/view';

export const dynamic = 'force-dynamic';

export default async function CoursePage(props: PageProps<'/courses/[id]'>) {
  const { id } = await props.params;
  const state = await readState();
  const course = state.courses.find((c) => c.id === id);
  if (!course) notFound();

  const now = new Date();
  const kinds = new Map(state.kinds.map((k) => [k.id, k]));
  const slots = state.routine
    .filter((s) => s.courseId === id)
    .sort((a, b) => a.day - b.day || a.startTime.localeCompare(b.startTime));
  const items = state.items.filter((i) => i.courseId === id).sort(byDueAt);
  const notices = state.notices
    .filter((n) => n.courseId === id)
    .sort((a, b) => new Date(b.postedAt).getTime() - new Date(a.postedAt).getTime());

  return (
    <>
      <Link href="/courses" className="text-sm font-medium text-zinc-500 hover:text-zinc-900">
        ← Courses
      </Link>
      <div className="mt-2">
        <PageTitle title={course.code} subtitle={courseTitle(course) || undefined} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <SectionTitle>Details</SectionTitle>
          <Card className="p-4">
            <CourseEditor course={course} />
          </Card>

          <div className="mt-6">
            <SectionTitle>Weekly classes</SectionTitle>
            {slots.length === 0 ? (
              <EmptyState>Not in the current routine.</EmptyState>
            ) : (
              <Card>
                <ul className="divide-y divide-zinc-100 text-sm">
                  {slots.map((s) => (
                    <li key={s.id} className="flex justify-between gap-3 px-4 py-2.5">
                      <span className="font-medium">{DAY_NAMES[s.day]}</span>
                      <span className="tabular-nums text-zinc-600">
                        {formatClock(s.startTime)} – {formatClock(s.endTime)}
                        {(s.room || course.room) && <span className="text-zinc-400"> · {s.room || course.room}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </section>

        <section>
          <SectionTitle>Deadlines</SectionTitle>
          {items.length === 0 ? (
            <EmptyState>No deadlines for this course.</EmptyState>
          ) : (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-zinc-100">
                {items.map((item) => (
                  <ItemRow key={item.id} item={item} kind={kinds.get(item.kindId)} course={undefined} now={now} />
                ))}
              </ul>
            </Card>
          )}

          <div className="mt-6">
            <SectionTitle>Notices</SectionTitle>
            {notices.length === 0 ? (
              <EmptyState>No notices for this course.</EmptyState>
            ) : (
              <Card>
                <ul className="divide-y divide-zinc-100">
                  {notices.map((n) => (
                    <li key={n.id} className="px-4 py-3">
                      <p className="text-sm">{n.text}</p>
                      <p className="mt-1 text-xs text-zinc-500">{formatDateTime(n.postedAt)}</p>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
