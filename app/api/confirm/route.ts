import { NextResponse } from 'next/server';
import { ConfirmError, confirmProposal, RoutineExistsError } from '@/lib/confirm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Saves a user-approved proposal (JSON body). All-or-nothing.
 * A routine proposal replaces the existing routine only with
 * `?replaceRoutine=true`; without it, an existing routine returns 409 so the
 * UI can ask the user first.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, issues: ['body must be JSON'] }, { status: 400 });
  }

  const replaceRoutine = new URL(request.url).searchParams.get('replaceRoutine') === 'true';

  try {
    const saved = await confirmProposal(body, { replaceRoutine });
    return NextResponse.json({ ok: true, saved });
  } catch (err) {
    if (err instanceof RoutineExistsError) {
      return NextResponse.json(
        { ok: false, needsReplaceConfirmation: true, existingSlots: err.existingSlots, issues: [err.message] },
        { status: 409 },
      );
    }
    if (err instanceof ConfirmError) {
      return NextResponse.json({ ok: false, issues: err.issues }, { status: 400 });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error('[confirm] failed:', err);
    return NextResponse.json({ ok: false, issues: [message] }, { status: 500 });
  }
}
