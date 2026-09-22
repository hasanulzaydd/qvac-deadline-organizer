import type { Change } from './change';

/** Browser-side helper: POST one change to /api/apply. */
export async function postChange(
  change: Change,
): Promise<{ ok: true } | { ok: false; status: number; error: string; itemCount?: number }> {
  const res = await fetch('/api/apply', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(change),
  });
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  return res.ok ? { ok: true } : { ok: false, status: res.status, error: data.error, itemCount: data.itemCount };
}
