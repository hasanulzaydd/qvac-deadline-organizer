import { NextResponse } from 'next/server';
import { ApplyError, applyChange } from '@/lib/apply';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Applies one user-approved change (see lib/change.ts). Returns the new state. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'body must be JSON' }, { status: 400 });
  }

  try {
    const state = await applyChange(body);
    return NextResponse.json({ ok: true, state });
  } catch (err) {
    if (err instanceof ApplyError) {
      return NextResponse.json({ ok: false, error: err.message, ...err.detail }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error('[apply] failed:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
