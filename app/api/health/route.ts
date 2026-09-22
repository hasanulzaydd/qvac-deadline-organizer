import { NextResponse } from 'next/server';
import { getQvac, getQvacStatus } from '@/lib/qvac';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // Kick off loading if it has not started; do not block the response on it.
  void getQvac().catch(() => {});

  const status = getQvacStatus();
  return NextResponse.json({
    ready: status.ocrReady && status.llmReady,
    ...status,
  });
}
