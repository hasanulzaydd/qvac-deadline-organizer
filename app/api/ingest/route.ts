import { NextResponse } from 'next/server';
import { ocrImage, runIngest } from '@/lib/ingest';
import { readState } from '@/lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Accepts multipart form data with an `image` (a screenshot of a class
 * routine or of a quiz/assignment/exam post). Returns a PROPOSAL — this route
 * never writes to storage.
 */
export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'expected multipart form data with an "image" file' }, { status: 400 });
  }

  const image = form.get('image');
  if (!(image instanceof File) || image.size === 0) {
    return NextResponse.json({ ok: false, error: 'send a screenshot as an "image" file' }, { status: 400 });
  }
  if (!image.type.startsWith('image/')) {
    return NextResponse.json({ ok: false, error: `"${image.name}" is not an image` }, { status: 415 });
  }

  try {
    const ocr = await ocrImage(image);
    console.log(`[ingest] OCR ${image.name}: ${ocr.sourceText.length} chars in ${ocr.ms}ms`);

    if (!ocr.sourceText.trim()) {
      return NextResponse.json(
        { ok: false, type: 'unknown', sourceText: '', error: 'No text could be read from this image.', attempts: 0, timings: { ocrMs: ocr.ms, classifyMs: 0 } },
        { status: 422 },
      );
    }

    const result = await runIngest(
      { sourceText: ocr.sourceText, modelText: ocr.modelText, timetable: ocr.timetable, ocrMs: ocr.ms },
      await readState(),
    );
    return NextResponse.json(
      // modelText is returned so the page can show what the model actually read.
      { ...result, modelText: ocr.modelText },
      { status: result.ok ? 200 : 422 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[ingest] failed:', err);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
