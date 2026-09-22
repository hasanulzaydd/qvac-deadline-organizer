'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/', label: 'Dashboard' },
  { href: '/routine', label: 'Routine' },
  { href: '/deadlines', label: 'Deadlines' },
] as const;

export function Nav() {
  const pathname = usePathname();
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-3">
        <Link href="/" className="shrink-0 font-semibold tracking-tight">
          Deadlines<span className="text-indigo-600">.</span>
        </Link>
        <nav className="-mx-1 flex flex-1 gap-1 overflow-x-auto">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive(l.href) ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <Link
          href="/add"
          className="shrink-0 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500"
        >
          + Add
        </Link>
      </div>
    </header>
  );
}
