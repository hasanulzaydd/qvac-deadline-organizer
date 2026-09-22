import { NextResponse } from 'next/server';
import { ocrImage, runIngest } from '@/lib/ingest';
import { readState } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Accepts multipart form data with either `image` (a screenshot) or `text`
 * (pasted text). Returns a PROPOSAL — this route never writes to storage.
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'expected multipart form data with "image" or "text"' }, { status: 400 });
  }

  const image = form.get('image');
  const pasted = form.get('text');

  try {
    let input: Parameters<typeof runIngest>[0];

    if (image instanceof File && image.size > 0) {
      input = await ocrImage(image).then((r) => ({ sourceText: r.sourceText, modelText: r.modelText, timetable: r.timetable, ocrMs: r.ms }));
      console.log(`[ingest] OCR ${image.name}: ${input.sourceText.length} chars in ${input.ocrMs}ms`);
    } else if (typeof pasted === 'string' && pasted.trim()) {
      input = { sourceText: pasted.trim() };
    } else {
      return NextResponse.json({ ok: false, error: 'send an "image" file or non-empty "text"' }, { status: 400 });
    }

    if (!input.sourceText.trim()) {
      return NextResponse.json(
        { ok: false, type: 'unknown', sourceText: '', error: 'OCR found no text in the image', attempts: 0, timings: { ocrMs: input.ocrMs, classifyMs: 0 } },
        { status: 422 },
      );
    }

    const result = await runIngest(input, await readState());
    return NextResponse.json(
      // modelText is returned so the page can show what the model actually read.
      { ...result, modelText: input.modelText ?? null },
      { status: result.ok ? 200 : 422 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ingest] failed:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
