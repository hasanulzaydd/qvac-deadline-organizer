import { DeadlinesView } from '@/components/deadlines-view';
import { PageTitle } from '@/components/ui';
import { readState } from '@/lib/store';

export const dynamic = 'force-dynamic';

export default async function DeadlinesPage() {
  const state = await readState();
  const pending = state.items.filter((i) => i.status === 'pending').length;
  return (
    <>
      <PageTitle title="Deadlines" subtitle={pending === 1 ? '1 remaining' : `${pending} remaining`} />
      <DeadlinesView
        items={state.items}
        kinds={state.kinds}
        courses={state.courses}
        nowIso={new Date().toISOString()}
      />
    </>
  );
}
