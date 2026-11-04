import type { ReactNode } from 'react';

export function ProsePage({
  title,
  updated,
  children,
}: {
  title: string;
  updated?: string;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      {updated && <p className="mt-2 text-sm text-fd-muted-foreground">Last updated {updated}</p>}
      <div className="prose mt-8 max-w-none text-fd-foreground">{children}</div>
    </main>
  );
}
