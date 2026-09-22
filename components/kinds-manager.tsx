'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { postChange } from '@/lib/api-client';
import type { Change } from '@/lib/change';
import type { Kind, KindMode } from '@/lib/schema';
import { KIND_COLORS } from '@/lib/view';
import { Modal } from './modal';
import { Card, buttonClass, inputBase, inputClass } from './ui';

function KindRow({
  kind,
  itemCount,
  onChange,
  onDelete,
}: {
  kind: Kind;
  itemCount: number;
  onChange: (patch: Partial<Omit<Kind, 'id'>>) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [name, setName] = useState(kind.name);

  async function commitName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === kind.name) return setName(kind.name);
    if (!(await onChange({ name: trimmed }))) setName(kind.name);
  }

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <input
        type="color"
        aria-label={`Colour of ${kind.name}`}
        value={kind.color}
        onChange={(e) => void onChange({ color: e.target.value })}
        className="h-8 w-8 shrink-0 cursor-pointer rounded border border-zinc-300 bg-white p-0.5"
      />
      <input
        aria-label="Kind name"
        className={`${inputBase} min-w-40 flex-1`}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => void commitName()}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <select
        aria-label="Wording"
        className={`${inputBase} w-auto`}
        value={kind.mode}
        onChange={(e) => void onChange({ mode: e.target.value as KindMode })}
      >
        <option value="submit">Submitted — “Due …”</option>
        <option value="attend">Attended — “At …”</option>
      </select>
      <span className="w-16 text-right text-sm tabular-nums text-zinc-500">
        {itemCount} item{itemCount === 1 ? '' : 's'}
      </span>
      <button type="button" onClick={onDelete} className="text-sm font-medium text-red-600 hover:text-red-500">
        Delete
      </button>
    </li>
  );
}

export function KindsManager({ kinds, itemCounts }: { kinds: Kind[]; itemCounts: Record<string, number> }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [newKind, setNewKind] = useState({ name: '', mode: 'submit' as KindMode, color: KIND_COLORS[5] });
  const [deleting, setDeleting] = useState<Kind | null>(null);
  const [deleteAction, setDeleteAction] = useState<'reassign' | 'delete'>('reassign');
  const [reassignTo, setReassignTo] = useState('');

  async function send(change: Change): Promise<boolean> {
    setError(null);
    const res = await postChange(change);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    router.refresh();
    return true;
  }

  function startDelete(kind: Kind) {
    setDeleting(kind);
    setDeleteAction('reassign');
    setReassignTo(kinds.find((k) => k.id !== kind.id)?.id ?? '');
  }

  async function confirmDelete() {
    if (!deleting) return;
    const count = itemCounts[deleting.id] ?? 0;
    // With no other kind to move items to, deleting them is the only option.
    const action = kinds.some((k) => k.id !== deleting.id) ? deleteAction : 'delete';
    const ok = await send({
      type: 'kind.delete',
      id: deleting.id,
      items:
        count === 0
          ? undefined
          : action === 'delete'
            ? { action: 'delete' }
            : { action: 'reassign', toKindId: reassignTo },
    });
    if (ok) setDeleting(null);
  }

  const deletingCount = deleting ? (itemCounts[deleting.id] ?? 0) : 0;
  const others = deleting ? kinds.filter((k) => k.id !== deleting.id) : [];

  return (
    <>
      {error && <p className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <Card>
        <ul className="divide-y divide-zinc-100">
          {kinds.map((k) => (
            <KindRow
              key={`${k.id}:${k.name}`}
              kind={k}
              itemCount={itemCounts[k.id] ?? 0}
              onChange={(patch) => send({ type: 'kind.update', id: k.id, patch })}
              onDelete={() => startDelete(k)}
            />
          ))}
          {kinds.length === 0 && <li className="px-4 py-6 text-center text-sm text-zinc-500">No kinds. Add one below.</li>}
        </ul>
      </Card>

      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!newKind.name.trim()) return;
          if (await send({ type: 'kind.create', kind: { ...newKind, name: newKind.name.trim() } })) {
            setNewKind({ ...newKind, name: '', color: KIND_COLORS[(KIND_COLORS.indexOf(newKind.color) + 1) % KIND_COLORS.length] });
          }
        }}
      >
        <input
          type="color"
          aria-label="New kind colour"
          value={newKind.color}
          onChange={(e) => setNewKind({ ...newKind, color: e.target.value })}
          className="h-9 w-9 cursor-pointer rounded border border-zinc-300 bg-white p-0.5"
        />
        <label className="min-w-40 flex-1 text-sm">
          <span className="mb-1 block font-medium text-zinc-700">New kind</span>
          <input
            className={inputClass}
            placeholder="e.g. Project, Presentation, Viva"
            value={newKind.name}
            onChange={(e) => setNewKind({ ...newKind, name: e.target.value })}
          />
        </label>
        <select
          aria-label="New kind wording"
          className={`${inputBase} w-auto`}
          value={newKind.mode}
          onChange={(e) => setNewKind({ ...newKind, mode: e.target.value as KindMode })}
        >
          <option value="submit">Submitted — “Due …”</option>
          <option value="attend">Attended — “At …”</option>
        </select>
        <button type="submit" className={buttonClass.primary} disabled={!newKind.name.trim()}>
          Add kind
        </button>
      </form>

      <Modal open={deleting !== null} title={`Delete “${deleting?.name}”?`} onClose={() => setDeleting(null)}>
        {deletingCount === 0 ? (
          <p className="text-sm text-zinc-600">No items use this kind.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="text-zinc-600">
              {deletingCount} item{deletingCount === 1 ? ' uses' : 's use'} this kind. What should happen to{' '}
              {deletingCount === 1 ? 'it' : 'them'}?
            </p>
            <label className={`flex items-start gap-2 ${others.length === 0 ? 'opacity-50' : ''}`}>
              <input
                type="radio"
                name="delete-action"
                className="mt-0.5"
                checked={deleteAction === 'reassign' && others.length > 0}
                disabled={others.length === 0}
                onChange={() => setDeleteAction('reassign')}
              />
              <span className="flex-1">
                Move {deletingCount === 1 ? 'it' : 'them'} to
                <select
                  className={`${inputClass} mt-1`}
                  value={reassignTo}
                  disabled={others.length === 0 || deleteAction !== 'reassign'}
                  onChange={(e) => setReassignTo(e.target.value)}
                >
                  {others.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.name}
                    </option>
                  ))}
                </select>
                {others.length === 0 && <span className="mt-1 block text-xs">No other kind to move them to.</span>}
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                type="radio"
                name="delete-action"
                className="mt-0.5"
                checked={deleteAction === 'delete' || others.length === 0}
                onChange={() => setDeleteAction('delete')}
              />
              <span className="text-red-700">
                Delete the {deletingCount} item{deletingCount === 1 ? '' : 's'} too
              </span>
            </label>
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className={buttonClass.secondary} onClick={() => setDeleting(null)}>
            Cancel
          </button>
          <button
            type="button"
            className={buttonClass.danger}
            onClick={() => void confirmDelete()}
          >
            {deletingCount === 0
              ? 'Delete kind'
              : deleteAction === 'delete' || others.length === 0
                ? `Delete kind and ${deletingCount} item${deletingCount === 1 ? '' : 's'}`
                : 'Move items and delete kind'}
          </button>
        </div>
      </Modal>
    </>
  );
}

