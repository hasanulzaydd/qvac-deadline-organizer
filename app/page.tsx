'use client';

import { useEffect, useState } from 'react';

type Named = { id: string; name?: string; code?: string };
type StateSummary = { kinds: Named[]; courses: Named[] };

export default function Home() {
  const [pasted, setPasted] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [draft, setDraft] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const [lookup, setLookup] = useState<StateSummary | null>(null);

  async function refreshLookup() {
    const res = await fetch('/api/state');
    if (res.ok) setLookup(await res.json());
  }

  useEffect(() => {
    // Initial fetch of kinds/courses for the id reference list.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshLookup();
  }, []);

  async function extract() {
    const body = new FormData();
    if (file) body.append('image', file);
    else body.append('text', pasted);

    setBusy(true);
    setStatus(file ? 'running OCR + extraction…' : 'running extraction…');
    setResult(null);
    setDraft('');
    setSaveMsg('');
    try {
      const res = await fetch('/api/ingest', { method: 'POST', body });
      const data = await res.json();
      setResult(data);
      setDraft(data.proposal ? JSON.stringify(data.proposal, null, 2) : '');
      setStatus(data.ok ? `proposal ready (HTTP ${res.status})` : `failed (HTTP ${res.status})`);
    } catch (err) {
      setStatus(`request failed: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    let proposal: unknown;
    try {
      proposal = JSON.parse(draft);
    } catch (err) {
      setSaveMsg(`not valid JSON: ${String(err)}`);
      return;
    }
    setBusy(true);
    try {
      const post = (replaceRoutine: boolean) =>
        fetch(`/api/confirm${replaceRoutine ? '?replaceRoutine=true' : ''}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(proposal),
        });
      let res = await post(false);
      let data = await res.json();
      // A new routine replaces the whole saved one — ask before doing that.
      if (res.status === 409 && data.needsReplaceConfirmation) {
        const ok = window.confirm(
          `You already have a routine with ${data.existingSlots} class slot(s). ` +
            'Saving this one will replace the whole routine. Continue?',
        );
        if (!ok) {
          setSaveMsg('not saved: existing routine kept');
          return;
        }
        res = await post(true);
        data = await res.json();
      }
      setSaveMsg(data.ok ? `saved:\n${JSON.stringify(data.saved, null, 2)}` : `not saved:\n${data.issues.join('\n')}`);
      if (data.ok) void refreshLookup();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 16, fontFamily: 'monospace' }}>
      <h1>Ingest</h1>

      <p>Paste text:</p>
      <textarea rows={6} cols={90} value={pasted} onChange={(e) => setPasted(e.target.value)} disabled={busy || !!file} />

      <p>
        or upload a screenshot:{' '}
        <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={busy} />
      </p>

      <button onClick={extract} disabled={busy || (!file && !pasted.trim())}>
        Extract
      </button>{' '}
      <span>{status}</span>

      {result && (
        <>
          <h2>Result</h2>
          <pre style={{ whiteSpace: 'pre-wrap' }}>
            {`type: ${result.type}   attempts: ${result.attempts}   timings: ${JSON.stringify(result.timings)}`}
            {result.error ? `\nerror: ${result.error}` : ''}
          </pre>
          {Array.isArray(result.warnings) && result.warnings.length > 0 && (
            <>
              <h3>Warnings — check these before saving</h3>
              <ul>
                {(result.warnings as string[]).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </>
          )}
          <h3>Source text</h3>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#eee', padding: 8 }}>{String(result.sourceText ?? '')}</pre>
          {typeof result.modelText === 'string' && result.modelText !== result.sourceText && (
            <>
              <h3>What the model read (layout rebuilt, OCR digits fixed)</h3>
              <pre style={{ whiteSpace: 'pre-wrap', background: '#eef', padding: 8 }}>{result.modelText}</pre>
            </>
          )}
          {typeof result.rawOutput === 'string' && (
            <>
              <h3>Raw model output</h3>
              <pre style={{ whiteSpace: 'pre-wrap' }}>{result.rawOutput}</pre>
            </>
          )}
        </>
      )}

      {draft && (
        <>
          <h2>Proposal (edit, then save)</h2>
          <textarea rows={30} cols={110} value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy} />
          <br />
          <button onClick={save} disabled={busy}>
            Save
          </button>
        </>
      )}
      {saveMsg && <pre style={{ whiteSpace: 'pre-wrap' }}>{saveMsg}</pre>}

      {lookup && (
        <>
          <h2>Reference ids</h2>
          <pre>
            {'kinds:\n' + lookup.kinds.map((k) => `  ${k.id}  ${k.name}`).join('\n')}
            {'\ncourses:\n' + (lookup.courses.map((c) => `  ${c.id}  ${c.code}`).join('\n') || '  (none)')}
          </pre>
        </>
      )}
    </div>
  );
}
