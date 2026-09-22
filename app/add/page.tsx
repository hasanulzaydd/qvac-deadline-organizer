import { AddFlow } from '@/components/add-flow';
import { PageTitle } from '@/components/ui';
import { readState } from '@/lib/store';

export const dynamic = 'force-dynamic';

export default async function AddPage() {
  const state = await readState();
  return (
    <>
      <PageTitle title="Add" subtitle="Read on-device by QVAC. You review everything before it is saved." />
      <AddFlow kinds={state.kinds} courses={state.courses} existingSlots={state.routine.length} />
    </>
  );
}
