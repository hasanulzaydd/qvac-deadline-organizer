import Link from 'next/link';
import { EmptyState, PageTitle } from '@/components/ui';
import { readState } from '@/lib/store';
import { courseTitle, courseTone } from '@/lib/view';

export const dynamic = 'force-dynamic';

export default async function CoursesPage() {
  const state = await readState();
  const courses = [...state.courses].sort((a, b) => a.code.localeCompare(b.code));

  return (
    <>
      <PageTitle title="Courses" subtitle="Created from your routine. Open one to fix anything OCR got wrong." />
      {courses.length === 0 ? (
        <EmptyState>
          No courses yet — they are created when you <Link href="/add" className="font-medium text-indigo-600">add your routine</Link>.
        </EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => {
            const slots = state.routine.filter((s) => s.courseId === c.id).length;
            const pending = state.items.filter((i) => i.courseId === c.id && i.status === 'pending').length;
            const notices = state.notices.filter((n) => n.courseId === c.id).length;
            return (
              <li key={c.id}>
                <Link
                  href={`/courses/${c.id}`}
                  className={`block h-full rounded-xl border p-4 shadow-sm transition hover:shadow-md ${courseTone(c.code)}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-lg font-semibold">{c.code}</span>
                    {c.isLab && (
                      <span className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase">Lab</span>
                    )}
                  </div>
                  {courseTitle(c) && <p className="text-sm">{courseTitle(c)}</p>}
                  <p className="mt-2 text-sm opacity-80">
                    {[c.section && `Section ${c.section}`, c.faculty, c.room].filter(Boolean).join(' · ') || 'No details'}
                  </p>
                  <p className="mt-3 text-xs opacity-70">
                    {slots} class{slots === 1 ? '' : 'es'}/week · {pending} pending · {notices} notice{notices === 1 ? '' : 's'}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
