'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { Proposal } from '@/lib/proposal';
import type { Course, Kind, RoutineSlot } from '@/lib/schema';
import { ItemCards, RoutineCards, itemProblems, type ItemCardDraft } from './confirm-cards';
import { Modal } from './modal';
import { ModelStatusBanner, useModelStatus } from './model-status';
import { Card, buttonClass } from './ui';

type IngestResponse = {
  ok: boolean;
  type?: 'item' | 'routine' | 'unknown';
  sourceText?: string;
  modelText?: string | null;
  proposal?: Proposal;
  warnings?: string[];
  error?: string;
  rawOutput?: string;
  attempts?: number;
  timings?: { ocrMs?: number; classifyMs?: number; extractMs?: number };
};

type Stage =
  | { name: 'input' }
  | { name: 'extracting'; startedAt: number }
  | { name: 'review'; result: IngestResponse }
  | { name: 'failed'; result: IngestResponse }
  | { name: 'saved'; summary: string; href: string };

/** Split 'items[2] "Quiz 3": no time…' warnings onto the card they belong to. */
function groupWarnings(warnings: string[]) {
  const byIndex = new Map<number, string[]>();
  const general: string[] = [];
  for (const w of warnings) {
    const m = /^items\[(\d+)\](?: "[^"]*")?: /.exec(w);
    if (m) {
      const i = Number(m[1]);
      byIndex.set(i, [...(byIndex.get(i) ?? []), w.slice(m[0].length)]);
    } else {
      general.push(w);
    }
  }
  return { byIndex, general };
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? '' : word.endsWith('s') ? 'es' : 's'}`;
}

export function AddFlow({
  kinds,
  courses,
  existingSlots,
}: {
  kinds: Kind[];
  courses: Course[];
  existingSlots: number;
}) {
  const [stage, setStage] = useState<Stage>({ name: 'input' });
  const [file, setFileState] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const [items, setItems] = useState<ItemCardDraft[]>([]);
  const [routineCourses, setRoutineCourses] = useState<Course[]>([]);
  const [routineSlots, setRoutineSlots] = useState<RoutineSlot[]>([]);
  const [saveError, setSaveError] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const health = useModelStatus();

  /** Choose (or clear) the image and its preview URL together. */
  function setFile(next: File | null) {
    setFileState(next);
    setPreview(next ? URL.createObjectURL(next) : null);
  }

  // Free each preview's object URL once it is replaced or the page unmounts.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  // Elapsed-seconds counter while OCR + extraction runs (it can take ~30 s).
  useEffect(() => {
    if (stage.name !== 'extracting') return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - stage.startedAt) / 1000)), 500);
    return () => clearInterval(t);
  }, [stage]);

  // Paste a screenshot straight from the clipboard.
  useEffect(() => {
    if (stage.name !== 'input') return;
    const onPaste = (e: ClipboardEvent) => {
      const image = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
      if (image) {
        e.preventDefault();
        setFile(image);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [stage.name]);

  function loadProposal(p: Proposal) {
    setSaveError(null);
    if (p.type === 'item') {
      setItems(
        p.items.map((it) => ({
          include: true,
          title: it.title,
          kindRef: it.kindId ?? '',
          courseId: it.courseId,
          dueAt: it.dueAt,
          examType: it.examType,
          syllabus: it.syllabus,
          sourceText: it.sourceText,
        })),
      );
    } else {
      setRoutineCourses(p.courses);
      setRoutineSlots(p.slots);
    }
  }

  async function extract() {
    if (!file) return;
    const body = new FormData();
    body.append('image', file);
    setElapsed(0);
    setStage({ name: 'extracting', startedAt: Date.now() });
    try {
      const res = await fetch('/api/ingest', { method: 'POST', body });
      const result: IngestResponse = await res.json();
      if (result.ok && result.proposal) {
        loadProposal(result.proposal);
        setStage({ name: 'review', result });
      } else {
        setStage({ name: 'failed', result });
      }
    } catch (err) {
      setStage({ name: 'failed', result: { ok: false, error: `request failed: ${String(err)}` } });
    }
  }

  function buildProposal(result: IngestResponse): Proposal | null {
    const type = result.proposal?.type;
    if (type === 'item') {
      const included = items.filter((d) => d.include);
      if (!included.length) return null;
      return {
        type: 'item',
        items: included.map((d) => ({
          kindId: d.kindRef || null,
          courseId: d.courseId,
          title: d.title.trim(),
          dueAt: d.dueAt,
          examType: d.examType,
          syllabus: d.syllabus,
          sourceText: d.sourceText,
        })),
      };
    }
    if (type === 'routine') return { type: 'routine', courses: routineCourses, slots: routineSlots };
    return null;
  }

  async function save(result: IngestResponse, replaceRoutine = false) {
    const proposal = buildProposal(result);
    if (!proposal) return;
    // A new routine replaces the whole saved one — ask first.
    if (proposal.type === 'routine' && existingSlots > 0 && !replaceRoutine) {
      setConfirmReplace(true);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/confirm${replaceRoutine ? '?replaceRoutine=true' : ''}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(proposal),
      });
      const data = await res.json();
      if (res.status === 409 && data.needsReplaceConfirmation) {
        setConfirmReplace(true);
        return;
      }
      if (!data.ok) {
        setSaveError(data.issues ?? [data.error ?? `HTTP ${res.status}`]);
        return;
      }
      const s = data.saved;
      if (s.type === 'item') {
        setStage({ name: 'saved', summary: `Saved ${plural(s.items.length, 'deadline')}.`, href: '/deadlines' });
      } else {
        const replaced = s.replacedSlots ? ` (replaced ${plural(s.replacedSlots, 'old class')})` : '';
        setStage({
          name: 'saved',
          summary: `Saved your routine: ${plural(s.slots.length, 'class')} across ${plural(s.courses.length, 'course')}${replaced}.`,
          href: '/routine',
        });
      }
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setStage({ name: 'input' });
    setFile(null);
  }

  // ---------------------------------------------------------------- input
  if (stage.name === 'input' || stage.name === 'extracting') {
    const busy = stage.name === 'extracting';
    // Until the models are loaded, extracting would just wait on the download.
    const modelsReady = health?.ready ?? true;
    return (
      <>
        <ModelStatusBanner health={health} />
        <Card className="p-5">
          <div
            className={`flex min-h-48 flex-col items-center justify-center rounded-lg border-2 border-dashed p-4 text-center ${
              file ? 'border-indigo-300 bg-indigo-50/40' : 'border-zinc-300'
            }`}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/'));
              if (f) setFile(f);
            }}
          >
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
              <img src={preview} alt="Screenshot to read" className="max-h-64 rounded border border-zinc-200" />
            ) : (
              <>
                <p className="font-medium">Drop a screenshot here, paste it (Ctrl+V), or choose an image</p>
                <p className="mt-1 text-sm text-zinc-500">Your class routine, or a post about a quiz, assignment or exam</p>
              </>
            )}
            <div className="mt-3 flex gap-2">
              <button type="button" className={buttonClass.secondary} disabled={busy} onClick={() => fileInput.current?.click()}>
                {file ? 'Choose another image' : 'Choose image'}
              </button>
              {file && (
                <button type="button" className={buttonClass.secondary} disabled={busy} onClick={() => setFile(null)}>
                  Remove
                </button>
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
  
          <div className="mt-4 flex items-center gap-3">
            <button type="button" className={buttonClass.primary} disabled={busy || !file || !modelsReady} onClick={extract}>
              {busy ? 'Reading…' : 'Extract'}
            </button>
            {busy && (
              <span className="text-sm text-zinc-500">
                Reading the image on-device — {elapsed}s{elapsed < 45 ? ' (usually 15–35 s)' : ''}
              </span>
            )}
          </div>
        </Card>
      </>
    );
  }

  // ---------------------------------------------------------------- saved
  if (stage.name === 'saved') {
    return (
      <Card className="p-6 text-center">
        <p className="text-lg font-medium text-emerald-700">{stage.summary}</p>
        <div className="mt-4 flex justify-center gap-2">
          <Link href={stage.href} className={buttonClass.primary}>
            View
          </Link>
          <button type="button" className={buttonClass.secondary} onClick={reset}>
            Add another
          </button>
        </div>
      </Card>
    );
  }

  const { result } = stage;
  const sourceBlock = result.sourceText ? (
    <details className="mt-4 text-sm">
      <summary className="cursor-pointer font-medium text-zinc-600">Text read from the screenshot</summary>
      <pre className="mt-2 whitespace-pre-wrap rounded-md bg-zinc-100 p-3 font-mono text-xs">{result.sourceText}</pre>
      {result.modelText && result.modelText !== result.sourceText && (
        <>
          <p className="mt-3 font-medium text-zinc-600">What the AI read (layout rebuilt)</p>
          <pre className="mt-2 whitespace-pre-wrap rounded-md bg-indigo-50 p-3 font-mono text-xs">{result.modelText}</pre>
        </>
      )}
    </details>
  ) : null;

  // ---------------------------------------------------------------- failed
  if (stage.name === 'failed') {
    return (
      <Card className="p-5">
        <p className="font-medium text-red-700">Nothing to save.</p>
        <p className="mt-1 text-sm text-zinc-600">{result.error}</p>
        {sourceBlock}
        <button type="button" className={`${buttonClass.secondary} mt-4`} onClick={reset}>
          Try another screenshot
        </button>
      </Card>
    );
  }

  // ---------------------------------------------------------------- review
  const type = result.proposal!.type;
  const { byIndex, general } = groupWarnings(result.warnings ?? []);
  const blocked =
    type === 'item'
      ? items.every((d) => !d.include) || items.some((d) => d.include && itemProblems(d).length > 0)
      : routineSlots.length === 0 || routineSlots.some((s) => s.startTime >= s.endTime);

  const heading =
    type === 'item'
      ? `Found ${plural(items.length, 'deadline')}`
      : `Found a routine: ${plural(routineSlots.length, 'class')}, ${plural(routineCourses.length, 'course')}`;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{heading}</h2>
          <p className="text-sm text-zinc-500">Check every field — nothing is saved until you press Save.</p>
        </div>
        <button type="button" className={buttonClass.secondary} onClick={reset}>
          Start over
        </button>
      </div>

      {general.length > 0 && (
        <ul className="mb-4 space-y-1 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {general.map((w, i) => (
            <li key={i}>⚠ {w}</li>
          ))}
        </ul>
      )}
      {type === 'routine' && existingSlots > 0 && (
        <p className="mb-4 rounded-md bg-zinc-100 px-3 py-2 text-sm text-zinc-700">
          Saving replaces your current routine ({plural(existingSlots, 'class')}). Courses are kept and updated.
        </p>
      )}

      {type === 'item' ? (
        <ItemCards
          drafts={items}
          onChange={(i, d) => setItems(items.map((x, j) => (j === i ? d : x)))}
          kinds={kinds}
          courses={courses}
          warnings={byIndex}
        />
      ) : (
        <RoutineCards
          courses={routineCourses}
          slots={routineSlots}
          onCourses={setRoutineCourses}
          onSlots={setRoutineSlots}
        />
      )}

      {saveError && (
        <ul className="mt-4 space-y-1 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {saveError.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}

      <div className="sticky bottom-0 mt-6 flex items-center gap-3 border-t border-zinc-200 bg-zinc-50/95 py-3 backdrop-blur">
        <button type="button" className={buttonClass.primary} disabled={blocked || saving} onClick={() => void save(result)}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        {blocked && <span className="text-sm text-zinc-500">Fill in the highlighted fields to save.</span>}
      </div>

      {sourceBlock}

      <Modal open={confirmReplace} title="Replace your routine?" onClose={() => setConfirmReplace(false)}>
        <p className="text-sm text-zinc-600">
          Your current routine has {plural(existingSlots, 'class')}. Saving this one removes all of them and keeps only the{' '}
          {plural(routineSlots.length, 'class')} shown here. Your courses and deadlines are kept.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={buttonClass.secondary} onClick={() => setConfirmReplace(false)}>
            Cancel
          </button>
          <button
            type="button"
            className={buttonClass.danger}
            onClick={() => {
              setConfirmReplace(false);
              void save(result, true);
            }}
          >
            Replace routine
          </button>
        </div>
      </Modal>
    </>
  );
}
