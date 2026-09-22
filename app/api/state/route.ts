import { NextResponse } from 'next/server';
import { readState, StoreCorruptError } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await readState());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api/state]', message);
    return NextResponse.json(
      {
        error: message,
        corrupt: err instanceof StoreCorruptError,
      },
      { status: 500 },
    );
  }
}
