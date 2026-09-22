'use client';

import { useEffect, useState } from 'react';

type Health = {
  ready: boolean;
  error: string | null;
  progress: { model: 'ocr' | 'llm'; percent: number; downloadedMB: number; totalMB: number } | null;
};

const MODEL_LABEL = { ocr: 'text-reading model', llm: 'language model' } as const;

/**
 * Polls /api/health until both QVAC models are loaded. Returns null until the
 * first answer arrives. On a fresh machine this covers the one-time download.
 */
export function useModelStatus(): Health | null {
  const [health, setHealth] = useState<Health | null>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' });
        const data: Health = await res.json();
        if (stopped) return;
        setHealth(data);
        if (data.ready) return;
      } catch {
        // Server restarting or unreachable — keep trying.
      }
      if (!stopped) timer = setTimeout(poll, 2000);
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  return health;
}

/** What the models are doing, for as long as they are not ready. */
export function ModelStatusBanner({ health }: { health: Health | null }) {
  if (!health || health.ready) return null;

  if (health.error) {
    return (
      <div className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800">
        <p className="font-medium">The AI models could not be loaded.</p>
        <p className="mt-1">{health.error}</p>
        <p className="mt-1 text-red-700">It retries automatically; check the terminal running the app for details.</p>
      </div>
    );
  }

  const p = health.progress;
  const downloading = p && p.percent < 100 && p.totalMB > 0;
  return (
    <div className="mb-4 rounded-md bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
      <p className="font-medium">
        {downloading ? 'Downloading the AI models — first run only' : 'Loading the AI models…'}
      </p>
      {downloading ? (
        <>
          <p className="mt-1">
            {MODEL_LABEL[p.model]}: {p.percent.toFixed(0)}% ({p.downloadedMB.toLocaleString()} /{' '}
            {p.totalMB.toLocaleString()} MB). About 2.6 GB in total; after this, the models load from disk in about 20 seconds and everything works offline.
          </p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-indigo-100">
            <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${p.percent}%` }} />
          </div>
        </>
      ) : (
        <p className="mt-1">This takes about 20 seconds after the app starts. Screenshots can be read once it finishes.</p>
      )}
    </div>
  );
}
