import { KindsManager } from '@/components/kinds-manager';
import { PageTitle } from '@/components/ui';
import { readState } from '@/lib/store';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const state = await readState();
  const itemCounts: Record<string, number> = {};
  for (const item of state.items) itemCounts[item.kindId] = (itemCounts[item.kindId] ?? 0) + 1;

  return (
    <>
      <PageTitle
        title="Settings"
        subtitle="Kinds sort your deadlines. The AI files each new item under one of these — it never invents a kind."
      />
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">Kinds</h2>
      <KindsManager kinds={state.kinds} itemCounts={itemCounts} />
    </>
  );
}
